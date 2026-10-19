/**
 * Background extraction job for chat uploads (Phase B of the
 * upload-on-demand plan).
 *
 * Trigger: after a `thread_uploads` row is created, the upload route calls
 * `enqueueUploadExtraction()`. The job runs fire-and-forget in-process and
 * records progress in `upload_documents.status`:
 *
 *   processing → ready | partial | failed
 *
 * Key properties (see plans/upload-on-demand-implementation.md §B3):
 * - Content-hash short-circuit: an existing `upload_documents` row for the
 *   same upload id + content hash is reused — never re-extracted.
 * - Extraction reuses the shared tiered extractor (local parsers first,
 *   Mistral OCR / Azure DI fallback).
 * - The ordered text is chunked into `upload_sections` with stable
 *   `char_start/char_end` and `page_start/page_end` offsets, snapped to page
 *   boundaries, so `kb_read` / `kb_search` can fetch exact ranges on demand.
 * - Every section records `extract_status` — a partially failed extraction
 *   still yields readable ranges (`status = 'partial'`).
 *
 * Feature flag: `UPLOAD_ON_DEMAND` env var (default enabled). When disabled,
 * enqueue is a no-op and the legacy sampled RAG path stays authoritative.
 */

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import {
  extractText,
  getMimeTypeFromFilename,
} from './document-extractor';
import {
  createUploadDocument,
  getUploadDocumentByUploadId,
  updateUploadDocumentStatus,
  replaceSections,
  updateUploadDocumentOverview,
} from './db/compat';
import type { NewUploadSection, UploadDocumentStatus } from './db/compat/upload-documents';

// ============================================
// Overview generation (Phase D — stored once at processing time)
// ============================================

/** Per-section chars fed to the overview prompt (head + tail slices). */
const OVERVIEW_SECTION_CHARS = 600;
/** Hard cap on total prompt chars for overview generation. */
const OVERVIEW_MAX_PROMPT_CHARS = 48000;

/**
 * Hierarchical overview from the extracted sections (plan §D "summarize the
 * whole document" row): each section contributes a head+tail slice, and a
 * single internal LLM call produces the document-level overview. The result
 * is stored in `upload_documents.overview` and re-used on every later turn —
 * per-turn callers never regenerate it.
 */
export async function generateOverview(
  filename: string,
  sections: ChunkedSection[]
): Promise<string | null> {
  const usable = sections.filter((s) => s.text.trim().length > 0);
  if (usable.length === 0) return null;

  const parts: string[] = [];
  let total = 0;
  for (const s of usable) {
    const text = s.text.trim();
    const head = text.slice(0, OVERVIEW_SECTION_CHARS);
    const tail = text.length > OVERVIEW_SECTION_CHARS
      ? `\n[...]\n${text.slice(-Math.floor(OVERVIEW_SECTION_CHARS / 2))}`
      : '';
    const part = `[pages ${s.pageStart}-${s.pageEnd}, section ${s.seq}]\n${head}${tail}`;
    if (total + part.length > OVERVIEW_MAX_PROMPT_CHARS) break;
    parts.push(part);
    total += part.length;
  }

  const { createInternalCompletion } = await import('./llm-client');
  const overview = await createInternalCompletion({
    messages: [
      {
        role: 'system' as const,
        content:
          'You produce a compact overview of a document from page excerpts. ' +
          'Return a plain-text overview of at most 250 words covering: what the document is, ' +
          'its main sections/topics in order, and any key facts, names, numbers or conclusions visible. ' +
          'No preamble, no markdown headings — just the overview text.',
      },
      {
        role: 'user' as const,
        content:
          `Document: ${filename}\nPage excerpts follow, in order:\n\n${parts.join('\n\n')}`,
      },
    ],
    temperature: 0.2,
    maxTokens: 600,
  });

  const trimmed = overview?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

// ============================================
// Feature flag
// ============================================

export function isUploadOnDemandEnabled(): boolean {
  return process.env.UPLOAD_ON_DEMAND !== 'false';
}

// ============================================
// Section chunking (pure — unit tested)
// ============================================

export interface ChunkedSection {
  seq: number;
  pageStart: number;
  pageEnd: number;
  charStart: number;
  charEnd: number;
  text: string;
}

interface PageLike {
  pageNumber: number;
  text: string;
}

/**
 * Chunk ordered page text into `upload_sections`-shaped pieces.
 *
 * - Fixed target size (`targetChars`, default 4000) with page-boundary
 *   snapping: a section never splits mid-page when a page ends within
 *   `maxOvershoot` chars of the target — it absorbs the remainder instead.
 * - Offsets are into the concatenated full text (pages joined with '\n\n'),
 *   and `char_end` is EXCLUSIVE. `charEnd - charStart === text.length`
 *   always holds, guaranteeing gap-free byte-exact traversal.
 */
export function chunkPagesIntoSections(
  pages: PageLike[],
  targetChars: number = 4000,
  maxOvershoot: number = 1000
): ChunkedSection[] {
  if (pages.length === 0) return [];

  const PAGE_JOIN = '\n\n';

  // Page boundaries in the concatenated text: page i occupies
  // [start, start + text.length), followed by the join separator.
  const pageSpans: { pageNumber: number; start: number; end: number }[] = [];
  const fullTextParts: string[] = [];
  let cursor = 0;
  // Highest page number seen so far with actual text — the clamp target for
  // sections whose char range falls entirely in blank pages (no page span
  // intersects their char range). Updated as pages stream through so a blank
  // page anywhere clamps to the nearest PRECEDING real page.
  let lastRealPageNumber = pages[0].pageNumber;
  pages.forEach((page, index) => {
    const start = cursor;
    const end = cursor + page.text.length;
    pageSpans.push({ pageNumber: page.pageNumber, start, end });
    fullTextParts.push(page.text);
    if (page.text.length > 0) lastRealPageNumber = page.pageNumber;
    if (index < pages.length - 1) fullTextParts.push(PAGE_JOIN);
    cursor = end + PAGE_JOIN.length;
  });
  const fullText = fullTextParts.join('');
  const totalLength = fullText.length;

  const sections: ChunkedSection[] = [];
  let charStart = 0;
  let seq = 0;

  while (charStart < totalLength) {
    let charEnd: number;

    // Find the page containing the nominal cut point.
    const nominalEnd = Math.min(charStart + targetChars, totalLength);
    const pageAtNominal = pageSpans.find(
      (p) => nominalEnd > p.start && nominalEnd <= p.end
    );

    if (!pageAtNominal || nominalEnd === totalLength) {
      charEnd = nominalEnd;
    } else {
      // Distance from the cut point to the end of the current page.
      const overshoot = pageAtNominal.end - nominalEnd;
      if (overshoot <= maxOvershoot) {
        // Snap forward: include the rest of this page.
        charEnd = pageAtNominal.end;
      } else {
        // Snap backward: cut at the start of the page containing the
        // nominal end, unless that would leave this section empty.
        if (pageAtNominal.start > charStart) {
          charEnd = pageAtNominal.start;
        } else {
          charEnd = nominalEnd;
        }
      }
    }

    const pagesInRange = pageSpans
      .filter((p) => p.end > charStart && p.start < charEnd)
      .map((p) => p.pageNumber);

    // A trailing blank page contributes zero chars to the concatenated text,
    // so the final section's range can match NO page span — Math.min/max of
    // the empty list would yield ±Infinity and break the integer NOT NULL
    // page columns. Clamp to the nearest real page in that case.
    const pageStart = pagesInRange.length > 0 ? Math.min(...pagesInRange) : lastRealPageNumber;
    const pageEnd = pagesInRange.length > 0 ? Math.max(...pagesInRange) : lastRealPageNumber;

    sections.push({
      seq: seq++,
      pageStart,
      pageEnd,
      charStart,
      charEnd,
      text: fullText.slice(charStart, charEnd),
    });

    charStart = charEnd;
  }

  return sections;
}

// ============================================
// Outline / overview builders (pure)
// ============================================

export interface OutlineEntry {
  seq: number;
  page_start: number;
  page_end: number;
  heading: string;
}

/**
 * Derive a lightweight outline from section headings: the first markdown
 * heading (#-style) or first non-empty line of each section.
 */
export function buildOutline(sections: ChunkedSection[]): OutlineEntry[] {
  return sections.map((s) => {
    const firstLine = s.text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
    const heading = firstLine.replace(/^#{1,6}\s+/, '').slice(0, 120);
    return {
      seq: s.seq,
      page_start: s.pageStart,
      page_end: s.pageEnd,
      heading,
    };
  });
}

// ============================================
// In-process queue
// ============================================

export interface UploadExtractionInput {
  uploadId: number;
  threadId: string;
  userId: string;
  organizationId?: number | null;
  filename: string;
  filepath: string;
  mimeType?: string;
}

const inFlight = new Set<number>();

/**
 * Fire-and-forget enqueue. Failures are logged and reflected in the
 * `upload_documents.status` column — they never surface to the upload
 * request. Concurrent duplicates for the same upload are coalesced.
 */
export function enqueueUploadExtraction(input: UploadExtractionInput): void {
  if (!isUploadOnDemandEnabled()) return;
  if (inFlight.has(input.uploadId)) return;

  inFlight.add(input.uploadId);
  // Deliberately detached: the HTTP response must not wait on OCR.
  void processUploadExtraction(input)
    .catch((error) => {
      console.error(
        `[upload-processing] Unhandled extraction failure for upload ${input.uploadId}:`,
        error instanceof Error ? error.message : error
      );
    })
    .finally(() => {
      inFlight.delete(input.uploadId);
    });
}

// ============================================
// Core job
// ============================================

export async function processUploadExtraction(input: UploadExtractionInput): Promise<void> {
  const {
    uploadId, threadId, userId, organizationId, filename, filepath,
  } = input;

  const mimeType = input.mimeType || getMimeTypeFromFilename(filename);

  // 1. Read the stored file and hash its bytes.
  let buffer: Buffer;
  try {
    buffer = await readFile(filepath);
  } catch (error) {
    // File already gone (deleted between enqueue and run) — nothing to do.
    console.warn(
      `[upload-processing] Upload file unreadable, skipping: ${filepath}`,
      error instanceof Error ? error.message : error
    );
    return;
  }

  const contentHash = createHash('sha256').update(buffer).digest('hex');

  // 2. Content-hash short-circuit: same upload re-enqueued with identical
  //    bytes → keep the existing document, no re-extraction.
  const existing = await getUploadDocumentByUploadId(uploadId);
  if (existing && existing.content_hash === contentHash && existing.status !== 'processing') {
    console.log(
      `[upload-processing] Upload ${uploadId} already extracted (hash match, status=${existing.status}) — skipping`
    );
    return;
  }

  // 3. Create or reset the document row.
  const document = existing && existing.content_hash === contentHash
    ? existing
    : await createUploadDocument({
        uploadId,
        threadId,
        userId,
        organizationId: organizationId ?? null,
        filename,
        contentHash,
        mimeType,
      });

  try {
    // 4. Extract via the shared tiered extractor (local parsers → OCR APIs).
    const result = await extractText(buffer, mimeType, filename);

    // 5. Chunk into sections with stable offsets.
    const sections = chunkPagesIntoSections(result.pages);
    const newSections: NewUploadSection[] = sections.map((s) => ({
      seq: s.seq,
      pageStart: s.pageStart,
      pageEnd: s.pageEnd,
      charStart: s.charStart,
      charEnd: s.charEnd,
      text: s.text,
      extractStatus: s.text.trim().length === 0 ? 'unavailable' : 'ok',
    }));

    await replaceSections(document.id, newSections);

    const failedSections = newSections.filter((s) => s.extractStatus !== 'ok').length;
    const charCount = sections.reduce((acc, s) => acc + s.text.length, 0);
    const outline = buildOutline(sections);

    // An empty document (no usable text at all) yields zero sections: there is
    // nothing to read, so the honest terminal state is 'failed', not 'ready'
    // (a 'ready' upload with no sections breaks the kb_read/kb_search ladder).
    const status: UploadDocumentStatus = newSections.length === 0 || failedSections === newSections.length
      ? 'failed'
      : failedSections === 0
        ? 'ready'
        : 'partial';

    await updateUploadDocumentStatus(document.id, {
      status,
      errorMessage: newSections.length === 0
        ? 'Document contained no extractable text.'
        : failedSections > 0
          ? `${failedSections}/${newSections.length} sections extracted empty`
          : null,
      extractor: result.provider,
      pageCount: result.numPages,
      charCount,
      outline: JSON.stringify(outline),
      // Overview is generated right below (best-effort) and persisted via
      // updateUploadDocumentOverview — never re-done per turn.
      overview: null,
    });

    // 6. Index all sections for vector search (Phase C). The embedding hook
    //    is invoked best-effort so a failure never fails the extraction.
    try {
      const { indexUploadSections } = await import('./upload-source');
      await indexUploadSections(document.id, sections);
    } catch (error) {
      console.warn(
        `[upload-processing] Section indexing unavailable for document ${document.id}:`,
        error instanceof Error ? error.message : error
      );
    }

    // 7. Generate and persist the document overview (Phase D) — runs ONCE at
    //    processing time. Best-effort: overview is optional; kb_read/kb_search
    //    work without it and the inventory card simply omits it.
    try {
      const overview = await generateOverview(filename, sections);
      if (overview) {
        await updateUploadDocumentOverview(document.id, overview);
      }
    } catch (error) {
      console.warn(
        `[upload-processing] Overview generation failed for document ${document.id}:`,
        error instanceof Error ? error.message : error
      );
    }

    console.log(
      `[upload-processing] Upload ${uploadId} extracted: status=${status} ` +
      `pages=${result.numPages} sections=${newSections.length} chars=${charCount} ` +
      `provider=${result.provider}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown extraction error';
    console.error(`[upload-processing] Extraction failed for upload ${uploadId}: ${message}`);
    await updateUploadDocumentStatus(document.id, {
      status: 'failed',
      errorMessage: message,
      extractor: null,
      pageCount: null,
      charCount: null,
      outline: null,
      overview: null,
    });
  }
}

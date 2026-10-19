/**
 * On-demand upload retrieval for chat turns (Phase D of the
 * upload-on-demand plan).
 *
 * When a thread's uploads already have durable extractions
 * (`upload_documents.status = 'ready' | 'partial'`), per-turn retrieval STOPS
 * re-extracting/re-summarizing the full document AND STOPS running embedding
 * vector search over the uploads every turn. Instead:
 *
 * 1. An INVENTORY CARD (documentId, filename, status, page count, outline,
 *    stored overview) is injected so the model knows what exists.
 * 2. The model pulls document content ON DEMAND via `kb_read` / `kb_search`
 *    (including continuation cursors). This is the primary access path.
 * 3. Optionally, top-K evidence sections can still be auto-injected per turn
 *    by setting `UPLOAD_EVIDENCE=true` — off by default because vector search
 *    on every chat turn is exactly what on-demand access replaces.
 *
 * The legacy full-document path (`buildContext` full-text extraction) is
 * kept ONLY as a fallback for uploads with no `upload_documents` row
 * (pre-migration / flag-off) — see `splitUploadPaths()` in the retrieval
 * entry points.
 *
 * Identity comes exclusively from the request context (plan §C4): threadId
 * and userId are never accepted from model-visible arguments.
 */

import { getRequestContext } from './request-context';
import { isUploadOnDemandEnabled } from './upload-processing';
import { listUploadDocumentsByThread } from './db/compat';
import type { UploadDocument } from './db/compat/upload-documents';
import { searchUploadSections } from './upload-source';
import type { UploadSearchHit } from './upload-source';
import type { OutlineEntry } from './upload-processing';
import { ragLogger as logger } from './logger';

/** Statuses that mean the durable index is usable for a turn. */
const READY_STATUSES: ReadonlySet<string> = new Set(['ready', 'partial']);

/**
 * Whether per-turn automatic evidence retrieval (embedding/vector search over
 * uploads) is enabled. Opt-in only — on-demand access replaces it; the model
 * reads uploads through kb_read/kb_search instead.
 */
export function isUploadEvidenceEnabled(): boolean {
  return process.env.UPLOAD_EVIDENCE === 'true';
}

/** Evidence sections injected per turn (plan §D: top-3). */
const TOP_K_SECTIONS = 3;

/** Max chars of evidence text injected per turn. */
const EVIDENCE_CHAR_BUDGET = 9000;

/**
 * Result of splitting the per-turn upload paths into on-demand vs legacy.
 */
export interface UploadPathSplit {
  /** Paths whose file has a ready/partial durable extraction — served from the index. */
  onDemandDocs: UploadDocument[];
  /** Paths with no usable durable row — fall back to the legacy per-turn path. */
  legacyPaths: string[];
  /** Whether Phase D behavior applies at all this turn. */
  enabled: boolean;
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}

/**
 * Split the caller-supplied upload paths by durable-extraction availability.
 * Filename matching is exact (case-insensitive) against `upload_documents`
 * rows for the request-context thread. Only ready/partial rows qualify —
 * `processing`/`failed` rows stay on the legacy path (extraction may still
 * be running, or failed and legacy re-extraction is the only recourse).
 */
export async function splitUploadPaths(userDocPaths: string[]): Promise<UploadPathSplit> {
  const enabled = isUploadOnDemandEnabled();
  if (!enabled || userDocPaths.length === 0) {
    return { onDemandDocs: [], legacyPaths: userDocPaths, enabled: false };
  }

  const ctx = getRequestContext();
  if (!ctx.threadId) {
    return { onDemandDocs: [], legacyPaths: userDocPaths, enabled: false };
  }

  try {
    const docs = await listUploadDocumentsByThread(ctx.threadId);
    const byFilename = new Map<string, UploadDocument>();
    for (const doc of docs) {
      if (READY_STATUSES.has(doc.status)) {
        byFilename.set(doc.filename.toLowerCase(), doc);
      }
    }

    const onDemandDocs: UploadDocument[] = [];
    const legacyPaths: string[] = [];
    for (const path of userDocPaths) {
      const doc = byFilename.get(basename(path).toLowerCase());
      if (doc) {
        onDemandDocs.push(doc);
      } else {
        legacyPaths.push(path);
      }
    }
    return { onDemandDocs, legacyPaths, enabled: true };
  } catch (error) {
    logger.warn('Upload path split failed — falling back to legacy path', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { onDemandDocs: [], legacyPaths: userDocPaths, enabled: false };
  }
}

/**
 * Format the inventory card for the on-demand uploads. Reports stored state
 * only — never synthesizes. Includes the stored overview when present so
 * "summarize the whole document" questions are answered from the one-time
 * processing-time summary instead of re-reading every page.
 */
export function formatUploadInventoryCard(docs: UploadDocument[]): string {
  if (docs.length === 0) return '';
  const lines: string[] = [];
  for (const doc of docs) {
    lines.push(
      `- documentId: ${doc.id} | file: ${doc.filename} | status: ${doc.status}` +
      ` | pages: ${doc.page_count ?? '?'} | chars: ${doc.char_count?.toLocaleString() ?? '?'}`
    );
    if (doc.overview) {
      lines.push(`  overview: ${doc.overview}`);
    } else if (doc.outline) {
      try {
        // pg returns JSONB columns already parsed (type parser 3802 is NOT
        // overridden), so accept both a parsed array and a JSON string.
        const parsedOutline: unknown = Array.isArray(doc.outline)
          ? doc.outline
          : typeof doc.outline === 'string'
            ? JSON.parse(doc.outline)
            : null;
        const outline = (Array.isArray(parsedOutline) ? parsedOutline : []) as OutlineEntry[];
        const entries = outline.slice(0, 12).map((o) => `p${o.page_start}: ${o.heading}`);
        const more = outline.length > 12 ? ` … (+${outline.length - 12} more)` : '';
        lines.push(`  outline: ${entries.join(' | ')}${more}`);
      } catch {
        // Malformed outline — omit rather than break the card.
      }
    }
  }
  return lines.join('\n');
}

/**
 * Retrieve top-K relevant sections for this turn from the durable index and
 * format them as an evidence block with page provenance. Best-effort: any
 * failure yields an empty string (context still has the inventory card).
 */
export async function retrieveUploadEvidence(
  docs: UploadDocument[],
  query: string
): Promise<string> {
  if (docs.length === 0 || !query.trim()) return '';

  const ctx = getRequestContext();
  if (!ctx.threadId || !ctx.userId) return '';

  try {
    const hits = await searchUploadSections({
      threadId: ctx.threadId,
      userId: ctx.userId,
      query,
      topK: TOP_K_SECTIONS,
    });
    // Restrict to the on-demand documents (defensive — the index is already
    // thread-scoped, but a hit may belong to a doc that fell back to legacy).
    const allowed = new Set(docs.map((d) => d.id));
    const filtered = hits.filter((h) => allowed.has(h.documentId));
    if (filtered.length === 0) return '';

    let used = 0;
    const parts: string[] = [];
    filtered.forEach((hit: UploadSearchHit, i: number) => {
      if (used >= EVIDENCE_CHAR_BUDGET) return;
      const slice = hit.text.length > EVIDENCE_CHAR_BUDGET - used
        ? hit.text.slice(0, EVIDENCE_CHAR_BUDGET - used)
        : hit.text;
      used += slice.length;
      parts.push(
        `[${i + 1}] ${hit.documentName} — pages ${hit.pageStart}-${hit.pageEnd} ` +
        `(section ${hit.seq}, score ${hit.score.toFixed(3)})\n${slice}`
      );
    });
    if (parts.length === 0) return '';
    return parts.join('\n\n');
  } catch (error) {
    logger.warn('Upload evidence retrieval failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

/**
 * Build the full on-demand context section (inventory card + evidence) for
 * injection at the top of the chat context. Returns '' when nothing applies.
 */
export async function buildUploadOnDemandContext(
  docs: UploadDocument[],
  userMessage: string
): Promise<string> {
  if (docs.length === 0) return '';

  const inventory = formatUploadInventoryCard(docs);
  // Evidence is OPT-IN (UPLOAD_EVIDENCE=true). Ordinary turns are
  // inventory-only: no embedding/vector call for uploads — the model reads
  // content on demand via kb_read/kb_search.
  const evidence = isUploadEvidenceEnabled()
    ? await retrieveUploadEvidence(docs, userMessage)
    : '';

  const sections: string[] = [];
  sections.push(
    '=== UPLOADED DOCUMENTS (on-demand access) ===\n' +
    'The files below are attached to this conversation and fully indexed. ' +
    'Use this inventory; do NOT assume you have seen the full text.\n' +
    inventory
  );
  if (evidence) {
    sections.push(
      '=== MOST RELEVANT SECTIONS FOR THIS MESSAGE ===\n' + evidence
    );
  }
  sections.push(
    'To read more of an uploaded document beyond the sections above, call ' +
    "kb_read with its document_id (optionally page_start/page_end/from_char, or a 'cursor' " +
    'to continue a long read) or kb_search with a topic query. ' +
    'kb_summary scope=uploads lists all indexed uploads.'
  );
  return sections.join('\n\n');
}

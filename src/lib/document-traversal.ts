/**
 * Coverage-tracked exhaustive extraction over chat uploads (Phase E of the
 * upload-on-demand plan).
 *
 * Enumerates ALL `upload_sections` of a document in `seq` order and runs
 * bounded LLM batches (default 5 sections with 1-section overlap) — each
 * batch is its own `createInternalCompletion` call with its own token
 * budget, so a 100-page document costs the same per-call budget as a short
 * one and never overflows the per-turn context.
 *
 * Findings persist OUTSIDE chat context in `extraction_findings`, each
 * citing its source range (seq/page/char offsets) for artifact citations.
 * Coverage is queryable at any time:
 *   - processed ranges  → rows in extraction_findings
 *   - remaining ranges  → sections with seq > maxExtractedSeq
 *   - failed sections   → upload_sections.extract_status != 'ok'
 *
 * Retries: failed batches are retried up to `EXTRACTION_MAX_RETRIES`; if
 * any batch still fails, the run result reports `"coverage": "partial"`
 * with the failed seq ranges listed.
 *
 * Feature flag: `KNOWLEDGE_EXTRACT` env var (default disabled).
 */

import { createInternalCompletion } from './llm-client';
import { getLlmSettings } from './db/compat/config';
import { ragLogger as logger } from './logger';
import {
  getSectionsByDocument,
  getUploadDocumentById,
} from './db/compat';
import {
  createExtractionFindingsBatch,
  getExtractionFindingsByDocument,
  deleteExtractionFindingsInRange,
} from './db/compat/extraction-findings';
import type { ExtractionFinding, NewExtractionFinding } from './db/compat/extraction-findings';
import type { UploadSection } from './db/compat/upload-documents';

export function isKnowledgeExtractEnabled(): boolean {
  return process.env.KNOWLEDGE_EXTRACT === 'true';
}

// ============================================
// Tunables
// ============================================

const SECTIONS_PER_BATCH = 5;
const OVERLAP_SECTIONS = 1;
const EXTRACTION_MAX_RETRIES = 1;
const BATCH_CHARS_BUDGET = 24000;

// ============================================
// Types
// ============================================

export interface ExtractionBatch {
  seqStart: number;
  seqEnd: number;
  sections: UploadSection[];
  text: string;
}

export interface TraversalRunResult {
  documentId: string;
  kind: string;
  /** 'complete' — all sections processed and persisted; 'partial' — some batches failed. */
  coverage: 'complete' | 'partial';
  totalSections: number;
  processedSections: number;
  failedBatches: Array<{ seqStart: number; seqEnd: number; error: string }>;
  findingsCount: number;
}

// ============================================
// Batching (pure — unit tested)
// ============================================

/**
 * Group sections into bounded batches with overlap. Batches never exceed
 * SECTIONS_PER_BATCH sections or BATCH_CHARS_BUDGET chars. The overlap
 * (last OVERLAP_SECTIONS of the previous batch prepended to the next) gives
 * the merge pass the join text for entities spanning batch boundaries.
 * Returns batches with their inclusive seq ranges.
 */
export function buildExtractionBatches(
  sections: UploadSection[],
  perBatch: number = SECTIONS_PER_BATCH,
  overlap: number = OVERLAP_SECTIONS,
  charsBudget: number = BATCH_CHARS_BUDGET
): ExtractionBatch[] {
  if (sections.length === 0) return [];
  const ordered = [...sections].sort((a, b) => a.seq - b.seq);
  const batches: ExtractionBatch[] = [];

  let start = 0;
  while (start < ordered.length) {
    // Overlap first: prepend the tail of the previous batch's sections, so
    // the member budget can account for it. The FINAL batch (overlap +
    // members) must never exceed perBatch sections or charsBudget chars —
    // computing members after the overlap prevents the budget overrun that
    // occurs when overlap is appended after member selection.
    const prev = batches[batches.length - 1];
    const overlapSections: UploadSection[] = [];
    if (prev && overlap > 0) {
      const prevTail = ordered.filter((s) =>
        s.seq > prev.seqEnd - overlap && s.seq <= prev.seqEnd && s.seq < ordered[start].seq
      );
      overlapSections.push(...prevTail);
    }
    const overlapChars = overlapSections.reduce(
      (acc, s) => acc + s.text.length + 2, 0 // '\n\n' joins
    );
    const maxMembers = Math.max(1, perBatch - overlapSections.length);
    const memberBudget = Math.max(1, charsBudget - overlapChars);

    const members: UploadSection[] = [];
    let chars = 0;
    let end = start;
    while (end < ordered.length && members.length < maxMembers) {
      const s = ordered[end];
      const cost = s.text.length + (members.length > 0 ? 2 : 0); // '\n\n' joins
      if (members.length > 0 && chars + cost > memberBudget) break;
      members.push(s);
      chars += cost;
      end += 1;
    }
    if (members.length === 0) {
      // Single section larger than the budget — take it alone (hard slice
      // so a pathologically huge section cannot stall the traversal).
      const s = ordered[end];
      members.push(s);
      end += 1;
    }

    const all = [...overlapSections, ...members];
    batches.push({
      seqStart: members[0].seq,
      seqEnd: members[members.length - 1].seq,
      sections: all,
      text: all.map((s) => s.text).join('\n\n'),
    });
    start = end;
  }
  return batches;
}

// ============================================
// Batch prompt
// ============================================

function buildBatchPrompt(input: {
  filename: string;
  kind: string;
  instruction: string;
  seqStart: number;
  seqEnd: number;
  batchText: string;
}): { system: string; user: string } {
  const system =
    'You are an extraction engine. Extract structured findings from a slice of a document. ' +
    'Return ONLY a JSON object of the form {"findings": [ ... ]}. ' +
    'Each finding must be a JSON object with at minimum a "summary" field (one clear sentence) ' +
    'and any additional structured fields relevant to the requested kind. ' +
    'Only report facts present in the text — never invent findings. ' +
    'If nothing relevant appears in this slice, return {"findings": []}.';
  const user =
    `Document: ${input.filename}\n` +
    `Extraction kind: ${input.kind}\n` +
    `Instructions: ${input.instruction}\n` +
    `Slice covers sections ${input.seqStart}–${input.seqEnd} (an overlapping section before ` +
    `${input.seqStart} may repeat from the previous slice — report an entity once, where it first appears).\n\n` +
    `Document slice:\n\n${input.batchText}`;
  return { system, user };
}

/**
 * Parse the model's findings payload. Returns `null` when the output is
 * MALFORMED (unparseable / wrong shape) so the caller treats it as a failed
 * batch instead of silently persisting an empty-coverage tombstone. Returns
 * an array (possibly empty) for well-formed output — `{"findings": []}` is a
 * genuine empty result.
 */
function parseFindingsPayload(raw: string): Array<Record<string, unknown>> | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as { findings?: unknown };
    if (!parsed || !Array.isArray(parsed.findings)) return null;
    return parsed.findings.filter(
      (f): f is Record<string, unknown> => typeof f === 'object' && f !== null
    );
  } catch {
    return null;
  }
}

// ============================================
// Traversal
// ============================================

export interface TraversalInput {
  documentId: string;
  /** Extraction kind, e.g. 'entities', 'obligations', 'questions'. */
  kind: string;
  /** Free-text instruction for the extraction batch prompt. */
  instruction: string;
  /** Resume from this seq (inclusive) instead of the beginning. */
  fromSeq?: number;
}

/**
 * Run a coverage-tracked exhaustive extraction over the document. Batches
 * are processed sequentially; each persists its findings immediately so a
 * crash mid-run leaves durable, queryable partial coverage. Failed batches
 * are retried; unresolved failures surface as `"coverage": "partial"`.
 *
 * Identity: the caller must already have authorized the document via
 * `getAccessibleUploadDocument` — this function re-checks existence but
 * trusts the caller for tenancy.
 */
export async function runDocumentTraversal(input: TraversalInput): Promise<TraversalRunResult> {
  const { documentId, kind, instruction } = input;

  const document = await getUploadDocumentById(documentId);
  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }
  if (document.status !== 'ready' && document.status !== 'partial') {
    throw new Error(`Document is not ready for extraction (status=${document.status}): ${documentId}`);
  }

  const allSections = await getSectionsByDocument(documentId);
  if (allSections.length === 0) {
    throw new Error(`Document has no extracted source sections: ${documentId}`);
  }
  const maxSectionSeq = allSections.reduce((m, s) => Math.max(m, s.seq), -1);

  // Persisted coverage: a section seq is covered when some finding row's
  // inclusive range contains it. Range-based (not max-seq) so holes from
  // failed batches are retried on the next run.
  const persistedRows = await getExtractionFindingsByDocument(documentId, kind);
  const coveredSeqs = new Set<number>();
  for (const row of persistedRows) {
    for (let seq = row.seq_start; seq <= row.seq_end; seq++) coveredSeqs.add(seq);
  }

  // Restart semantics: an explicit fromSeq re-extracts everything from that
  // seq onward. The restarted window's previous findings are DELETED first so
  // a restart replaces (never duplicates) persisted findings.
  const fromSeq = input.fromSeq !== undefined
    ? Math.min(Math.max(0, input.fromSeq), maxSectionSeq + 1)
    : undefined;
  if (fromSeq !== undefined && fromSeq <= maxSectionSeq) {
    const deleted = await deleteExtractionFindingsInRange(documentId, kind, fromSeq, maxSectionSeq);
    // Rebuild coverage from rows that survive the same overlap predicate as
    // the DB delete. Deleted prefixes must be retried, but a surviving row
    // may still legitimately cover some of those sections.
    coveredSeqs.clear();
    for (const row of persistedRows) {
      if (row.seq_start <= maxSectionSeq && row.seq_end >= fromSeq) continue;
      for (let seq = row.seq_start; seq <= row.seq_end; seq++) coveredSeqs.add(seq);
    }
    if (deleted > 0) {
      logger.info('Traversal restart cleared previous findings', { documentId, kind, fromSeq, deleted });
    }
  }

  const pending = allSections.filter((s) => !coveredSeqs.has(s.seq));

  const totalSections = allSections.length;
  const failedBatches: TraversalRunResult['failedBatches'] = [];
  let findingsCount = 0;

  const batches = buildExtractionBatches(pending);
  const llmSettings = await getLlmSettings();

  for (const batch of batches) {
    const { system, user } = buildBatchPrompt({
      filename: document.filename,
      kind,
      instruction,
      seqStart: batch.seqStart,
      seqEnd: batch.seqEnd,
      batchText: batch.text,
    });

    let raw: string | null = null;
    let lastError = '';
    for (let attempt = 0; attempt <= EXTRACTION_MAX_RETRIES; attempt++) {
      try {
        raw = await createInternalCompletion({
          messages: [
            { role: 'system' as const, content: system },
            { role: 'user' as const, content: user },
          ],
          model: llmSettings.model,
          temperature: 0,
          maxTokens: 2000,
          reasoningMode: 'disabled',
        });
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logger.warn('Extraction batch failed', {
          documentId,
          kind,
          seqStart: batch.seqStart,
          seqEnd: batch.seqEnd,
          attempt,
          error: lastError,
        });
      }
    }

    if (raw === null) {
      failedBatches.push({ seqStart: batch.seqStart, seqEnd: batch.seqEnd, error: lastError });
      continue;
    }

    const findings = parseFindingsPayload(raw);
    if (findings === null) {
      // Malformed model output — retry, then record as a failed batch.
      // NEVER persist this as an empty-coverage tombstone: a parse failure
      // is not evidence that the range holds no findings.
      logger.warn('Extraction batch returned malformed JSON', {
        documentId,
        kind,
        seqStart: batch.seqStart,
        seqEnd: batch.seqEnd,
      });
      failedBatches.push({
        seqStart: batch.seqStart,
        seqEnd: batch.seqEnd,
        error: 'Malformed model output — findings payload was not valid JSON',
      });
      continue;
    }

    if (findings.length === 0) {
      // GENUINE empty result still counts as processed coverage — record one
      // tombstone finding so coverage queries see the range as done.
      const tombstone: NewExtractionFinding = {
        documentId,
        seqStart: batch.seqStart,
        seqEnd: batch.seqEnd,
        pageStart: batch.sections[0]?.page_start ?? null,
        pageEnd: batch.sections[batch.sections.length - 1]?.page_end ?? null,
        charStart: batch.sections[0]?.char_start ?? null,
        charEnd: batch.sections[batch.sections.length - 1]?.char_end ?? null,
        kind,
        payload: { empty: true },
      };
      await createExtractionFindingsBatch([tombstone]);
      continue;
    }

    const rows: NewExtractionFinding[] = findings.map((payload) => {
      const first = batch.sections[0];
      const last = batch.sections[batch.sections.length - 1];
      return {
        documentId,
        seqStart: batch.seqStart,
        seqEnd: batch.seqEnd,
        pageStart: first?.page_start ?? null,
        pageEnd: last?.page_end ?? null,
        charStart: first?.char_start ?? null,
        charEnd: last?.char_end ?? null,
        kind,
        payload,
      };
    });
    findingsCount += await createExtractionFindingsBatch(rows);
  }

  // Coverage integrity: a run is 'complete' only when (a) no batches failed
  // AND (b) EVERY section seq is covered by a persisted finding range (this
  // run or a previous one — persisted ranges, not max-seq, so holes from
  // earlier failed batches keep coverage honest) AND (c) every section was
  // actually extractable at ingestion time (`extract_status === 'ok'`).
  // Sections whose source text was unavailable can never yield findings, so
  // treating them as covered would lie.
  for (const batch of batches) {
    if (!failedBatches.some(f => f.seqStart === batch.seqStart && f.seqEnd === batch.seqEnd)) {
      for (let seq = batch.seqStart; seq <= batch.seqEnd; seq++) coveredSeqs.add(seq);
    }
  }
  const coveredSectionSeqs = new Set<number>();
  const uncoveredSeqs: number[] = [];
  const unavailableSections = allSections.filter((s) => s.extract_status !== 'ok').length;
  for (const s of allSections) {
    if (coveredSeqs.has(s.seq)) {
      coveredSectionSeqs.add(s.seq);
    } else {
      uncoveredSeqs.push(s.seq);
    }
  }

  const coverage: TraversalRunResult['coverage'] =
    failedBatches.length === 0 && uncoveredSeqs.length === 0 && unavailableSections === 0
      ? 'complete'
      : 'partial';

  logger.info('Document traversal finished', {
    documentId,
    kind,
    coverage,
    batches: batches.length,
    failed: failedBatches.length,
    unavailableSourceSections: unavailableSections,
    findings: findingsCount,
  });

  return {
    documentId,
    kind,
    coverage,
    totalSections,
    processedSections: coveredSectionSeqs.size,
    failedBatches,
    findingsCount,
  };
}

// ============================================
// Findings reporting
// ============================================

/**
 * Format persisted findings for the knowledge_extract tool response, with
 * source-range citations on every finding. Findings never re-enter context
 * automatically — the model asks for them explicitly.
 *
 * Paginated: pass `offset` to page through large result sets. The response
 * carries `total` and `nextOffset` (null when exhausted) so the model can
 * fetch the remainder.
 */
export async function reportExtractionFindings(
  documentId: string,
  kind: string,
  limit = 50,
  offset = 0
): Promise<{
  findings: Array<Record<string, unknown>>;
  total: number;
  offset: number;
  nextOffset: number | null;
}> {
  const rows: ExtractionFinding[] = await getExtractionFindingsByDocument(documentId, kind);
  const total = rows.length;
  const start = Math.max(0, Math.min(Math.trunc(offset), total));
  const sliced = rows.slice(start, start + limit);
  const nextOffset = start + sliced.length < total ? start + sliced.length : null;
  return {
    total,
    offset: start,
    nextOffset,
    findings: sliced.map((r) => ({
      ...((typeof r.payload === 'object' && r.payload !== null ? r.payload : {}) as Record<string, unknown>),
      source: {
        seq_start: r.seq_start,
        seq_end: r.seq_end,
        page_start: r.page_start,
        page_end: r.page_end,
        char_start: r.char_start,
        char_end: r.char_end,
      },
    })),
  };
}

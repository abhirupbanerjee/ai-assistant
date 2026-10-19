/**
 * Extraction Findings Compat Operations (Phase E)
 *
 * Durable, structured findings produced by the coverage-tracked exhaustive
 * extraction (`src/lib/document-traversal.ts`). Findings live OUTSIDE chat
 * context — the knowledge_extract tool queries them on demand so the model
 * never pays tokens for the full extraction in a single turn.
 *
 * Each finding cites its source range (seq/page/char offsets) so artifacts
 * can reference the exact place in the document a claim came from.
 *
 * All timestamps are strings (pg type parsers are overridden in kysely.ts).
 */

import { getDb } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'kysely';
import type { ExtractionFindingsTable } from '../db-types';

export type ExtractionFinding = {
  [K in keyof ExtractionFindingsTable]: ExtractionFindingsTable[K] extends import('kysely').Generated<infer T>
    ? T : ExtractionFindingsTable[K];
};

/** Input for one finding row. seq range is inclusive on both ends. */
export interface NewExtractionFinding {
  documentId: string;
  seqStart: number;
  seqEnd: number;
  pageStart?: number | null;
  pageEnd?: number | null;
  charStart?: number | null;
  charEnd?: number | null;
  kind: string;
  payload: Record<string, unknown>;
}

// ============ CRUD ============

export async function createExtractionFinding(input: NewExtractionFinding): Promise<ExtractionFinding> {
  const db = await getDb();
  const row = {
    id: uuidv4(),
    document_id: input.documentId,
    seq_start: input.seqStart,
    seq_end: input.seqEnd,
    page_start: input.pageStart ?? null,
    page_end: input.pageEnd ?? null,
    char_start: input.charStart ?? null,
    char_end: input.charEnd ?? null,
    kind: input.kind,
    payload: sql`${JSON.stringify(input.payload)}::jsonb`,
    created_at: sql`NOW()` as unknown as string,
  };
  const inserted = await db
    .insertInto('extraction_findings')
    .values(row)
    .returningAll()
    .executeTakeFirstOrThrow();
  return inserted as unknown as ExtractionFinding;
}

export async function createExtractionFindingsBatch(
  inputs: NewExtractionFinding[]
): Promise<number> {
  if (inputs.length === 0) return 0;
  const db = await getDb();
  const rows = inputs.map((input) => ({
    id: uuidv4(),
    document_id: input.documentId,
    seq_start: input.seqStart,
    seq_end: input.seqEnd,
    page_start: input.pageStart ?? null,
    page_end: input.pageEnd ?? null,
    char_start: input.charStart ?? null,
    char_end: input.charEnd ?? null,
    kind: input.kind,
    payload: sql`${JSON.stringify(input.payload)}::jsonb`,
    created_at: sql`NOW()` as unknown as string,
  }));
  const inserted = await db
    .insertInto('extraction_findings')
    .values(rows)
    .returningAll()
    .execute();
  return inserted.length;
}

/** All findings for a document (any kind), ordered by source position. */
export async function getExtractionFindingsByDocument(
  documentId: string,
  kind?: string
): Promise<ExtractionFinding[]> {
  const db = await getDb();
  let query = db
    .selectFrom('extraction_findings')
    .selectAll()
    .where('document_id', '=', documentId);
  if (kind) {
    query = query.where('kind', '=', kind);
  }
  return query
    .orderBy('seq_start', 'asc')
    .orderBy('seq_end', 'asc')
    .execute() as Promise<ExtractionFinding[]>;
}

/** Distinct kinds persisted for a document (coverage reporting). */
export async function getExtractionFindingKinds(documentId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('extraction_findings')
    .select('kind')
    .where('document_id', '=', documentId)
    .groupBy('kind')
    .orderBy('kind', 'asc')
    .execute();
  return rows.map((r) => r.kind);
}

/** Highest seq_end processed for a document+kind — resume point after retry. */
export async function getMaxExtractedSeq(documentId: string, kind: string): Promise<number> {
  const db = await getDb();
  const row = await db
    .selectFrom('extraction_findings')
    .select((eb) => eb.fn.max('seq_end').as('max_seq'))
    .where('document_id', '=', documentId)
    .where('kind', '=', kind)
    .executeTakeFirst();
  return row?.max_seq ?? 0;
}

/**
 * Delete findings whose inclusive seq range overlaps [seqStart, seqEnd] for a
 * document+kind — used by explicit traversal restarts so a re-run REPLACES
 * the findings in the restart window instead of appending duplicates.
 */
export async function deleteExtractionFindingsInRange(
  documentId: string,
  kind: string,
  seqStart: number,
  seqEnd: number
): Promise<number> {
  const db = await getDb();
  const result = await db
    .deleteFrom('extraction_findings')
    .where('document_id', '=', documentId)
    .where('kind', '=', kind)
    .where('seq_start', '<=', seqEnd)
    .where('seq_end', '>=', seqStart)
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}

export async function deleteExtractionFindingsByDocument(
  documentId: string,
  kind?: string
): Promise<number> {
  const db = await getDb();
  let query = db.deleteFrom('extraction_findings').where('document_id', '=', documentId);
  if (kind) {
    query = query.where('kind', '=', kind);
  }
  const result = await query.executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}

export async function deleteExtractionFindingsByThread(threadId: string): Promise<number> {
  const db = await getDb();
  // Subquery delete through the join on upload_documents (thread scoping).
  const result = await db
    .deleteFrom('extraction_findings')
    .where(
      'document_id',
      'in',
      db.selectFrom('upload_documents').select('id').where('thread_id', '=', threadId)
    )
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}

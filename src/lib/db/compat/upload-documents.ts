/**
 * Upload Documents Compat Operations
 *
 * Durable extracted-source storage for chat uploads (Phase B of the
 * upload-on-demand plan). One row per uploaded file in `upload_documents`,
 * plus chunked rows in `upload_sections` that preserve page/char offsets so
 * kb_read / kb_search tools can fetch exact ranges on demand.
 *
 * All timestamps are strings (pg type parsers are overridden in kysely.ts).
 */

import { getDb, transaction } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'kysely';
import type {
  UploadDocumentsTable,
  UploadSectionsTable,
} from '../db-types';

export type UploadDocument = SelectableUploadDocument;
export type UploadSection = SelectableUploadSection;
export type UploadDocumentStatus = UploadDocumentsTable['status'];
export type UploadSectionStatus = UploadSectionsTable['extract_status'];

type SelectableUploadDocument = {
  [K in keyof UploadDocumentsTable]: UploadDocumentsTable[K] extends import('kysely').Generated<infer T>
    ? T : UploadDocumentsTable[K];
};

type SelectableUploadSection = {
  [K in keyof UploadSectionsTable]: UploadSectionsTable[K] extends import('kysely').Generated<infer T>
    ? T : UploadSectionsTable[K];
};

/** Input for one section row (offsets are inclusive on both ends). */
export interface NewUploadSection {
  seq: number;
  pageStart: number;
  pageEnd: number;
  charStart: number;
  charEnd: number;
  text: string;
  extractStatus?: UploadSectionStatus;
}

export interface CreateUploadDocumentInput {
  uploadId: number;
  threadId: string;
  userId: string;
  organizationId?: number | null;
  filename: string;
  contentHash: string;
  mimeType?: string;
  extractor?: string | null;
}

// ============ Document CRUD ============

export async function createUploadDocument(input: CreateUploadDocumentInput): Promise<UploadDocument> {
  const db = await getDb();
  const id = uuidv4();
  const row = await db
    .insertInto('upload_documents')
    .values({
      id,
      upload_id: input.uploadId,
      thread_id: input.threadId,
      user_id: input.userId,
      organization_id: input.organizationId ?? null,
      filename: input.filename,
      content_hash: input.contentHash,
      mime_type: input.mimeType ?? 'application/octet-stream',
      status: 'processing',
      extractor: input.extractor ?? null,
    })
    .returning([
      'id', 'upload_id', 'thread_id', 'user_id', 'organization_id', 'filename',
      'content_hash', 'mime_type', 'status', 'error_message', 'extractor',
      'page_count', 'char_count', 'outline', 'overview', 'created_at', 'updated_at',
    ])
    .executeTakeFirstOrThrow();
  return row as UploadDocument;
}

/**
 * Find an already-extracted document by content hash for the same user,
 * so re-uploads of an identical file can skip re-extraction.
 */
export async function findReadyUploadDocumentByHash(
  userId: string,
  contentHash: string
): Promise<UploadDocument | undefined> {
  const db = await getDb();
  return db
    .selectFrom('upload_documents')
    .selectAll()
    .where('user_id', '=', userId)
    .where('content_hash', '=', contentHash)
    .where('status', 'in', ['ready', 'partial'])
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst() as Promise<UploadDocument | undefined>;
}

export async function getUploadDocumentByUploadId(
  uploadId: number
): Promise<UploadDocument | undefined> {
  const db = await getDb();
  return db
    .selectFrom('upload_documents')
    .selectAll()
    .where('upload_id', '=', uploadId)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst() as Promise<UploadDocument | undefined>;
}

export async function getUploadDocumentById(id: string): Promise<UploadDocument | undefined> {
  const db = await getDb();
  return db
    .selectFrom('upload_documents')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst() as Promise<UploadDocument | undefined>;
}

export async function listUploadDocumentsByThread(threadId: string): Promise<UploadDocument[]> {
  const db = await getDb();
  return db
    .selectFrom('upload_documents')
    .selectAll()
    .where('thread_id', '=', threadId)
    .orderBy('created_at', 'asc')
    .execute() as Promise<UploadDocument[]>;
}

export interface UpdateUploadDocumentStatusInput {
  status: UploadDocumentStatus;
  errorMessage?: string | null;
  extractor?: string | null;
  pageCount?: number | null;
  charCount?: number | null;
  /** JSON string of the document outline (section index) when ready. */
  outline?: string | null;
  overview?: string | null;
}

export async function updateUploadDocumentStatus(
  documentId: string,
  input: UpdateUploadDocumentStatusInput
): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('upload_documents')
    .set({
      status: input.status,
      error_message: input.errorMessage ?? null,
      ...(input.extractor !== undefined ? { extractor: input.extractor } : {}),
      page_count: input.pageCount ?? null,
      char_count: input.charCount ?? null,
      outline: input.outline ?? null,
      overview: input.overview ?? null,
      updated_at: sql`NOW()`,
    })
    .where('id', '=', documentId)
    .execute();
}

export async function deleteUploadDocument(documentId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('upload_documents')
    .where('id', '=', documentId)
    .executeTakeFirst();
  return (result.numDeletedRows ?? BigInt(0)) > BigInt(0);
}

export async function deleteUploadDocumentsByThread(threadId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .deleteFrom('upload_documents')
    .where('thread_id', '=', threadId)
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}

// ============ Section Operations ============

/**
 * Atomically replace all sections of a document. Called once extraction
 * finishes (or partially fails — failed sections are stored with
 * extractStatus='failed' so offsets stay contiguous).
 */
export async function replaceSections(
  documentId: string,
  sections: NewUploadSection[]
): Promise<void> {
  await transaction(async (trx) => {
    await trx
      .deleteFrom('upload_sections')
      .where('document_id', '=', documentId)
      .execute();

    if (sections.length === 0) return;

    await trx
      .insertInto('upload_sections')
      .values(
        sections.map((s) => ({
          id: uuidv4(),
          document_id: documentId,
          seq: s.seq,
          page_start: s.pageStart,
          page_end: s.pageEnd,
          char_start: s.charStart,
          char_end: s.charEnd,
          text: s.text,
          extract_status: s.extractStatus ?? 'ok',
        }))
      )
      .execute();
  });
}

export async function getSectionsByDocument(documentId: string): Promise<UploadSection[]> {
  const db = await getDb();
  return db
    .selectFrom('upload_sections')
    .selectAll()
    .where('document_id', '=', documentId)
    .orderBy('seq', 'asc')
    .execute() as Promise<UploadSection[]>;
}

/**
 * Fetch sections overlapping an inclusive character range. Used by
 * kb_read's offset/char-range reads — returns the full overlapping
 * sections so the caller sees complete context boundaries.
 */
export async function getSectionsByCharRange(
  documentId: string,
  charStart: number,
  charEnd: number
): Promise<UploadSection[]> {
  const db = await getDb();
  return db
    .selectFrom('upload_sections')
    .selectAll()
    .where('document_id', '=', documentId)
    .where('char_end', '>=', charStart)
    .where('char_start', '<=', charEnd)
    .orderBy('seq', 'asc')
    .execute() as Promise<UploadSection[]>;
}

/**
 * Fetch sections overlapping a page range (1-based, inclusive).
 */
export async function getSectionsByPageRange(
  documentId: string,
  pageStart: number,
  pageEnd: number
): Promise<UploadSection[]> {
  const db = await getDb();
  return db
    .selectFrom('upload_sections')
    .selectAll()
    .where('document_id', '=', documentId)
    .where('page_end', '>=', pageStart)
    .where('page_start', '<=', pageEnd)
    .orderBy('seq', 'asc')
    .execute() as Promise<UploadSection[]>;
}

/**
 * Persist the stored hierarchical overview (Phase D). Called once after
 * extraction succeeds — per-turn callers read the stored value, never
 * regenerate it.
 */
export async function updateUploadDocumentOverview(
  documentId: string,
  overview: string
): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('upload_documents')
    .set({ overview, updated_at: sql`NOW()` })
    .where('id', '=', documentId)
    .execute();
}

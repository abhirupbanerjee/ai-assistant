/**
 * On-demand access layer for chat upload documents (Phases B3/C of the
 * upload-on-demand plan).
 *
 * Responsibilities:
 * - `indexUploadSections()` — best-effort vector indexing of `upload_sections`
 *   into a PRIVATE per-thread collection (`uploads-<threadId>`). Uploads never
 *   enter the global, legacy or category KB collections (plan invariant F2/C4).
 * - `searchUploadSections()` — scoped semantic search over a thread's upload
 *   sections, returning section text with page/char provenance.
 * - `readUploadSections()` — deterministic range reads (page and/or char
 *   offsets) with HMAC-signed resumability cursors bound to the document's
 *   `content_hash`, so a cursor cannot be replayed against different content.
 *
 * Security invariants (plan §C4):
 * - Every entry point requires the caller to pass the `threadId` AND `userId`
 *   from the request context; documents are rejected when `thread_id` or
 *   `user_id` do not match — a document is only readable within its own
 *   thread by its owner.
 * - Cursors are HMAC-signed and hash-bound; tampering yields `null`.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { createEmbeddings } from './openai';
import { getVectorStore } from './vector-store';
import type { ChunkMetadata } from '@/types';
import {
  getUploadDocumentById,
  getSectionsByDocument,
  getSectionsByPageRange,
  getSectionsByCharRange,
} from './db/compat';
import type {
  UploadDocument,
  UploadSection,
} from './db/compat/upload-documents';
import type { ChunkedSection } from './upload-processing';

// ============================================
// Collection naming (private per-thread)
// ============================================

/**
 * Private, thread-scoped vector collection for upload sections. Distinct
 * naming (`uploads-` prefix, not a category slug) keeps uploads outside the
 * KB collections resolved by `CollectionNameHelpers`.
 */
export function uploadCollectionName(threadId: string): string {
  return `uploads-${threadId}`;
}

// ============================================
// Indexing (called from upload-processing)
// ============================================

/** Batch size for embedding calls (mirrors ingest.ts). */
const INDEX_BATCH_SIZE = 64;

export function sectionVectorId(documentId: string, seq: number): string {
  return `${documentId}-chunk-${seq}`;
}

/**
 * Index a document's sections for semantic search. Best-effort: throws are
 * caught by the caller (`processUploadExtraction`) and never fail extraction.
 */
export async function indexUploadSections(
  documentId: string,
  sections: ChunkedSection[]
): Promise<void> {
  if (sections.length === 0) return;

  const document = await getUploadDocumentById(documentId);
  if (!document) {
    throw new Error(`upload document ${documentId} not found for indexing`);
  }

  const collection = uploadCollectionName(document.thread_id);
  const store = await getVectorStore();

  if (!(await store.collectionExists(collection))) {
    await store.createCollection(collection);
  }

  for (let i = 0; i < sections.length; i += INDEX_BATCH_SIZE) {
    const batch = sections.slice(i, i + INDEX_BATCH_SIZE);
    const texts = batch.map((s) => s.text);
    const embeddings = await createEmbeddings(texts);
    const ids = batch.map((s) => sectionVectorId(documentId, s.seq));
    const metadatas: ChunkMetadata[] = batch.map((s) => ({
      documentId,
      documentName: document.filename,
      pageNumber: s.pageStart,
      chunkIndex: s.seq,
      source: 'user',
      threadId: document.thread_id,
      userId: document.user_id,
      status: document.status,
    }));
    await store.addDocuments(collection, ids, embeddings, texts, metadatas);
  }

  console.log(
    `[upload-source] Indexed ${sections.length} sections of document ${documentId} into ${collection}`
  );
}

/** Remove a document's vectors (delete cascade, plan §C4). */
export async function deleteUploadVectors(
  threadId: string,
  documentId: string
): Promise<void> {
  try {
    const collection = uploadCollectionName(threadId);
    const store = await getVectorStore();
    if (!(await store.collectionExists(collection))) return;
    await store.deleteDocumentsByFilter(collection, { documentId });
  } catch (error) {
    // Vectors are derived data — DB delete must still proceed.
    console.warn(
      `[upload-source] Vector cleanup failed for document ${documentId}:`,
      error instanceof Error ? error.message : error
    );
  }
}

/** Drop a thread's entire private upload collection (thread deletion). */
export async function deleteUploadCollection(threadId: string): Promise<void> {
  try {
    const collection = uploadCollectionName(threadId);
    const store = await getVectorStore();
    if (!(await store.collectionExists(collection))) return;
    await store.deleteCollection(collection);
  } catch (error) {
    console.warn(
      `[upload-source] Collection cleanup failed for thread ${threadId}:`,
      error instanceof Error ? error.message : error
    );
  }
}

// ============================================
// HMAC cursors
// ============================================

export interface UploadCursorPayload {
  documentId: string;
  contentHash: string;
  charOffset: number;
}

function getCursorSecret(): string {
  return (
    process.env.UPLOAD_CURSOR_SECRET ||
    process.env.AUTH_SECRET ||
    'upload-cursor-insecure-dev-secret'
  );
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

/** Sign a resumability cursor. Token format: `<b64url payload>.<hex hmac>`. */
export function signUploadCursor(payload: UploadCursorPayload): string {
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = createHmac('sha256', getCursorSecret()).update(body).digest('hex');
  return `${body}.${sig}`;
}

/** Verify and decode a cursor. Returns `null` for tampered/unknown tokens. */
export function verifyUploadCursor(token: string): UploadCursorPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', getCursorSecret()).update(body).digest('hex');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(base64UrlDecode(body)) as UploadCursorPayload;
    if (
      typeof payload.documentId !== 'string' ||
      typeof payload.contentHash !== 'string' ||
      typeof payload.charOffset !== 'number' ||
      !Number.isInteger(payload.charOffset) ||
      payload.charOffset < 0
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// ============================================
// Ownership guard (plan §C4)
// ============================================

export type UploadAccessFailure = 'not_found' | 'forbidden' | 'hash_mismatch';

/**
 * Load a document and enforce ownership. Returns the document or a failure
 * reason. `userId` is the email string stored in `upload_documents.user_id`.
 */
export async function getAccessibleUploadDocument(
  documentId: string,
  threadId: string,
  userId: string
): Promise<{ document: UploadDocument } | { failure: UploadAccessFailure }> {
  const document = await getUploadDocumentById(documentId);
  if (!document) return { failure: 'not_found' };
  if (document.thread_id !== threadId || document.user_id !== userId) {
    return { failure: 'forbidden' };
  }
  return { document };
}

// ============================================
// Search (kb_search scope='uploads' backend)
// ============================================

export interface UploadSearchHit {
  documentId: string;
  documentName: string;
  seq: number;
  pageStart: number;
  pageEnd: number;
  charStart: number;
  charEnd: number;
  text: string;
  score: number;
}

export interface SearchUploadSectionsInput {
  threadId: string;
  userId: string;
  query: string;
  topK?: number;
  /** Restrict hits to a single document (kb_search `document_id`). */
  documentId?: string;
}

/**
 * Semantic search over a thread's upload sections. Filtered on
 * `threadId`+`userId` payload fields server-side (Qdrant filter), so results
 * can never leak across threads or users.
 */
export async function searchUploadSections(
  input: SearchUploadSectionsInput
): Promise<UploadSearchHit[]> {
  const { threadId, userId, query, topK = 8, documentId } = input;
  if (!query.trim()) return [];

  const collection = uploadCollectionName(threadId);
  const store = await getVectorStore();
  if (!(await store.collectionExists(collection))) return [];

  const { createEmbeddings: embed } = await import('./openai');
  const [queryEmbedding] = await embed([query]);
  if (!queryEmbedding || queryEmbedding.length === 0) return [];

  // The vector-store adapter accepts flat filters and converts them to the
  // provider's native format. Do not pass an already-converted Qdrant filter.
  const filter: Record<string, unknown> = { threadId, userId };
  if (documentId) {
    filter.documentId = documentId;
  }

  const results = await store.query(
    collection,
    queryEmbedding,
    topK,
    filter
  );

  // Hydrate authoritative ranges from durable source rows. This also fixes
  // provenance for existing vectors, without requiring a re-index, and drops
  // stale vectors whose source has been deleted or is no longer accessible.
  const sourceSections = new Map<string, Map<number, UploadSection>>();
  for (const id of new Set(results.metadatas.map(meta => meta?.documentId).filter(Boolean))) {
    const access = await getAccessibleUploadDocument(id, threadId, userId);
    if ('failure' in access || (documentId && id !== documentId)) continue;
    const rows = await getSectionsByDocument(id);
    sourceSections.set(id, new Map(rows.map(section => [section.seq, section])));
  }

  const hits: UploadSearchHit[] = [];
  for (let i = 0; i < results.ids.length; i++) {
    const meta = results.metadatas[i];
    if (!meta) continue;
    const section = sourceSections.get(meta.documentId)?.get(meta.chunkIndex);
    if (!section) continue;
    hits.push({
      documentId: meta.documentId,
      documentName: meta.documentName,
      seq: meta.chunkIndex,
      pageStart: section.page_start,
      pageEnd: section.page_end,
      charStart: section.char_start,
      charEnd: section.char_end,
      text: section.text,
      score: results.scores[i] ?? 0,
    });
  }
  return hits;
}

// ============================================
// Read (kb_read uploads backend)
// ============================================

export interface ReadUploadSectionsInput {
  threadId: string;
  userId: string;
  documentId: string;
  /** Cursor from a previous read (resumability). */
  cursor?: string;
  /** Fresh-read filters (ignored when a cursor is supplied). */
  pageStart?: number;
  pageEnd?: number;
  fromChar?: number;
  /** Approximate character budget for the returned text. */
  maxChars?: number;
}

export interface ReadUploadSectionsResult {
  documentId: string;
  documentName: string;
  contentHash: string;
  status: UploadDocument['status'];
  pageCount: number | null;
  sections: Array<{
    seq: number;
    page_start: number;
    page_end: number;
    char_start: number;
    char_end: number;
    extract_status: string;
    text: string;
  }>;
  /** Signed cursor to resume after the last returned section, or null. */
  next: { cursor: string } | null;
}

const DEFAULT_READ_MAX_CHARS = 24000;

/**
 * Deterministic range read over `upload_sections` with signed-cursor
 * resumability. Cursors embed the document's `content_hash`; replaying a
 * cursor after the file changed returns `hash_mismatch` instead of stale text.
 */
export async function readUploadSections(
  input: ReadUploadSectionsInput
): Promise<{ result: ReadUploadSectionsResult } | { failure: UploadAccessFailure }> {
  const { threadId, userId, documentId } = input;

  const access = await getAccessibleUploadDocument(documentId, threadId, userId);
  if ('failure' in access) return access;
  const document = access.document;

  // Cursor path: hash-bound continuation.
  let charOffset: number | undefined;
  if (input.cursor) {
    const payload = verifyUploadCursor(input.cursor);
    if (!payload || payload.documentId !== documentId) return { failure: 'forbidden' };
    if (payload.contentHash !== document.content_hash) {
      return { failure: 'hash_mismatch' };
    }
    charOffset = payload.charOffset;
  }

  let sections: UploadSection[];
  if (charOffset !== undefined) {
    // Cursor continuation: start strictly AFTER the last returned section.
    // getSectionsByCharRange uses inclusive-overlap predicates (char_end >=
    // charOffset), which would re-include the section that ends exactly at
    // charOffset — the section the previous read already returned — producing
    // an identical cursor and an infinite loop. Filter to sections that BEGIN
    // at or after the offset instead (sections are non-overlapping).
    const overlapped = await getSectionsByCharRange(
      documentId,
      charOffset,
      Number.MAX_SAFE_INTEGER
    );
    sections = overlapped.filter((s) => s.char_start >= charOffset);
  } else if (
    input.pageStart !== undefined ||
    input.pageEnd !== undefined
  ) {
    sections = await getSectionsByPageRange(
      documentId,
      input.pageStart ?? 1,
      input.pageEnd ?? Number.MAX_SAFE_INTEGER
    );
  } else if (input.fromChar !== undefined) {
    sections = await getSectionsByCharRange(
      documentId,
      input.fromChar,
      Number.MAX_SAFE_INTEGER
    );
  } else {
    sections = await getSectionsByDocument(documentId);
  }

  // Respect the char budget: stop at the section that crosses the limit so
  // the next cursor starts exactly at a section boundary.
  const maxChars = input.maxChars ?? DEFAULT_READ_MAX_CHARS;
  let used = 0;
  let included: UploadSection[] = [];
  for (const section of sections) {
    if (used > 0 && used + section.text.length > maxChars) break;
    included.push(section);
    used += section.text.length;
    if (used >= maxChars) break;
  }

  const last = included.length > 0 ? included[included.length - 1] : undefined;
  const consumedAll = included.length === sections.length;
  // Cursor must always ADVANCE: never re-issue an offset at or before the
  // incoming one (that would replay the same sections forever).
  const nextOffset = last ? last.char_end : undefined;
  const nextCursor = last && !consumedAll && nextOffset !== undefined && nextOffset > (charOffset ?? -1)
    ? signUploadCursor({
        documentId,
        contentHash: document.content_hash,
        charOffset: nextOffset,
      })
    : null;

  return {
    result: {
      documentId,
      documentName: document.filename,
      contentHash: document.content_hash,
      status: document.status,
      pageCount: document.page_count,
      sections: included.map((s) => ({
        seq: s.seq,
        page_start: s.page_start,
        page_end: s.page_end,
        char_start: s.char_start,
        char_end: s.char_end,
        extract_status: s.extract_status,
        text: s.text,
      })),
      next: nextCursor ? { cursor: nextCursor } : null,
    },
  };
}

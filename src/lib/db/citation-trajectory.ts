/**
 * Citation Trajectory Database Operations (PostgreSQL)
 *
 * Tracks the full retrieval path for each chunk: raw vector score → reranker score → final selection.
 * Enables the Citation Trajectory UI to show why each chunk was or wasn't included in context.
 *
 * Supports multiple source types:
 * - 'vector': Knowledge base chunks with vector scores and reranker scores
 * - 'user_upload': User-uploaded documents (PDF, DOCX, images via OCR)
 * - 'web': Web search results from Tavily (no vector/reranker scores)
 */

import { getDb } from './kysely';
import type { DB } from './db-types';
import { sql } from 'kysely';

// ============ Types ============

export type TrajectorySourceType = 'vector' | 'graph' | 'user_upload' | 'web';

export interface CitationTrajectoryEntry {
  id: number;
  messageId: string;
  threadId: string;
  chunkId: string;
  documentName: string;
  pageNumber: number;
  rawScore: number | null;       // Cosine similarity from vector search
  rerankedScore: number | null;  // Score after reranker
  wasSelected: boolean;          // 1 = made it into final context
  rankBefore: number | null;     // Position before reranking
  rankAfter: number | null;      // Position after reranking
  sourceType: TrajectorySourceType; // Origin of this source
  createdAt: string | null;
}

export interface TrajectorySummary {
  totalChunksRetrieved: number;
  chunksPassedThreshold: number;
  chunksInFinalContext: number;
  documentCount: number;
  entries: CitationTrajectoryEntry[];
}

// ============ CRUD Operations ============

/**
 * Save a batch of citation trajectory entries
 */
export async function saveTrajectoryEntries(
  entries: Array<{
    messageId: string;
    threadId: string;
    chunkId: string;
    documentName: string;
    pageNumber: number;
    rawScore: number | null;
    rerankedScore: number | null;
    wasSelected: boolean;
    rankBefore: number | null;
    rankAfter: number | null;
    sourceType?: TrajectorySourceType; // Defaults to 'vector' if not specified
  }>
): Promise<void> {
  if (entries.length === 0) return;

  const db = await getDb();
  
  // Insert entries in batches to avoid hitting PostgreSQL limits
  const batchSize = 1000;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    
    await db.insertInto('citation_trajectories')
      .values(batch.map(row => ({
        message_id: row.messageId,
        thread_id: row.threadId,
        chunk_id: row.chunkId,
        document_name: row.documentName,
        page_number: row.pageNumber,
        raw_score: row.rawScore,
        reranked_score: row.rerankedScore,
        was_selected: row.wasSelected ? 1 : 0,
        rank_before: row.rankBefore,
        rank_after: row.rankAfter,
        source_type: row.sourceType || 'vector'
      })))
      .execute();
  }
}

/**
 * Get trajectory entries for a specific message
 */
export async function getTrajectoryForMessage(
  messageId: string,
  threadId: string
): Promise<CitationTrajectoryEntry[]> {
  const db = await getDb();
  
  const rows = await db.selectFrom('citation_trajectories')
    .selectAll()
    .where('message_id', '=', messageId)
    .where('thread_id', '=', threadId)
    .orderBy(sql`CASE source_type WHEN 'web' THEN 0 ELSE 1 END`)
    .orderBy('rank_after', 'asc')
    .orderBy('rank_before', 'asc')
    .execute();

  return rows.map(row => ({
    id: row.id,
    messageId: row.message_id,
    threadId: row.thread_id,
    chunkId: row.chunk_id,
    documentName: row.document_name,
    pageNumber: row.page_number,
    rawScore: row.raw_score,
    rerankedScore: row.reranked_score,
    wasSelected: row.was_selected === 1,
    rankBefore: row.rank_before,
    rankAfter: row.rank_after,
    sourceType: (row.source_type as TrajectorySourceType) || 'vector',
    createdAt: row.created_at
      ? new Date(row.created_at as unknown as string | Date).toISOString()
      : null,
  }));
}

/**
 * Get a summary of the trajectory for a message
 */
export async function getTrajectorySummary(
  messageId: string,
  threadId: string
): Promise<TrajectorySummary> {
  const entries = await getTrajectoryForMessage(messageId, threadId);

  const uniqueDocs = new Set(entries.map(e => e.documentName));
  const selected = entries.filter(e => e.wasSelected);

  return {
    totalChunksRetrieved: entries.length,
    chunksPassedThreshold: entries.filter(e => e.rerankedScore !== null || e.rawScore !== null).length,
    chunksInFinalContext: selected.length,
    documentCount: uniqueDocs.size,
    entries,
  };
}

/**
 * Clean up old trajectory entries (keep recent N per thread, independently per thread)
 */
export async function cleanupOldTrajectories(keepRecent: number = 100): Promise<number> {
  const db = await getDb();

  // Find all threads that have more entries than the limit
  const threadRows = await db.selectFrom('citation_trajectories')
    .select('thread_id')
    .groupBy('thread_id')
    .having(eb => eb.fn.count('id'), '>', keepRecent)
    .execute();

  if (threadRows.length === 0) {
    return 0;
  }

  let totalDeleted = 0;

  // For each over-limit thread, keep only the N most recent entries
  for (const { thread_id } of threadRows) {
    const idsToKeep = await db.selectFrom('citation_trajectories')
      .select('id')
      .where('thread_id', '=', thread_id)
      .orderBy('created_at', 'desc')
      .limit(keepRecent)
      .execute();

    const keepIds = idsToKeep.map(r => r.id);

    const result = await db.deleteFrom('citation_trajectories')
      .where('thread_id', '=', thread_id)
      .where('id', 'not in', keepIds)
      .execute();

    totalDeleted += result.length;
  }

  return totalDeleted;
}

/**
 * Delete trajectory entries for a thread
 */
export async function deleteThreadTrajectories(threadId: string): Promise<number> {
  const db = await getDb();
  const result = await db.deleteFrom('citation_trajectories')
    .where('thread_id', '=', threadId)
    .execute();
  return result.length;
}

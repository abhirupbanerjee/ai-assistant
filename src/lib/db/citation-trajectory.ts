/**
 * Citation Trajectory Database Operations
 *
 * Tracks the full retrieval path for each chunk: raw vector score → reranker score → final selection.
 * Enables the Citation Trajectory UI to show why each chunk was or wasn't included in context.
 *
 * Supports multiple source types:
 * - 'vector': Knowledge base chunks with vector scores and reranker scores
 * - 'user_upload': User-uploaded documents (PDF, DOCX, images via OCR)
 * - 'web': Web search results from Tavily (no vector/reranker scores)
 */

import { getDatabase } from './index';

// ============ Types ============

export type TrajectorySourceType = 'vector' | 'user_upload' | 'web';

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
  createdAt: string;
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
export function saveTrajectoryEntries(
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
): void {
  if (entries.length === 0) return;

  const db = getDatabase();
  const insert = db.prepare(`
    INSERT INTO citation_trajectories (
      message_id, thread_id, chunk_id, document_name, page_number,
      raw_score, reranked_score, was_selected,
      rank_before, rank_after, source_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows: typeof entries) => {
    for (const row of rows) {
      insert.run(
        row.messageId,
        row.threadId,
        row.chunkId,
        row.documentName,
        row.pageNumber,
        row.rawScore,
        row.rerankedScore,
        row.wasSelected ? 1 : 0,
        row.rankBefore,
        row.rankAfter,
        row.sourceType || 'vector'
      );
    }
  });

  insertMany(entries);
}

/**
 * Get trajectory entries for a specific message
 */
export function getTrajectoryForMessage(
  messageId: string,
  threadId: string
): CitationTrajectoryEntry[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT
      id, message_id, thread_id, chunk_id, document_name, page_number,
      raw_score, reranked_score, was_selected,
      rank_before, rank_after, source_type, created_at
    FROM citation_trajectories
    WHERE message_id = ? AND thread_id = ?
    ORDER BY
      CASE source_type WHEN 'web' THEN 0 ELSE 1 END,
      rank_after ASC, rank_before ASC
  `).all(messageId, threadId) as Array<{
    id: number;
    message_id: string;
    thread_id: string;
    chunk_id: string;
    document_name: string;
    page_number: number;
    raw_score: number | null;
    reranked_score: number | null;
    was_selected: number;
    rank_before: number | null;
    rank_after: number | null;
    source_type: string;
    created_at: string;
  }>;

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
    createdAt: row.created_at,
  }));
}

/**
 * Get a summary of the trajectory for a message
 */
export function getTrajectorySummary(
  messageId: string,
  threadId: string
): TrajectorySummary {
  const entries = getTrajectoryForMessage(messageId, threadId);

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
 * Clean up old trajectory entries (keep recent N per thread)
 */
export function cleanupOldTrajectories(keepRecent: number = 100): number {
  const db = getDatabase();
  const result = db.prepare(`
    DELETE FROM citation_trajectories
    WHERE id NOT IN (
      SELECT id FROM citation_trajectories
      ORDER BY created_at DESC
      LIMIT ?
    )
  `).run(keepRecent);
  return result.changes;
}

/**
 * Delete trajectory entries for a thread
 */
export function deleteThreadTrajectories(threadId: string): number {
  const db = getDatabase();
  const result = db.prepare(
    'DELETE FROM citation_trajectories WHERE thread_id = ?'
  ).run(threadId);
  return result.changes;
}

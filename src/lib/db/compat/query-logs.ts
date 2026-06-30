/**
 * Query Logs & Retrieval Traces Database Operations
 *
 * Stores query logs and per-query retrieval traces for the Phase 3
 * query observer and graph-augmented RAG analytics.
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb } from '../kysely';
import { sql } from 'kysely';

// ============ Types ============

export interface QueryLogRecord {
  id?: number;
  query: string;
  category_slugs: string | null;
  graph_enabled: boolean;
  graph_skipped: boolean;
  skip_reason: string | null;
  latency_ms: number | null;
  created_at?: Date;
}

export interface RetrievalTraceRecord {
  id?: number;
  query_log_id: number;
  seed_entity_ids: string | null;
  ppr_top_entities: string | null;
  traversal_paths: string | null;
  graph_chunk_ids: string | null;
  final_chunk_ids: string | null;
  rerank_scores: string | null;
  created_at?: Date;
}

// ============ Query Logs ============

/**
 * Insert a query log entry. Returns the new row id.
 */
export async function insertQueryLog(log: QueryLogRecord): Promise<number> {
  const db = await getDb();
  const result = await db
    .insertInto('query_logs' as any)
    .values({
      query: log.query,
      category_slugs: log.category_slugs,
      graph_enabled: log.graph_enabled,
      graph_skipped: log.graph_skipped,
      skip_reason: log.skip_reason,
      latency_ms: log.latency_ms,
    } as any)
    .returning('id')
    .executeTakeFirstOrThrow();
  return (result as any).id as number;
}

/**
 * Get recent query logs for analytics.
 */
export async function getRecentQueryLogs(limit: number = 100): Promise<QueryLogRecord[]> {
  const db = await getDb();
  return db
    .selectFrom('query_logs' as any)
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute() as any;
}

// ============ Retrieval Traces ============

/**
 * Insert a retrieval trace linked to a query log.
 */
export async function insertRetrievalTrace(trace: RetrievalTraceRecord): Promise<number> {
  const db = await getDb();
  const result = await db
    .insertInto('retrieval_traces' as any)
    .values({
      query_log_id: trace.query_log_id,
      seed_entity_ids: trace.seed_entity_ids,
      ppr_top_entities: trace.ppr_top_entities,
      traversal_paths: trace.traversal_paths,
      graph_chunk_ids: trace.graph_chunk_ids,
      final_chunk_ids: trace.final_chunk_ids,
      rerank_scores: trace.rerank_scores,
    } as any)
    .returning('id')
    .executeTakeFirstOrThrow();
  return (result as any).id as number;
}

/**
 * Get retrieval traces for a query log.
 */
export async function getTracesForQuery(queryLogId: number): Promise<RetrievalTraceRecord[]> {
  const db = await getDb();
  return db
    .selectFrom('retrieval_traces' as any)
    .selectAll()
    .where('query_log_id', '=', queryLogId)
    .orderBy('created_at', 'asc')
    .execute() as any;
}

/**
 * Clean up old query logs and their traces (retention in days).
 */
export async function cleanupOldQueryLogs(retentionDays: number = 90): Promise<void> {
  const db = await getDb();
  await db
    .deleteFrom('query_logs' as any)
    .where('created_at', '<', sql`NOW() - INTERVAL '${sql.raw(String(retentionDays))} days'`)
    .execute();
}

// ============ Extraction Failures (Phase 2) ============

export interface ExtractionFailure {
  id?: number;
  qdrant_id: string;
  document_id: string;
  document_name: string | null;
  error: string;
  retry_count: number;
  max_retries: number;
  created_at?: Date;
  updated_at?: Date;
}

/**
 * Log a failed extraction attempt. Upserts by qdrant_id.
 */
export async function logExtractionFailure(
  qdrantId: string,
  documentId: string,
  documentName: string | null,
  error: string,
): Promise<void> {
  const db = await getDb();
  await db
    .insertInto('extraction_failures' as any)
    .values({
      qdrant_id: qdrantId,
      document_id: documentId,
      document_name: documentName,
      error,
      retry_count: 0,
      max_retries: 3,
    } as any)
    .onConflict((oc: any) =>
      oc.column('qdrant_id').doUpdateSet({
        error,
        retry_count: sql`extraction_failures.retry_count + 1`,
        updated_at: sql`NOW()`,
      })
    )
    .execute();
}

/**
 * Get paginated list of extraction failures.
 */
export async function getExtractionFailures(
  limit: number = 50,
  offset: number = 0,
): Promise<ExtractionFailure[]> {
  const db = await getDb();
  return db
    .selectFrom('extraction_failures' as any)
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute() as any;
}

/**
 * Clear a single extraction failure record.
 */
export async function clearExtractionFailure(qdrantId: string): Promise<void> {
  const db = await getDb();
  await db
    .deleteFrom('extraction_failures' as any)
    .where('qdrant_id', '=', qdrantId)
    .execute();
}

/**
 * Clear all extraction failure records.
 */
export async function clearAllExtractionFailures(): Promise<void> {
  const db = await getDb();
  await db.deleteFrom('extraction_failures' as any).execute();
}

/**
 * Delete extraction failure records whose document_id no longer exists
 * in the documents table. Returns the count of removed orphan records.
 *
 * Orphaned failures accumulate when documents are deleted without also
 * cleaning up their associated extraction_failures rows. These cause
 * noisy "[GraphFailures/reprocess] Document X not found" warnings in
 * the admin reprocessing UI.
 */
export async function cleanupOrphanedExtractionFailures(): Promise<number> {
  const db = await getDb();
  const result = await db
    .deleteFrom('extraction_failures' as any)
    .where('document_id', 'not in',
      db.selectFrom('documents' as any).select('id')
    )
    .execute();
  // Kysely delete returns DeleteResult[] with numAffectedRows
  const count = Array.isArray(result) && result.length > 0
    ? Number((result[0] as any)?.numAffectedRows ?? 0)
    : 0;
  if (count > 0) {
    console.log(`[QueryLogs] Cleaned up ${count} orphaned extraction failure records`);
  }
  return count;
}

/**
 * Get failure statistics (counts).
 */
export async function getExtractionFailureStats(): Promise<{ total: number; maxRetryReached: number }> {
  const db = await getDb();
  const total = await db
    .selectFrom('extraction_failures' as any)
    .select(sql<number>`COUNT(*)`.as('count'))
    .executeTakeFirst() as any;

  const maxRetry = await db
    .selectFrom('extraction_failures' as any)
    .select(sql<number>`COUNT(*)`.as('count'))
    .where('retry_count', '>=', sql`max_retries`)
    .executeTakeFirst() as any;

  return {
    total: total?.count ?? 0,
    maxRetryReached: maxRetry?.count ?? 0,
  };
}

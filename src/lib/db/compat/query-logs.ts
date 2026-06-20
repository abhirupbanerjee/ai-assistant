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

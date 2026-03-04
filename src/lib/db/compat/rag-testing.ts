/**
 * RAG Testing Compatibility Layer
 *
 * Provides async interface for RAG testing operations.
 * Supports both SQLite and PostgreSQL.
 */

import { getDb } from '../kysely';

// Re-export types
export type {
  RagTestQuery,
  RagTestResult,
  TopChunk,
  RagTestMetrics,
} from '../rag-testing';

import type { RagTestQuery, RagTestResult, TopChunk, RagTestMetrics } from '../rag-testing';

// ============ Row Mappers ============

interface PgRagTestQueryRow {
  id: number;
  name: string;
  query: string;
  category_ids: string | null;
  created_by: string;
  created_at: string | Date;
}

interface PgRagTestResultRow {
  id: number;
  query_id: number | null;
  test_query: string;
  settings_snapshot: string;
  chunks_retrieved: number;
  avg_similarity: number;
  latency_ms: number;
  top_chunks: string | null;
  created_by: string;
  created_at: string | Date;
}

function mapPgToRagTestQuery(row: PgRagTestQueryRow): RagTestQuery {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    categoryIds: row.category_ids ? JSON.parse(row.category_ids) : null,
    createdBy: row.created_by,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function mapPgToRagTestResult(row: PgRagTestResultRow): RagTestResult {
  return {
    id: row.id,
    queryId: row.query_id,
    testQuery: row.test_query,
    settingsSnapshot: JSON.parse(row.settings_snapshot),
    chunksRetrieved: row.chunks_retrieved,
    avgSimilarity: row.avg_similarity,
    latencyMs: row.latency_ms,
    topChunks: row.top_chunks ? JSON.parse(row.top_chunks) : [],
    createdBy: row.created_by,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

// ============ Test Queries ============

export async function createTestQuery(
  name: string,
  query: string,
  categoryIds: number[] | null,
  createdBy: string
): Promise<number> {
  const db = await getDb();
  const result = await db
    .insertInto('rag_test_queries')
    .values({
      name,
      query,
      category_ids: categoryIds ? JSON.stringify(categoryIds) : null,
      created_by: createdBy,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return result.id;
}

export async function getAllTestQueries(): Promise<RagTestQuery[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('rag_test_queries')
    .selectAll()
    .orderBy('created_at', 'desc')
    .execute();

  return rows.map(r => mapPgToRagTestQuery(r as unknown as PgRagTestQueryRow));
}

export async function getTestQueryById(id: number): Promise<RagTestQuery | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('rag_test_queries')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? mapPgToRagTestQuery(row as unknown as PgRagTestQueryRow) : null;
}

export async function deleteTestQuery(id: number): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('rag_test_queries')
    .where('id', '=', id)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0) > 0;
}

// ============ Test Results ============

export async function saveTestResult(
  queryId: number | null,
  testQuery: string,
  settings: Record<string, unknown>,
  metrics: RagTestMetrics,
  topChunks: TopChunk[],
  createdBy: string
): Promise<number> {
  const db = await getDb();
  const result = await db
    .insertInto('rag_test_results')
    .values({
      query_id: queryId,
      test_query: testQuery,
      settings_snapshot: JSON.stringify(settings),
      chunks_retrieved: metrics.chunksRetrieved,
      avg_similarity: metrics.avgSimilarity,
      latency_ms: metrics.latencyMs,
      top_chunks: JSON.stringify(topChunks),
      created_by: createdBy,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return result.id;
}

export async function getRecentResults(limit = 20): Promise<RagTestResult[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('rag_test_results')
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map(r => mapPgToRagTestResult(r as unknown as PgRagTestResultRow));
}

export async function getResultsForQuery(queryId: number, limit = 10): Promise<RagTestResult[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('rag_test_results')
    .selectAll()
    .where('query_id', '=', queryId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map(r => mapPgToRagTestResult(r as unknown as PgRagTestResultRow));
}

export async function cleanupOldResults(keepRecent = 100): Promise<number> {
  const db = await getDb();
  const toKeep = await db
    .selectFrom('rag_test_results')
    .select('id')
    .orderBy('created_at', 'desc')
    .limit(keepRecent)
    .execute();

  if (toKeep.length === 0) return 0;

  const keepIds = toKeep.map(r => r.id);
  const result = await db
    .deleteFrom('rag_test_results')
    .where('id', 'not in', keepIds)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0);
}

export async function getTestStats(): Promise<{
  totalTests: number;
  avgLatency: number;
  avgChunksRetrieved: number;
  avgSimilarity: number;
}> {
  const db = await getDb();
  const row = await db
    .selectFrom('rag_test_results')
    .select([
      db.fn.count<number>('id').as('total_tests'),
      db.fn.avg<number>('latency_ms').as('avg_latency'),
      db.fn.avg<number>('chunks_retrieved').as('avg_chunks'),
      db.fn.avg<number>('avg_similarity').as('avg_sim'),
    ])
    .executeTakeFirst();

  return {
    totalTests: Number(row?.total_tests ?? 0),
    avgLatency: Math.round(Number(row?.avg_latency ?? 0)),
    avgChunksRetrieved: Math.round(Number(row?.avg_chunks ?? 0) * 10) / 10,
    avgSimilarity: Math.round(Number(row?.avg_sim ?? 0) * 10000) / 10000,
  };
}

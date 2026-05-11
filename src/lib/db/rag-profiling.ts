/**
 * RAG Profiling Database Operations
 *
 * Provides aggregate query functions for the RAG Profiling Dashboard.
 * All data comes from the existing rag_test_results table.
 */

import { getDatabase } from './index';

// ============ Types ============

export interface DailyTrend {
  date: string;
  avgLatency: number;
  avgSimilarity: number;
  avgChunks: number;
  testCount: number;
}

export interface KpiSummary {
  current: {
    avgLatency: number;
    avgSimilarity: number;
    avgChunks: number;
    totalTests: number;
  };
  prior: {
    avgLatency: number;
    avgSimilarity: number;
    avgChunks: number;
    totalTests: number;
  };
  deltas: {
    latencyDelta: number;   // positive = slower (bad)
    similarityDelta: number; // positive = better (good)
    chunksDelta: number;
    testCountDelta: number;
  };
}

export interface HourlyDistribution {
  hour: number;
  testCount: number;
  avgLatency: number;
}

export interface SettingsImpact {
  label: string;
  avgLatency: number;
  avgSimilarity: number;
  avgChunks: number;
  testCount: number;
  similarityThreshold?: number;
  topKChunks?: number;
  maxContextChunks?: number;
}

export interface BatchSuite {
  id: number;
  name: string;
  queryCount: number;
  avgLatency: number;
  avgSimilarity: number;
  avgChunks: number;
  createdBy: string;
  createdAt: string;
}

export interface BatchSuiteDetail {
  id: number;
  name: string;
  queries: Array<{
    query: string;
    chunksRetrieved: number;
    avgSimilarity: number;
    latencyMs: number;
  }>;
  createdBy: string;
  createdAt: string;
}

// ============ Trend Data ============

/**
 * Get daily-aggregated metrics for trend charts
 */
export function getTrendData(days = 30): DailyTrend[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT
      DATE(created_at) as date,
      AVG(latency_ms) as avg_latency,
      AVG(avg_similarity) as avg_similarity,
      AVG(chunks_retrieved) as avg_chunks,
      COUNT(*) as test_count
    FROM rag_test_results
    WHERE created_at >= datetime('now', ?)
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all(`-${days} days`) as Array<{
    date: string;
    avg_latency: number | null;
    avg_similarity: number | null;
    avg_chunks: number | null;
    test_count: number;
  }>;

  return rows.map((row) => ({
    date: row.date,
    avgLatency: Math.round(row.avg_latency ?? 0),
    avgSimilarity: Math.round((row.avg_similarity ?? 0) * 10000) / 10000,
    avgChunks: Math.round((row.avg_chunks ?? 0) * 10) / 10,
    testCount: row.test_count,
  }));
}

// ============ KPI Summary ============

/**
 * Get current and prior-period KPI summary with deltas
 */
export function getKpiSummary(): KpiSummary {
  const db = getDatabase();

  // Current period (last 7 days)
  const current = db.prepare(`
    SELECT
      COUNT(*) as total_tests,
      AVG(latency_ms) as avg_latency,
      AVG(avg_similarity) as avg_similarity,
      AVG(chunks_retrieved) as avg_chunks
    FROM rag_test_results
    WHERE created_at >= datetime('now', '-7 days')
  `).get() as {
    total_tests: number;
    avg_latency: number | null;
    avg_similarity: number | null;
    avg_chunks: number | null;
  };

  // Prior period (14-7 days ago)
  const prior = db.prepare(`
    SELECT
      COUNT(*) as total_tests,
      AVG(latency_ms) as avg_latency,
      AVG(avg_similarity) as avg_similarity,
      AVG(chunks_retrieved) as avg_chunks
    FROM rag_test_results
    WHERE created_at >= datetime('now', '-14 days')
      AND created_at < datetime('now', '-7 days')
  `).get() as {
    total_tests: number;
    avg_latency: number | null;
    avg_similarity: number | null;
    avg_chunks: number | null;
  };

  const currentLatency = Math.round(current.avg_latency ?? 0);
  const priorLatency = Math.round(prior.avg_latency ?? 0);
  const currentSimilarity = Math.round((current.avg_similarity ?? 0) * 10000) / 10000;
  const priorSimilarity = Math.round((prior.avg_similarity ?? 0) * 10000) / 10000;
  const currentChunks = Math.round((current.avg_chunks ?? 0) * 10) / 10;
  const priorChunks = Math.round((prior.avg_chunks ?? 0) * 10) / 10;

  return {
    current: {
      avgLatency: currentLatency,
      avgSimilarity: currentSimilarity,
      avgChunks: currentChunks,
      totalTests: current.total_tests,
    },
    prior: {
      avgLatency: priorLatency,
      avgSimilarity: priorSimilarity,
      avgChunks: priorChunks,
      totalTests: prior.total_tests,
    },
    deltas: {
      latencyDelta: priorLatency > 0
        ? Math.round(((currentLatency - priorLatency) / priorLatency) * 100)
        : 0,
      similarityDelta: priorSimilarity > 0
        ? Math.round(((currentSimilarity - priorSimilarity) / priorSimilarity) * 100)
        : 0,
      chunksDelta: priorChunks > 0
        ? Math.round(((currentChunks - priorChunks) / priorChunks) * 100)
        : 0,
      testCountDelta: prior.total_tests > 0
        ? Math.round(((current.total_tests - prior.total_tests) / prior.total_tests) * 100)
        : 0,
    },
  };
}

// ============ Hourly Distribution ============

/**
 * Get test distribution by hour of day
 */
export function getHourlyDistribution(days = 7): HourlyDistribution[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT
      CAST(strftime('%H', created_at) AS INTEGER) as hour,
      COUNT(*) as test_count,
      AVG(latency_ms) as avg_latency
    FROM rag_test_results
    WHERE created_at >= datetime('now', ?)
    GROUP BY hour
    ORDER BY hour ASC
  `).all(`-${days} days`) as Array<{
    hour: number;
    test_count: number;
    avg_latency: number | null;
  }>;

  return rows.map((row) => ({
    hour: row.hour,
    testCount: row.test_count,
    avgLatency: Math.round(row.avg_latency ?? 0),
  }));
}

// ============ Settings Impact Analysis ============

/**
 * Group results by settings_snapshot to compare config performance
 */
export function getSettingsImpactAnalysis(): SettingsImpact[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT
      settings_snapshot,
      COUNT(*) as test_count,
      AVG(latency_ms) as avg_latency,
      AVG(avg_similarity) as avg_similarity,
      AVG(chunks_retrieved) as avg_chunks
    FROM rag_test_results
    GROUP BY settings_snapshot
    HAVING test_count >= 2
    ORDER BY avg_similarity DESC
    LIMIT 10
  `).all() as Array<{
    settings_snapshot: string;
    test_count: number;
    avg_latency: number | null;
    avg_similarity: number | null;
    avg_chunks: number | null;
  }>;

  return rows.map((row) => {
    let label = 'Default';
    let similarityThreshold: number | undefined;
    let topKChunks: number | undefined;
    let maxContextChunks: number | undefined;
    try {
      const settings = JSON.parse(row.settings_snapshot);
      const parts: string[] = [];
      if (settings.similarityThreshold != null) {
        similarityThreshold = settings.similarityThreshold;
        parts.push(`sim=${settings.similarityThreshold}`);
      }
      if (settings.topKChunks != null) {
        topKChunks = settings.topKChunks;
        parts.push(`topK=${settings.topKChunks}`);
      }
      if (settings.maxContextChunks != null) {
        maxContextChunks = settings.maxContextChunks;
        parts.push(`ctx=${settings.maxContextChunks}`);
      }
      if (parts.length > 0) label = parts.join(', ');
    } catch {
      label = 'Unknown';
    }

    return {
      label,
      avgLatency: Math.round(row.avg_latency ?? 0),
      avgSimilarity: Math.round((row.avg_similarity ?? 0) * 10000) / 10000,
      avgChunks: Math.round((row.avg_chunks ?? 0) * 10) / 10,
      testCount: row.test_count,
      similarityThreshold,
      topKChunks,
      maxContextChunks,
    };
  });
}

// ============ Batch Suite Operations ============

/**
 * Save a batch suite run
 */
export function saveBatchSuite(
  name: string,
  queries: Array<{ query: string; chunksRetrieved: number; avgSimilarity: number; latencyMs: number }>,
  createdBy: string
): number {
  const db = getDatabase();
  const avgLatency = Math.round(queries.reduce((s, q) => s + q.latencyMs, 0) / queries.length);
  const avgSimilarity = queries.reduce((s, q) => s + q.avgSimilarity, 0) / queries.length;
  const avgChunks = queries.reduce((s, q) => s + q.chunksRetrieved, 0) / queries.length;

  const result = db.prepare(`
    INSERT INTO rag_batch_suites (name, query_count, avg_latency, avg_similarity, avg_chunks, queries_json, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    queries.length,
    avgLatency,
    avgSimilarity,
    avgChunks,
    JSON.stringify(queries),
    createdBy
  );
  return result.lastInsertRowid as number;
}

/**
 * Get recent batch suites
 */
export function getBatchSuites(limit = 10): BatchSuite[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, name, query_count, avg_latency, avg_similarity, avg_chunks, created_by, created_at
    FROM rag_batch_suites
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number;
    name: string;
    query_count: number;
    avg_latency: number;
    avg_similarity: number;
    avg_chunks: number;
    created_by: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    queryCount: row.query_count,
    avgLatency: row.avg_latency,
    avgSimilarity: row.avg_similarity,
    avgChunks: row.avg_chunks,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}

/**
 * Get a batch suite with full query details
 */
export function getBatchSuiteDetail(id: number): BatchSuiteDetail | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id, name, queries_json, created_by, created_at
    FROM rag_batch_suites
    WHERE id = ?
  `).get(id) as {
    id: number;
    name: string;
    queries_json: string;
    created_by: string;
    created_at: string;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    queries: JSON.parse(row.queries_json),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * Delete old batch suites (keep recent N)
 */
export function cleanupBatchSuites(keepRecent = 20): number {
  const db = getDatabase();
  const result = db.prepare(`
    DELETE FROM rag_batch_suites
    WHERE id NOT IN (
      SELECT id FROM rag_batch_suites
      ORDER BY created_at DESC
      LIMIT ?
    )
  `).run(keepRecent);
  return result.changes;
}

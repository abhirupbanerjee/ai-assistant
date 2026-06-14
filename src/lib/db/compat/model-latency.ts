/**
 * Model Latency Log — Async Compatibility Layer
 *
 * Tracks per-model latency for the Auto model selection system.
 * Mirrors the token-usage.ts compat pattern.
 */

import { getDb } from '../kysely';
import { sql } from 'kysely';

// ============ Types ============

export interface ModelLatencyEntry {
  modelId: string;
  latencyMs: number;
  success: 0 | 1;
  outputTokens?: number | null;
  errorType?: string | null;
}

// ============ Write ============

/**
 * Insert a latency record for a model completion.
 * Called from the fire-and-forget wrapper — never on the hot path.
 */
export async function logModelLatency(entry: ModelLatencyEntry): Promise<void> {
  const db = await getDb();
  await db.insertInto('model_latency_log').values({
    model_id: entry.modelId,
    latency_ms: Math.round(entry.latencyMs),
    output_tokens: entry.outputTokens ?? null,
    success: entry.success,
    error_type: entry.errorType ?? null,
  }).execute();
}

// ============ Read ============

/**
 * Get the rolling P50 latency for a single model over a time window.
 * Returns null when no successful completions exist in the window.
 */
export async function getModelP50Latency(
  modelId: string,
  windowHours = 24,
): Promise<number | null> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const result = await sql<{ p50: number | null }>`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50
    FROM model_latency_log
    WHERE model_id = ${modelId}
      AND success = 1
      AND created_at > ${cutoff}
  `.execute(db);

  const val = result.rows[0]?.p50;
  return val != null ? Number(val) : null;
}

/**
 * Batch P50 for ALL models in one query — used by the Auto selector
 * to avoid N round-trips.
 *
 * Returns { modelId: p50Ms } for models with successful completions
 * in the window. Models with no data are absent from the result.
 */
export async function getAllModelP50Latencies(
  windowHours = 24,
): Promise<Record<string, number>> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const result = await sql<{ model_id: string; p50: number }>`
    SELECT model_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50
    FROM model_latency_log
    WHERE success = 1
      AND created_at > ${cutoff}
    GROUP BY model_id
  `.execute(db);

  const out: Record<string, number> = {};
  for (const row of result.rows) {
    if (row.model_id && row.p50 != null) {
      out[row.model_id] = Number(row.p50);
    }
  }
  return out;
}

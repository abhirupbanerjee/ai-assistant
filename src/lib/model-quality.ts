/**
 * Model Quality Scoring from Feedback
 *
 * Combines user feedback satisfaction with latency and cost data
 * to produce a composite quality signal for the Auto model selector.
 *
 * Scores are cached in-memory with a 5-minute TTL — feedback data
 * changes slowly so frequent recalculation is wasteful.
 */

import { getModelFeedbackStats } from '@/lib/db/compat/evolved-kb';
import { getAllModelP50Latencies } from '@/lib/db/compat/model-latency';
import { getActiveModels } from '@/lib/db/compat/enabled-models';

// ============ Types ============

export interface ModelQualityScore {
  modelId: string;
  /** User satisfaction rate from thumbs-up/down feedback (0..1, defaults 0.5) */
  satisfaction: number;
  /** P50 latency in ms (null if no data) */
  avgLatencyMs: number | null;
  /** Input cost per 1M tokens (null if unknown) */
  inputCostPer1M: number | null;
}

// ============ Cache ============

/** Minimum feedback ratings before trusting satisfaction score. Below this, use neutral 0.5. */
const MIN_RATINGS_FOR_TRUST = 3;

let cachedScores: Map<string, ModelQualityScore> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============ Public API ============

/**
 * Get quality scores for all active models, combining feedback satisfaction
 * with latency and cost data already tracked by the system.
 * Results are cached for 5 minutes.
 */
export async function getModelQualityScores(): Promise<Map<string, ModelQualityScore>> {
  if (cachedScores && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedScores;
  }
  cachedScores = await computeModelQualityScores();
  cacheTimestamp = Date.now();
  return cachedScores;
}

/**
 * Force-refresh the quality score cache.
 * Called when models are added/removed/enabled/disabled.
 */
export function invalidateQualityCache(): void {
  cachedScores = null;
  cacheTimestamp = 0;
}

// ============ Internal ============

async function computeModelQualityScores(): Promise<Map<string, ModelQualityScore>> {
  const [feedbackStats, latencies, models] = await Promise.all([
    getModelFeedbackStats(),
    getAllModelP50Latencies(),
    getActiveModels(),
  ]);

  const feedbackMap = new Map(feedbackStats.map(f => [f.modelId, f]));
  const result = new Map<string, ModelQualityScore>();

  for (const model of models) {
    const fb = feedbackMap.get(model.id);
    // Only trust feedback if we have enough ratings
    const satisfaction = (fb && fb.totalRatings >= MIN_RATINGS_FOR_TRUST)
      ? (fb.satisfactionRate ?? 0.5)
      : 0.5;

    result.set(model.id, {
      modelId: model.id,
      satisfaction,
      avgLatencyMs: latencies[model.id] ?? null,
      inputCostPer1M: model.inputCostPer1M ?? null,
    });
  }

  return result;
}

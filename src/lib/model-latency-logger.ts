/**
 * Model Latency Logger — Fire-and-forget wrapper
 *
 * Mirrors the token-logger.ts pattern: a `recordModelLatency()` function
 * that performs an async DB insert in a try/catch, never throws, and
 * never blocks the response path.
 */

import { logModelLatency } from './db/compat/model-latency';

export interface ModelLatencyContext {
  /** The model id that was used */
  modelId: string;
  /** Wall-clock time in milliseconds */
  latencyMs: number;
  /** Whether the completion succeeded */
  success: boolean;
  /** Output token count (optional, for normalized latency later) */
  outputTokens?: number | null;
  /** Error type classification (from isRecoverableApiError) */
  errorType?: string | null;
}

/**
 * Record a model latency measurement.
 *
 * Fire-and-forget: the insert runs asynchronously and any error is
 * silently logged to the console. This function never throws and
 * never adds latency to the response path.
 */
export function recordModelLatency(ctx: ModelLatencyContext): void {
  void logModelLatency({
    modelId: ctx.modelId,
    latencyMs: ctx.latencyMs,
    success: ctx.success ? 1 : 0,
    outputTokens: ctx.outputTokens ?? null,
    errorType: ctx.errorType ?? null,
  }).catch(err => {
    console.error('[ModelLatencyLogger] Failed to log latency:', err);
  });
}

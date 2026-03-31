/**
 * Token Usage Logger
 *
 * Fire-and-forget wrapper for logging LLM token usage.
 * Never blocks callers — errors are caught and logged silently.
 */

import { logTokenUsage } from './db/compat/token-usage';

export type UsageCategory = 'chat' | 'autonomous' | 'embeddings' | 'workspace';

export interface TokenUsageContext {
  userId?: number | null;
  category: UsageCategory;
  model: string;
  totalTokens: number;
  metadata?: Record<string, unknown>;
}

/**
 * Record token usage — fire-and-forget, adds zero latency to LLM call paths.
 */
export function recordTokenUsage(ctx: TokenUsageContext): void {
  if (!ctx.totalTokens || ctx.totalTokens <= 0) return;

  logTokenUsage({
    user_id: ctx.userId ?? null,
    category: ctx.category,
    model: ctx.model,
    total_tokens: ctx.totalTokens,
    metadata_json: ctx.metadata ? JSON.stringify(ctx.metadata) : null,
  }).catch((err) => {
    console.error('[TokenLogger] Failed to log usage:', err);
  });
}

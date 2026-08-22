/**
 * Token Usage Logger
 *
 * Fire-and-forget wrapper for logging LLM token usage.
 * Never blocks callers — errors are caught and logged silently.
 */

import { logTokenUsage } from './db/compat/token-usage';
import { getRequestContext } from './request-context';

export type UsageCategory = 'chat' | 'autonomous' | 'embeddings' | 'workspace';

export interface TokenUsageContext {
  userId?: number | null;
  category: UsageCategory;
  model: string;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  /**
   * Tenant organization that owns this usage row (AI & API Setup Redesign,
   * Decision 9). Absent → the request context org, else null (unattributed).
   */
  organizationId?: number | null;
  /**
   * Vault credential that served the request (BYOK cost attribution). Absent →
   * null (platform/legacy/unattributed). Never a raw key.
   */
  credentialId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Record token usage — fire-and-forget, adds zero latency to LLM call paths.
 *
 * `organization_id` and `credential_id` are stamped so usage is attributable to
 * a tenant and, for BYOK, to the exact vault credential (plan §9). The request
 * context is read synchronously (before the fire-and-forget promise) so the
 * AsyncLocalStorage value is still valid.
 */
export function recordTokenUsage(ctx: TokenUsageContext): void {
  if (!ctx.totalTokens || ctx.totalTokens <= 0) return;

  const requestOrgId = getRequestContext().organizationId;

  logTokenUsage({
    user_id: ctx.userId ?? null,
    category: ctx.category,
    model: ctx.model,
    total_tokens: ctx.totalTokens,
    input_tokens: ctx.inputTokens ?? null,
    output_tokens: ctx.outputTokens ?? null,
    metadata_json: ctx.metadata ? JSON.stringify(ctx.metadata) : null,
    organization_id: ctx.organizationId !== undefined
      ? ctx.organizationId
      : (requestOrgId ?? null),
    credential_id: ctx.credentialId ?? null,
  }).catch((err) => {
    console.error('[TokenLogger] Failed to log usage:', err);
  });
}

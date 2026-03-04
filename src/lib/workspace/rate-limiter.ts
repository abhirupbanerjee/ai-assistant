/**
 * Workspace Rate Limiter
 *
 * Rate limiting for embed mode workspaces.
 * Implements per-IP daily limits and per-session limits.
 */

import { getDb } from '../db/kysely';
import { sql } from 'kysely';
import { getWorkspaceById } from '../db/compat/workspaces';
import { getSessionMessageCount } from '../db/compat/workspace-sessions';
import type { RateLimitStatus } from '@/types/workspace';

// ============================================================================
// Constants
// ============================================================================

const RATE_LIMIT_WINDOW_HOURS = 24;

// ============================================================================
// Rate Limit Checking
// ============================================================================

/**
 * Check rate limit for a workspace request
 *
 * @param workspaceId - The workspace ID
 * @param ipHash - Hashed IP address
 * @param sessionId - Optional session ID for session-level limits
 * @returns Rate limit status
 */
export async function checkRateLimit(
  workspaceId: string,
  ipHash: string,
  sessionId?: string
): Promise<RateLimitStatus> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: null,
      daily_used: 0,
      daily_limit: 0,
      session_used: 0,
      session_limit: 0,
    };
  }

  // Get daily usage (last 24 hours)
  const dailyUsage = await getDailyUsage(workspaceId, ipHash);

  // Get session usage if session provided
  const sessionUsage = sessionId ? await getSessionMessageCount(sessionId) : 0;

  // Calculate reset time (24 hours from first request today)
  const resetAt = await getResetTime(workspaceId, ipHash);

  // Check limits
  const dailyLimitReached = dailyUsage >= workspace.daily_limit;
  const sessionLimitReached = sessionId
    ? sessionUsage >= workspace.session_limit
    : false;

  const allowed = !dailyLimitReached && !sessionLimitReached;
  const remaining = Math.max(
    0,
    Math.min(
      workspace.daily_limit - dailyUsage,
      sessionId ? workspace.session_limit - sessionUsage : Infinity
    )
  );

  return {
    allowed,
    remaining,
    resetAt,
    daily_used: dailyUsage,
    daily_limit: workspace.daily_limit,
    session_used: sessionUsage,
    session_limit: workspace.session_limit,
  };
}

/**
 * Increment rate limit counter
 */
export async function incrementRateLimit(workspaceId: string, ipHash: string): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setMinutes(0, 0, 0);
  const windowStartStr = windowStart.toISOString();

  const db = await getDb();

  // Try to update existing record
  const result = await db.updateTable('workspace_rate_limits')
    .set({ request_count: sql`request_count + 1` })
    .where('workspace_id', '=', workspaceId)
    .where('ip_hash', '=', ipHash)
    .where('window_start', '=', windowStartStr)
    .executeTakeFirst();

  if (result.numUpdatedRows === BigInt(0)) {
    // Insert new record
    await db.insertInto('workspace_rate_limits')
      .values({
        workspace_id: workspaceId,
        ip_hash: ipHash,
        window_start: windowStartStr,
        request_count: 1,
      })
      .execute();
  }
}

// ============================================================================
// Usage Queries
// ============================================================================

/**
 * Get daily usage for an IP (last 24 hours)
 */
async function getDailyUsage(workspaceId: string, ipHash: string): Promise<number> {
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const db = await getDb();
  const result = await db.selectFrom('workspace_rate_limits')
    .select(sql<number>`COALESCE(SUM(request_count), 0)`.as('total'))
    .where('workspace_id', '=', workspaceId)
    .where('ip_hash', '=', ipHash)
    .where('window_start', '>=', cutoff)
    .executeTakeFirst();

  return Number(result?.total) || 0;
}

/**
 * Get reset time (when the oldest window in the 24h period expires)
 */
async function getResetTime(workspaceId: string, ipHash: string): Promise<Date | null> {
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const db = await getDb();
  const result = await db.selectFrom('workspace_rate_limits')
    .select(sql<string>`MIN(window_start)`.as('oldest'))
    .where('workspace_id', '=', workspaceId)
    .where('ip_hash', '=', ipHash)
    .where('window_start', '>=', cutoff)
    .where('request_count', '>', 0)
    .executeTakeFirst();

  if (!result?.oldest) return null;

  // Reset time is 24 hours after the oldest window
  const resetTime = new Date(result.oldest);
  resetTime.setHours(resetTime.getHours() + RATE_LIMIT_WINDOW_HOURS);
  return resetTime;
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clean up old rate limit records
 * Call this periodically (e.g., daily) to remove expired records
 */
export async function cleanupOldRateLimits(): Promise<number> {
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const db = await getDb();
  const result = await db.deleteFrom('workspace_rate_limits')
    .where('window_start', '<', cutoff)
    .executeTakeFirst();

  return Number(result.numDeletedRows);
}

/**
 * Probabilistic cleanup (call on each request with low probability)
 */
export function maybeCleanupRateLimits(probability: number = 0.01): void {
  if (Math.random() < probability) {
    // Fire-and-forget
    cleanupOldRateLimits().catch(() => {});
  }
}

// ============================================================================
// Admin Functions
// ============================================================================

/**
 * Reset rate limits for a specific IP on a workspace
 */
export async function resetRateLimitsForIP(workspaceId: string, ipHash: string): Promise<number> {
  const db = await getDb();
  const result = await db.deleteFrom('workspace_rate_limits')
    .where('workspace_id', '=', workspaceId)
    .where('ip_hash', '=', ipHash)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

/**
 * Reset all rate limits for a workspace
 */
export async function resetWorkspaceRateLimits(workspaceId: string): Promise<number> {
  const db = await getDb();
  const result = await db.deleteFrom('workspace_rate_limits')
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

/**
 * Get rate limit statistics for a workspace
 */
export async function getWorkspaceRateLimitStats(workspaceId: string): Promise<{
  total_requests: number;
  unique_ips: number;
  top_ips: Array<{ ip_hash: string; count: number }>;
}> {
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const db = await getDb();

  const totals = await db.selectFrom('workspace_rate_limits')
    .select([
      sql<number>`COALESCE(SUM(request_count), 0)`.as('total'),
      db.fn.count('ip_hash').distinct().as('unique_ips'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('window_start', '>=', cutoff)
    .executeTakeFirst();

  const topIPs = await db.selectFrom('workspace_rate_limits')
    .select([
      'ip_hash',
      sql<number>`SUM(request_count)`.as('count'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('window_start', '>=', cutoff)
    .groupBy('ip_hash')
    .orderBy('count', 'desc')
    .limit(10)
    .execute();

  return {
    total_requests: Number(totals?.total) || 0,
    unique_ips: Number(totals?.unique_ips) || 0,
    top_ips: topIPs.map(row => ({
      ip_hash: row.ip_hash,
      count: Number(row.count) || 0,
    })),
  };
}

// ============================================================================
// Rate Limit Middleware Helper
// ============================================================================

/**
 * Check and increment rate limit in a single operation
 * Returns the rate limit status after incrementing
 */
export async function checkAndIncrementRateLimit(
  workspaceId: string,
  ipHash: string,
  sessionId?: string
): Promise<RateLimitStatus> {
  // Check first
  const status = await checkRateLimit(workspaceId, ipHash, sessionId);

  // If allowed, increment the counter
  if (status.allowed) {
    await incrementRateLimit(workspaceId, ipHash);
    status.remaining = Math.max(0, status.remaining - 1);
    status.daily_used += 1;
  }

  // Probabilistic cleanup
  maybeCleanupRateLimits(0.01);

  return status;
}

/**
 * Format rate limit headers for HTTP response
 */
export function getRateLimitHeaders(status: RateLimitStatus): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': status.daily_limit.toString(),
    'X-RateLimit-Remaining': status.remaining.toString(),
  };

  if (status.resetAt) {
    headers['X-RateLimit-Reset'] = Math.floor(status.resetAt.getTime() / 1000).toString();
  }

  if (!status.allowed) {
    headers['Retry-After'] = status.resetAt
      ? Math.max(0, Math.ceil((status.resetAt.getTime() - Date.now()) / 1000)).toString()
      : '3600';
  }

  return headers;
}

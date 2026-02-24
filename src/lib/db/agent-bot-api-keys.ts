/**
 * Agent Bot API Key Database Operations
 *
 * Handles API key generation, validation, revocation, and rate limiting
 * for agent bot authentication.
 */

import { randomBytes, createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, queryAll, queryOne, execute, transaction } from './index';
import type {
  AgentBotApiKey,
  AgentBotApiKeyWithStats,
  AgentBotApiKeyRow,
  CreateApiKeyResult,
  CreateApiKeyInput,
  RateLimitInfo,
  RateLimitCheckResult,
} from '@/types/agent-bot';

// ============================================================================
// Constants
// ============================================================================

const API_KEY_PREFIX = 'ab_pk_';
const API_KEY_LENGTH = 48; // Total length of the random part

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a secure random API key
 */
function generateApiKey(): string {
  const randomPart = randomBytes(36).toString('base64url').slice(0, API_KEY_LENGTH);
  return `${API_KEY_PREFIX}${randomPart}`;
}

/**
 * Hash an API key using SHA-256
 */
function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Extract the prefix from an API key (for lookup)
 */
function extractPrefix(key: string): string {
  // Return first 12 characters after the prefix for identification
  if (!key.startsWith(API_KEY_PREFIX)) return '';
  return key.slice(0, API_KEY_PREFIX.length + 8);
}

/**
 * Convert database row to AgentBotApiKey object
 */
function rowToApiKey(row: AgentBotApiKeyRow): AgentBotApiKey {
  return {
    id: row.id,
    agent_bot_id: row.agent_bot_id,
    name: row.name,
    key_prefix: row.key_prefix,
    key_hash: row.key_hash,
    permissions: JSON.parse(row.permissions),
    rate_limit_rpm: row.rate_limit_rpm,
    rate_limit_rpd: row.rate_limit_rpd,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    is_active: row.is_active === 1,
    created_by: row.created_by,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
  };
}

// ============================================================================
// API Key CRUD
// ============================================================================

/**
 * Get API key by ID
 */
export function getApiKeyById(id: string): AgentBotApiKey | null {
  const row = queryOne<AgentBotApiKeyRow>(
    'SELECT * FROM agent_bot_api_keys WHERE id = ?',
    [id]
  );
  return row ? rowToApiKey(row) : null;
}

/**
 * Get API key with usage stats
 */
export function getApiKeyWithStats(id: string): AgentBotApiKeyWithStats | null {
  const apiKey = getApiKeyById(id);
  if (!apiKey) return null;

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentHour = now.getUTCHours();

  // Get total requests
  const totalResult = queryOne<{ total: number }>(
    'SELECT SUM(request_count) as total FROM agent_bot_usage WHERE api_key_id = ?',
    [id]
  );

  // Get today's requests
  const todayResult = queryOne<{ today: number }>(
    'SELECT SUM(request_count) as today FROM agent_bot_usage WHERE api_key_id = ? AND date = ?',
    [id, today]
  );

  // Get this hour's requests
  const hourResult = queryOne<{ hour: number }>(
    'SELECT request_count as hour FROM agent_bot_usage WHERE api_key_id = ? AND date = ? AND hour = ?',
    [id, today, currentHour]
  );

  return {
    ...apiKey,
    total_requests: totalResult?.total || 0,
    requests_today: todayResult?.today || 0,
    requests_this_hour: hourResult?.hour || 0,
  };
}

/**
 * List API keys for an agent bot
 */
export function listApiKeys(agentBotId: string, includeRevoked = false): AgentBotApiKey[] {
  const sql = includeRevoked
    ? 'SELECT * FROM agent_bot_api_keys WHERE agent_bot_id = ? ORDER BY created_at DESC'
    : 'SELECT * FROM agent_bot_api_keys WHERE agent_bot_id = ? AND revoked_at IS NULL ORDER BY created_at DESC';

  const rows = queryAll<AgentBotApiKeyRow>(sql, [agentBotId]);
  return rows.map(rowToApiKey);
}

/**
 * Create a new API key
 * Returns both the API key record and the full key (only shown once)
 */
export function createApiKey(
  agentBotId: string,
  input: CreateApiKeyInput,
  createdBy: string
): CreateApiKeyResult {
  const id = uuidv4();
  const fullKey = generateApiKey();
  const keyHash = hashApiKey(fullKey);
  const keyPrefix = extractPrefix(fullKey);

  // Calculate expiration if provided
  let expiresAt: string | null = null;
  if (input.expires_in_days) {
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + input.expires_in_days);
    expiresAt = expireDate.toISOString();
  }

  execute(
    `INSERT INTO agent_bot_api_keys (
      id, agent_bot_id, name, key_prefix, key_hash, permissions,
      rate_limit_rpm, rate_limit_rpd, expires_at, is_active, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      id,
      agentBotId,
      input.name,
      keyPrefix,
      keyHash,
      JSON.stringify(['invoke']), // Default permission
      input.rate_limit_rpm ?? 60,
      input.rate_limit_rpd ?? 1000,
      expiresAt,
      createdBy,
    ]
  );

  const apiKey = getApiKeyById(id)!;

  return {
    apiKey,
    fullKey, // Only time the full key is available
  };
}

/**
 * Revoke an API key
 */
export function revokeApiKey(id: string): AgentBotApiKey | null {
  execute(
    `UPDATE agent_bot_api_keys
     SET is_active = 0, revoked_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [id]
  );
  return getApiKeyById(id);
}

/**
 * Delete an API key permanently
 */
export function deleteApiKey(id: string): boolean {
  const result = execute('DELETE FROM agent_bot_api_keys WHERE id = ?', [id]);
  return result.changes > 0;
}

/**
 * Update last used timestamp
 */
export function updateLastUsed(id: string): void {
  execute(
    'UPDATE agent_bot_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?',
    [id]
  );
}

// ============================================================================
// API Key Validation
// ============================================================================

/**
 * Validate an API key and return the key record if valid
 */
export function validateApiKey(fullKey: string): {
  valid: boolean;
  apiKey?: AgentBotApiKey;
  error?: string;
  errorCode?: string;
} {
  // Check format
  if (!fullKey.startsWith(API_KEY_PREFIX)) {
    return { valid: false, error: 'Invalid API key format', errorCode: 'INVALID_API_KEY' };
  }

  const keyHash = hashApiKey(fullKey);

  // Look up by hash
  const row = queryOne<AgentBotApiKeyRow>(
    'SELECT * FROM agent_bot_api_keys WHERE key_hash = ?',
    [keyHash]
  );

  if (!row) {
    return { valid: false, error: 'API key not found', errorCode: 'INVALID_API_KEY' };
  }

  const apiKey = rowToApiKey(row);

  // Check if revoked
  if (apiKey.revoked_at) {
    return { valid: false, error: 'API key has been revoked', errorCode: 'API_KEY_REVOKED' };
  }

  // Check if active
  if (!apiKey.is_active) {
    return { valid: false, error: 'API key is not active', errorCode: 'API_KEY_REVOKED' };
  }

  // Check expiration
  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return { valid: false, error: 'API key has expired', errorCode: 'API_KEY_EXPIRED' };
  }

  return { valid: true, apiKey };
}

/**
 * Get agent bot ID from API key
 */
export function getAgentBotIdFromApiKey(fullKey: string): string | null {
  const result = validateApiKey(fullKey);
  return result.valid && result.apiKey ? result.apiKey.agent_bot_id : null;
}

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Check and update rate limits for an API key
 */
export function checkRateLimit(apiKeyId: string): RateLimitCheckResult {
  const apiKey = getApiKeyById(apiKeyId);
  if (!apiKey) {
    return {
      allowed: false,
      info: {
        limitMinute: 0,
        remainingMinute: 0,
        limitDay: 0,
        remainingDay: 0,
        resetMinute: new Date(),
        resetDay: new Date(),
      },
      blockedReason: 'minute',
    };
  }

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentHour = now.getUTCHours();

  // Get or create usage record for this hour
  let usage = queryOne<{
    id: number;
    request_count: number;
  }>(
    'SELECT id, request_count FROM agent_bot_usage WHERE api_key_id = ? AND date = ? AND hour = ?',
    [apiKeyId, today, currentHour]
  );

  if (!usage) {
    // Create new usage record
    execute(
      `INSERT INTO agent_bot_usage (api_key_id, agent_bot_id, date, hour, request_count)
       VALUES (?, ?, ?, ?, 0)`,
      [apiKeyId, apiKey.agent_bot_id, today, currentHour]
    );
    usage = { id: 0, request_count: 0 };
  }

  // Get total requests for today
  const dailyUsage = queryOne<{ total: number }>(
    'SELECT SUM(request_count) as total FROM agent_bot_usage WHERE api_key_id = ? AND date = ?',
    [apiKeyId, today]
  );

  const requestsThisMinute = usage.request_count;
  const requestsToday = dailyUsage?.total || 0;

  // Calculate reset times
  const resetMinute = new Date(now);
  resetMinute.setMinutes(resetMinute.getMinutes() + 1, 0, 0);

  const resetDay = new Date(now);
  resetDay.setUTCHours(24, 0, 0, 0);

  const info: RateLimitInfo = {
    limitMinute: apiKey.rate_limit_rpm,
    remainingMinute: Math.max(0, apiKey.rate_limit_rpm - requestsThisMinute),
    limitDay: apiKey.rate_limit_rpd,
    remainingDay: Math.max(0, apiKey.rate_limit_rpd - requestsToday),
    resetMinute,
    resetDay,
  };

  // Check limits
  if (requestsThisMinute >= apiKey.rate_limit_rpm) {
    return { allowed: false, info, blockedReason: 'minute' };
  }

  if (requestsToday >= apiKey.rate_limit_rpd) {
    return { allowed: false, info, blockedReason: 'day' };
  }

  return { allowed: true, info };
}

/**
 * Increment usage counter for an API key
 */
export function incrementUsage(
  apiKeyId: string,
  agentBotId: string,
  tokenCount = 0,
  isError = false
): void {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentHour = now.getUTCHours();

  // Upsert usage record
  execute(
    `INSERT INTO agent_bot_usage (api_key_id, agent_bot_id, date, hour, request_count, token_count, error_count)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (api_key_id, date, hour)
     DO UPDATE SET
       request_count = request_count + 1,
       token_count = token_count + ?,
       error_count = error_count + ?`,
    [
      apiKeyId,
      agentBotId,
      today,
      currentHour,
      tokenCount,
      isError ? 1 : 0,
      tokenCount,
      isError ? 1 : 0,
    ]
  );
}

/**
 * Get rate limit info without incrementing
 */
export function getRateLimitInfo(apiKeyId: string): RateLimitInfo | null {
  const result = checkRateLimit(apiKeyId);
  return result.info;
}

// ============================================================================
// Usage Analytics
// ============================================================================

/**
 * Get usage stats for an API key over a date range
 */
export function getApiKeyUsageStats(
  apiKeyId: string,
  startDate: string,
  endDate: string
): {
  totalRequests: number;
  totalTokens: number;
  totalErrors: number;
  dailyBreakdown: { date: string; requests: number; tokens: number; errors: number }[];
} {
  const rows = queryAll<{
    date: string;
    requests: number;
    tokens: number;
    errors: number;
  }>(
    `SELECT date, SUM(request_count) as requests, SUM(token_count) as tokens, SUM(error_count) as errors
     FROM agent_bot_usage
     WHERE api_key_id = ? AND date >= ? AND date <= ?
     GROUP BY date
     ORDER BY date`,
    [apiKeyId, startDate, endDate]
  );

  let totalRequests = 0;
  let totalTokens = 0;
  let totalErrors = 0;

  const dailyBreakdown = rows.map((row) => {
    totalRequests += row.requests;
    totalTokens += row.tokens;
    totalErrors += row.errors;
    return {
      date: row.date,
      requests: row.requests,
      tokens: row.tokens,
      errors: row.errors,
    };
  });

  return { totalRequests, totalTokens, totalErrors, dailyBreakdown };
}

/**
 * Get aggregated usage stats for an agent bot
 */
export function getAgentBotUsageStats(
  agentBotId: string,
  startDate: string,
  endDate: string
): {
  totalRequests: number;
  totalTokens: number;
  totalErrors: number;
  byApiKey: { key_name: string; requests: number; tokens: number }[];
  dailyBreakdown: { date: string; requests: number }[];
} {
  // Total stats
  const totals = queryOne<{
    requests: number;
    tokens: number;
    errors: number;
  }>(
    `SELECT SUM(request_count) as requests, SUM(token_count) as tokens, SUM(error_count) as errors
     FROM agent_bot_usage
     WHERE agent_bot_id = ? AND date >= ? AND date <= ?`,
    [agentBotId, startDate, endDate]
  );

  // By API key
  const byKeyRows = queryAll<{
    key_name: string;
    requests: number;
    tokens: number;
  }>(
    `SELECT k.name as key_name, SUM(u.request_count) as requests, SUM(u.token_count) as tokens
     FROM agent_bot_usage u
     JOIN agent_bot_api_keys k ON u.api_key_id = k.id
     WHERE u.agent_bot_id = ? AND u.date >= ? AND u.date <= ?
     GROUP BY k.id, k.name
     ORDER BY requests DESC`,
    [agentBotId, startDate, endDate]
  );

  // Daily breakdown
  const dailyRows = queryAll<{ date: string; requests: number }>(
    `SELECT date, SUM(request_count) as requests
     FROM agent_bot_usage
     WHERE agent_bot_id = ? AND date >= ? AND date <= ?
     GROUP BY date
     ORDER BY date`,
    [agentBotId, startDate, endDate]
  );

  return {
    totalRequests: totals?.requests || 0,
    totalTokens: totals?.tokens || 0,
    totalErrors: totals?.errors || 0,
    byApiKey: byKeyRows,
    dailyBreakdown: dailyRows,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get active API key count for an agent bot
 */
export function getActiveKeyCount(agentBotId: string): number {
  const result = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM agent_bot_api_keys WHERE agent_bot_id = ? AND is_active = 1 AND revoked_at IS NULL',
    [agentBotId]
  );
  return result?.count || 0;
}

/**
 * Check if API key name exists for an agent bot
 */
export function keyNameExists(agentBotId: string, name: string, excludeId?: string): boolean {
  const sql = excludeId
    ? 'SELECT COUNT(*) as count FROM agent_bot_api_keys WHERE agent_bot_id = ? AND name = ? AND id != ?'
    : 'SELECT COUNT(*) as count FROM agent_bot_api_keys WHERE agent_bot_id = ? AND name = ?';
  const params = excludeId ? [agentBotId, name, excludeId] : [agentBotId, name];

  const result = queryOne<{ count: number }>(sql, params);
  return (result?.count || 0) > 0;
}

/**
 * Clean up expired usage records (for maintenance)
 */
export function cleanupOldUsageRecords(daysToKeep = 90): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoff = cutoffDate.toISOString().split('T')[0];

  const result = execute('DELETE FROM agent_bot_usage WHERE date < ?', [cutoff]);
  return result.changes;
}

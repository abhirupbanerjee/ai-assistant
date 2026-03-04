/**
 * Agent Bot API Key Database Operations - Async Compatibility Layer
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes, createHash } from 'crypto';
import { sql } from 'kysely';

// Re-export types from the types file
export type {
  AgentBotApiKey,
  AgentBotApiKeyWithStats,
  AgentBotApiKeyRow,
  CreateApiKeyResult,
  CreateApiKeyInput,
  RateLimitInfo,
  RateLimitCheckResult,
} from '@/types/agent-bot';

import type {
  AgentBotApiKey,
  AgentBotApiKeyWithStats,
  AgentBotApiKeyRow,
  CreateApiKeyResult,
  CreateApiKeyInput,
  RateLimitInfo,
  RateLimitCheckResult,
} from '@/types/agent-bot';

// ============ Constants ============

const API_KEY_PREFIX = 'ab_pk_';
const API_KEY_LENGTH = 48;

// ============ Helper Functions ============

function generateApiKey(): string {
  const randomPart = randomBytes(36).toString('base64url').slice(0, API_KEY_LENGTH);
  return `${API_KEY_PREFIX}${randomPart}`;
}

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function extractPrefix(key: string): string {
  if (!key.startsWith(API_KEY_PREFIX)) return '';
  return key.slice(0, API_KEY_PREFIX.length + 8);
}

function rowToApiKey(row: AgentBotApiKeyRow): AgentBotApiKey {
  return {
    id: row.id,
    agent_bot_id: row.agent_bot_id,
    name: row.name,
    key_prefix: row.key_prefix,
    key_hash: row.key_hash,
    permissions: typeof row.permissions === 'string'
      ? JSON.parse(row.permissions)
      : row.permissions,
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

// ============ API Key CRUD ============

export async function getApiKeyById(id: string): Promise<AgentBotApiKey | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('agent_bot_api_keys')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? rowToApiKey(row as AgentBotApiKeyRow) : null;
}

export async function getApiKeyWithStats(id: string): Promise<AgentBotApiKeyWithStats | null> {
  const apiKey = await getApiKeyById(id);
  if (!apiKey) return null;

  const db = await getDb();
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentHour = now.getUTCHours();

  // Get total requests
  const totalResult = await db
    .selectFrom('agent_bot_usage')
    .select(sql<number>`SUM(request_count)`.as('total'))
    .where('api_key_id', '=', id)
    .executeTakeFirst();

  // Get today's requests
  const todayResult = await db
    .selectFrom('agent_bot_usage')
    .select(sql<number>`SUM(request_count)`.as('today'))
    .where('api_key_id', '=', id)
    .where('date', '=', today)
    .executeTakeFirst();

  // Get this hour's requests
  const hourResult = await db
    .selectFrom('agent_bot_usage')
    .select('request_count')
    .where('api_key_id', '=', id)
    .where('date', '=', today)
    .where('hour', '=', currentHour)
    .executeTakeFirst();

  return {
    ...apiKey,
    total_requests: totalResult?.total || 0,
    requests_today: todayResult?.today || 0,
    requests_this_hour: hourResult?.request_count || 0,
  };
}

export async function listApiKeys(agentBotId: string, includeRevoked = false): Promise<AgentBotApiKey[]> {
  const db = await getDb();
  let query = db
    .selectFrom('agent_bot_api_keys')
    .selectAll()
    .where('agent_bot_id', '=', agentBotId);

  if (!includeRevoked) {
    query = query.where('revoked_at', 'is', null);
  }

  const rows = await query.orderBy('created_at', 'desc').execute();
  return rows.map((r) => rowToApiKey(r as AgentBotApiKeyRow));
}

export async function createApiKey(
  agentBotId: string,
  input: CreateApiKeyInput,
  createdBy: string
): Promise<CreateApiKeyResult> {
  const db = await getDb();
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

  await db
    .insertInto('agent_bot_api_keys')
    .values({
      id,
      agent_bot_id: agentBotId,
      name: input.name,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      permissions: JSON.stringify(['invoke']),
      rate_limit_rpm: input.rate_limit_rpm ?? 60,
      rate_limit_rpd: input.rate_limit_rpd ?? 1000,
      expires_at: expiresAt,
      is_active: 1,
      created_by: createdBy,
    })
    .execute();

  const apiKey = await getApiKeyById(id);

  return {
    apiKey: apiKey!,
    fullKey,
  };
}

export async function revokeApiKey(id: string): Promise<AgentBotApiKey | null> {
  const db = await getDb();
  await db
    .updateTable('agent_bot_api_keys')
    .set({ is_active: 0, revoked_at: sql`NOW()` })
    .where('id', '=', id)
    .execute();

  return getApiKeyById(id);
}

export async function deleteApiKey(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('agent_bot_api_keys')
    .where('id', '=', id)
    .executeTakeFirst();

  return (result.numDeletedRows ?? BigInt(0)) > BigInt(0);
}

export async function updateLastUsed(id: string): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('agent_bot_api_keys')
    .set({ last_used_at: sql`NOW()` })
    .where('id', '=', id)
    .execute();
}

// ============ API Key Validation ============

export async function validateApiKey(fullKey: string): Promise<{
  valid: boolean;
  apiKey?: AgentBotApiKey;
  error?: string;
  errorCode?: string;
}> {
  // Check format
  if (!fullKey.startsWith(API_KEY_PREFIX)) {
    return { valid: false, error: 'Invalid API key format', errorCode: 'INVALID_API_KEY' };
  }

  const keyHash = hashApiKey(fullKey);

  const db = await getDb();
  const row = await db
    .selectFrom('agent_bot_api_keys')
    .selectAll()
    .where('key_hash', '=', keyHash)
    .executeTakeFirst();

  if (!row) {
    return { valid: false, error: 'API key not found', errorCode: 'INVALID_API_KEY' };
  }

  const apiKey = rowToApiKey(row as AgentBotApiKeyRow);

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

export async function getAgentBotIdFromApiKey(fullKey: string): Promise<string | null> {
  const result = await validateApiKey(fullKey);
  return result.valid && result.apiKey ? result.apiKey.agent_bot_id : null;
}

// ============ Rate Limiting ============

export async function checkRateLimit(apiKeyId: string): Promise<RateLimitCheckResult> {
  const apiKey = await getApiKeyById(apiKeyId);
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

  const db = await getDb();
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentHour = now.getUTCHours();

  // Get or create usage record for this hour
  let usage = await db
    .selectFrom('agent_bot_usage')
    .select(['id', 'request_count'])
    .where('api_key_id', '=', apiKeyId)
    .where('date', '=', today)
    .where('hour', '=', currentHour)
    .executeTakeFirst();

  if (!usage) {
    await db
      .insertInto('agent_bot_usage')
      .values({
        api_key_id: apiKeyId,
        agent_bot_id: apiKey.agent_bot_id,
        date: today,
        hour: currentHour,
        request_count: 0,
        token_count: 0,
        error_count: 0,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    usage = { id: 0, request_count: 0 };
  }

  // Get total requests for today
  const dailyUsage = await db
    .selectFrom('agent_bot_usage')
    .select(sql<number>`SUM(request_count)`.as('total'))
    .where('api_key_id', '=', apiKeyId)
    .where('date', '=', today)
    .executeTakeFirst();

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

export async function incrementUsage(
  apiKeyId: string,
  agentBotId: string,
  tokenCount = 0,
  isError = false
): Promise<void> {
  const db = await getDb();
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentHour = now.getUTCHours();

  // Upsert usage record
  await db
    .insertInto('agent_bot_usage')
    .values({
      api_key_id: apiKeyId,
      agent_bot_id: agentBotId,
      date: today,
      hour: currentHour,
      request_count: 1,
      token_count: tokenCount,
      error_count: isError ? 1 : 0,
    })
    .onConflict((oc) =>
      oc.columns(['api_key_id', 'date', 'hour']).doUpdateSet({
        request_count: sql`agent_bot_usage.request_count + 1`,
        token_count: sql`agent_bot_usage.token_count + ${tokenCount}`,
        error_count: sql`agent_bot_usage.error_count + ${isError ? 1 : 0}`,
      })
    )
    .execute();
}

export async function getRateLimitInfo(apiKeyId: string): Promise<RateLimitInfo | null> {
  const result = await checkRateLimit(apiKeyId);
  return result.info;
}

// ============ Usage Analytics ============

export async function getApiKeyUsageStats(
  apiKeyId: string,
  startDate: string,
  endDate: string
): Promise<{
  totalRequests: number;
  totalTokens: number;
  totalErrors: number;
  dailyBreakdown: { date: string; requests: number; tokens: number; errors: number }[];
}> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent_bot_usage')
    .select([
      'date',
      sql<number>`SUM(request_count)`.as('requests'),
      sql<number>`SUM(token_count)`.as('tokens'),
      sql<number>`SUM(error_count)`.as('errors'),
    ])
    .where('api_key_id', '=', apiKeyId)
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .groupBy('date')
    .orderBy('date', 'asc')
    .execute();

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

export async function getAgentBotUsageStats(
  agentBotId: string,
  startDate: string,
  endDate: string
): Promise<{
  totalRequests: number;
  totalTokens: number;
  totalErrors: number;
  byApiKey: { key_name: string; requests: number; tokens: number }[];
  dailyBreakdown: { date: string; requests: number }[];
}> {
  const db = await getDb();

  // Total stats
  const totals = await db
    .selectFrom('agent_bot_usage')
    .select([
      sql<number>`SUM(request_count)`.as('requests'),
      sql<number>`SUM(token_count)`.as('tokens'),
      sql<number>`SUM(error_count)`.as('errors'),
    ])
    .where('agent_bot_id', '=', agentBotId)
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .executeTakeFirst();

  // By API key
  const byKeyRows = await db
    .selectFrom('agent_bot_usage as u')
    .innerJoin('agent_bot_api_keys as k', 'u.api_key_id', 'k.id')
    .select([
      'k.name as key_name',
      sql<number>`SUM(u.request_count)`.as('requests'),
      sql<number>`SUM(u.token_count)`.as('tokens'),
    ])
    .where('u.agent_bot_id', '=', agentBotId)
    .where('u.date', '>=', startDate)
    .where('u.date', '<=', endDate)
    .groupBy(['k.id', 'k.name'])
    .orderBy(sql`SUM(u.request_count)`, 'desc')
    .execute();

  // Daily breakdown
  const dailyRows = await db
    .selectFrom('agent_bot_usage')
    .select(['date', sql<number>`SUM(request_count)`.as('requests')])
    .where('agent_bot_id', '=', agentBotId)
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .groupBy('date')
    .orderBy('date', 'asc')
    .execute();

  return {
    totalRequests: totals?.requests || 0,
    totalTokens: totals?.tokens || 0,
    totalErrors: totals?.errors || 0,
    byApiKey: byKeyRows.map((r) => ({
      key_name: r.key_name,
      requests: r.requests,
      tokens: r.tokens,
    })),
    dailyBreakdown: dailyRows.map((r) => ({
      date: r.date,
      requests: r.requests,
    })),
  };
}

// ============ Utility Functions ============

export async function getActiveKeyCount(agentBotId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('agent_bot_api_keys')
    .select(db.fn.count<number>('id').as('count'))
    .where('agent_bot_id', '=', agentBotId)
    .where('is_active', '=', 1)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();

  return result?.count ?? 0;
}

export async function keyNameExists(agentBotId: string, name: string, excludeId?: string): Promise<boolean> {
  const db = await getDb();
  let query = db
    .selectFrom('agent_bot_api_keys')
    .select(db.fn.count<number>('id').as('count'))
    .where('agent_bot_id', '=', agentBotId)
    .where('name', '=', name);

  if (excludeId) {
    query = query.where('id', '!=', excludeId);
  }

  const result = await query.executeTakeFirst();
  return (result?.count ?? 0) > 0;
}

export async function cleanupOldUsageRecords(daysToKeep = 90): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoff = cutoffDate.toISOString().split('T')[0];

  const db = await getDb();
  const result = await db
    .deleteFrom('agent_bot_usage')
    .where('date', '<', cutoff)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0);
}

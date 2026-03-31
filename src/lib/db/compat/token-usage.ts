/**
 * Token Usage Log Database Operations
 *
 * Stores and retrieves LLM token usage for the admin dashboard.
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb } from '../kysely';
import { sql } from 'kysely';
import type { NewTokenUsageLog } from '../db-types';

// ============ Types ============

export interface TokenUsageCategory {
  category: string;
  total_tokens: number;
  call_count: number;
}

export interface TokenUsageByUser {
  user_id: number;
  user_email: string;
  user_name: string | null;
  total_tokens: number;
  call_count: number;
}

export interface TokenUsageByModel {
  model: string;
  total_tokens: number;
  call_count: number;
}

export interface DailyTokenUsage {
  date: string;
  total_tokens: number;
  call_count: number;
  chat_tokens: number;
  autonomous_tokens: number;
  embeddings_tokens: number;
  workspace_tokens: number;
}

export interface TokenUsageSummary {
  total_tokens: number;
  total_calls: number;
  byCategory: TokenUsageCategory[];
  byUser: TokenUsageByUser[];
  byModel: TokenUsageByModel[];
  daily: DailyTokenUsage[];
}

export interface TokenUsageFilters {
  category?: string;
  userId?: number;
  model?: string;
  days?: number;
}

// ============ Write ============

/** Log a single LLM call's token usage */
export async function logTokenUsage(entry: NewTokenUsageLog): Promise<void> {
  const db = await getDb();
  await db.insertInto('token_usage_log').values(entry).execute();
}

// ============ Read - Dashboard ============

/** Get full dashboard summary with filters */
export async function getTokenUsageSummary(
  filters: TokenUsageFilters = {}
): Promise<TokenUsageSummary> {
  const days = filters.days || 7;

  const [totalResult, byCategory, byUser, byModel, daily] = await Promise.all([
    getTotals(filters, days),
    getByCategory(filters, days),
    getByUser(filters, days),
    getByModel(filters, days),
    getDaily(filters, days),
  ]);

  return {
    total_tokens: totalResult.total_tokens,
    total_calls: totalResult.total_calls,
    byCategory,
    byUser,
    byModel,
    daily,
  };
}

/** Get distinct models and users for filter dropdowns */
export async function getFilterOptions(): Promise<{
  categories: string[];
  models: string[];
  users: { id: number; email: string; name: string | null }[];
}> {
  const db = await getDb();

  const [models, users] = await Promise.all([
    sql<{ model: string }>`
      SELECT DISTINCT model FROM token_usage_log ORDER BY model
    `.execute(db),
    sql<{ id: number; email: string; name: string | null }>`
      SELECT DISTINCT u.id, u.email, u.name
      FROM token_usage_log t
      INNER JOIN users u ON u.id = t.user_id
      ORDER BY u.email
    `.execute(db),
  ]);

  return {
    categories: ['chat', 'autonomous', 'embeddings', 'workspace'],
    models: models.rows.map((m) => m.model),
    users: models.rows.length >= 0 ? users.rows.map((u) => ({ id: u.id, email: u.email, name: u.name })) : [],
  };
}

// ============ Internal Helpers ============

function buildWhereClause(filters: TokenUsageFilters, days: number, tablePrefix = ''): string {
  const p = tablePrefix ? `${tablePrefix}.` : '';
  const conditions = [`${p}created_at >= NOW() - MAKE_INTERVAL(days => ${days})`];
  if (filters.category) conditions.push(`${p}category = '${filters.category}'`);
  if (filters.userId) conditions.push(`${p}user_id = ${filters.userId}`);
  if (filters.model) conditions.push(`${p}model = '${filters.model}'`);
  return conditions.join(' AND ');
}

async function getTotals(
  filters: TokenUsageFilters,
  days: number
): Promise<{ total_tokens: number; total_calls: number }> {
  const db = await getDb();
  const where = buildWhereClause(filters, days);
  const result = await sql<{ total_tokens: string; total_calls: string }>`
    SELECT
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COUNT(*) AS total_calls
    FROM token_usage_log
    WHERE ${sql.raw(where)}
  `.execute(db);

  const row = result.rows[0];
  return {
    total_tokens: Number(row?.total_tokens ?? 0),
    total_calls: Number(row?.total_calls ?? 0),
  };
}

async function getByCategory(
  filters: TokenUsageFilters,
  days: number
): Promise<TokenUsageCategory[]> {
  const db = await getDb();
  const where = buildWhereClause(filters, days);
  const result = await sql<{ category: string; total_tokens: string; call_count: string }>`
    SELECT
      category,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COUNT(*) AS call_count
    FROM token_usage_log
    WHERE ${sql.raw(where)}
    GROUP BY category
    ORDER BY SUM(total_tokens) DESC
  `.execute(db);

  return result.rows.map((r) => ({
    category: r.category,
    total_tokens: Number(r.total_tokens),
    call_count: Number(r.call_count),
  }));
}

async function getByUser(
  filters: TokenUsageFilters,
  days: number
): Promise<TokenUsageByUser[]> {
  const db = await getDb();
  const where = buildWhereClause(filters, days, 't');
  const result = await sql<{ user_id: number; user_email: string; user_name: string | null; total_tokens: string; call_count: string }>`
    SELECT
      u.id AS user_id,
      u.email AS user_email,
      u.name AS user_name,
      COALESCE(SUM(t.total_tokens), 0) AS total_tokens,
      COUNT(*) AS call_count
    FROM token_usage_log t
    INNER JOIN users u ON u.id = t.user_id
    WHERE ${sql.raw(where)}
    GROUP BY u.id, u.email, u.name
    ORDER BY SUM(t.total_tokens) DESC
    LIMIT 20
  `.execute(db);

  return result.rows.map((r) => ({
    user_id: r.user_id,
    user_email: r.user_email,
    user_name: r.user_name,
    total_tokens: Number(r.total_tokens),
    call_count: Number(r.call_count),
  }));
}

async function getByModel(
  filters: TokenUsageFilters,
  days: number
): Promise<TokenUsageByModel[]> {
  const db = await getDb();
  const where = buildWhereClause(filters, days);
  const result = await sql<{ model: string; total_tokens: string; call_count: string }>`
    SELECT
      model,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COUNT(*) AS call_count
    FROM token_usage_log
    WHERE ${sql.raw(where)}
    GROUP BY model
    ORDER BY SUM(total_tokens) DESC
  `.execute(db);

  return result.rows.map((r) => ({
    model: r.model,
    total_tokens: Number(r.total_tokens),
    call_count: Number(r.call_count),
  }));
}

async function getDaily(
  filters: TokenUsageFilters,
  days: number
): Promise<DailyTokenUsage[]> {
  const db = await getDb();
  const where = buildWhereClause(filters, days);
  const result = await sql<{
    date: string;
    total_tokens: string;
    call_count: string;
    chat_tokens: string;
    autonomous_tokens: string;
    embeddings_tokens: string;
    workspace_tokens: string;
  }>`
    SELECT
      DATE(created_at) AS date,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COUNT(*) AS call_count,
      COALESCE(SUM(CASE WHEN category = 'chat' THEN total_tokens ELSE 0 END), 0) AS chat_tokens,
      COALESCE(SUM(CASE WHEN category = 'autonomous' THEN total_tokens ELSE 0 END), 0) AS autonomous_tokens,
      COALESCE(SUM(CASE WHEN category = 'embeddings' THEN total_tokens ELSE 0 END), 0) AS embeddings_tokens,
      COALESCE(SUM(CASE WHEN category = 'workspace' THEN total_tokens ELSE 0 END), 0) AS workspace_tokens
    FROM token_usage_log
    WHERE ${sql.raw(where)}
    GROUP BY DATE(created_at)
    ORDER BY DATE(created_at) ASC
  `.execute(db);

  return result.rows.map((r) => ({
    date: String(r.date),
    total_tokens: Number(r.total_tokens),
    call_count: Number(r.call_count),
    chat_tokens: Number(r.chat_tokens),
    autonomous_tokens: Number(r.autonomous_tokens),
    embeddings_tokens: Number(r.embeddings_tokens),
    workspace_tokens: Number(r.workspace_tokens),
  }));
}

/**
 * Notion API operations — implementations of each tool.
 *
 * Each function follows the OpResult<T> pattern for consistent error handling.
 * All calls use per-user Notion access tokens fetched from the host app vault.
 */

import { AppConfig } from './config';
import { getJson, postJson, HttpError } from './http';
import { getUserToken, invalidateUserToken, RECONNECT_REQUIRED, VaultProvider } from './vault';
import { logger } from './logger';

const PROVIDER: VaultProvider = 'notion';

export interface OpResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
  status?: number;
}

export function ok<T>(data: T): OpResult<T> {
  return { ok: true, data };
}

export function fail<T = unknown>(error: string, status?: number, code?: string): OpResult<T> {
  return { ok: false, error, status, code };
}

const NOTION_BASE = 'https://api.notion.com/v1';

/** Common headers for Notion API requests. */
const NOTION_HEADERS = {
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

/**
 * Resolve per-user auth for a tool call.
 */
async function resolveAuth(
  cfg: AppConfig,
  userId: string | undefined
): Promise<OpResult<{ token: string }>> {
  if (!userId) {
    return fail('No user identity provided.', 401, 'IDENTITY_REQUIRED');
  }

  const vaultToken = await getUserToken(cfg, userId, PROVIDER);
  if (vaultToken === RECONNECT_REQUIRED) {
    return fail(
      'Notion account needs reconnection. Visit Settings → Connected Accounts.',
      401,
      'RECONNECT_REQUIRED'
    );
  }
  if (!vaultToken) {
    return fail(
      'No Notion account connected. Visit Settings → Connected Accounts.',
      401,
      'NOT_CONNECTED'
    );
  }

  return ok({ token: vaultToken.accessToken });
}

/**
 * Build auth headers for a Notion API call.
 */
function authHeaders(token: string): Record<string, string> {
  return {
    ...NOTION_HEADERS,
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Normalize a Notion ID by removing hyphens.
 */
function normalizeId(id: string): string {
  return id.replace(/-/g, '');
}

/**
 * Handle common Notion API errors.
 */
function handleApiError(err: unknown, userId: string | undefined): OpResult {
  if (err instanceof HttpError) {
    if (err.status === 401) {
      if (userId) invalidateUserToken(userId, PROVIDER);
      return fail(
        'Notion token expired or revoked. Reconnect in Settings → Connected Accounts.',
        401,
        'RECONNECT_REQUIRED'
      );
    }
    if (err.status === 403) {
      return fail('Access denied. Check Notion integration permissions.', 403, 'ACCESS_DENIED');
    }
    if (err.status === 404) {
      return fail('Resource not found. Check the page, database, or block ID.', 404, 'NOT_FOUND');
    }
    if (err.status === 429) {
      return fail('Notion API rate limit exceeded. Please wait and try again.', 429, 'RATE_LIMITED');
    }
    return fail(`Notion API error: ${err.message}`, err.status);
  }
  return fail(err instanceof Error ? err.message : 'Notion API call failed');
}

// ============================================================================
// Search
// ============================================================================

async function notionSearch(
  cfg: AppConfig,
  args: { query: string; filter?: string; sort?: string; page_size?: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const body: Record<string, unknown> = { query: args.query };
  if (args.filter) body.filter = { property: 'object', value: args.filter };
  if (args.sort) body.sort = { direction: args.sort, timestamp: 'last_edited_time' };
  if (args.page_size) body.page_size = args.page_size;

  try {
    const data = await postJson(
      `${NOTION_BASE}/search`,
      body,
      authHeaders(token),
      cfg.notionTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// Pages
// ============================================================================

async function notionGetPage(
  cfg: AppConfig,
  args: { page_id: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  try {
    const data = await getJson(
      `${NOTION_BASE}/pages/${normalizeId(args.page_id)}`,
      authHeaders(token),
      cfg.notionTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

async function notionGetBlockChildren(
  cfg: AppConfig,
  args: { block_id: string; page_size?: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  if (args.page_size) params.set('page_size', String(args.page_size));

  try {
    const data = await getJson(
      `${NOTION_BASE}/blocks/${normalizeId(args.block_id)}/children?${params.toString()}`,
      authHeaders(token),
      cfg.notionTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// Databases
// ============================================================================

async function notionGetDatabase(
  cfg: AppConfig,
  args: { database_id: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  try {
    const data = await getJson(
      `${NOTION_BASE}/databases/${normalizeId(args.database_id)}`,
      authHeaders(token),
      cfg.notionTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

async function notionQueryDatabase(
  cfg: AppConfig,
  args: { database_id: string; filter?: unknown; sorts?: unknown[]; page_size?: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const body: Record<string, unknown> = {};
  if (args.filter) body.filter = args.filter;
  if (args.sorts && args.sorts.length > 0) body.sorts = args.sorts;
  if (args.page_size) body.page_size = args.page_size;

  try {
    const data = await postJson(
      `${NOTION_BASE}/databases/${normalizeId(args.database_id)}/query`,
      body,
      authHeaders(token),
      cfg.notionTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// Users
// ============================================================================

async function notionGetUser(
  cfg: AppConfig,
  args: { user_id: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  try {
    const data = await getJson(
      `${NOTION_BASE}/users/${normalizeId(args.user_id)}`,
      authHeaders(token),
      cfg.notionTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

async function notionListUsers(
  cfg: AppConfig,
  args: { page_size?: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  if (args.page_size) params.set('page_size', String(args.page_size));

  try {
    const data = await getJson(
      `${NOTION_BASE}/users?${params.toString()}`,
      authHeaders(token),
      cfg.notionTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// OP_HANDLERS map
// ============================================================================

export type OpHandler = (
  cfg: AppConfig,
  args: Record<string, unknown>
) => Promise<OpResult<unknown>>;

export const OP_HANDLERS: Record<string, OpHandler> = {
  notion_search: notionSearch as OpHandler,
  notion_get_page: notionGetPage as OpHandler,
  notion_get_block_children: notionGetBlockChildren as OpHandler,
  notion_get_database: notionGetDatabase as OpHandler,
  notion_query_database: notionQueryDatabase as OpHandler,
  notion_get_user: notionGetUser as OpHandler,
  notion_list_users: notionListUsers as OpHandler,
};

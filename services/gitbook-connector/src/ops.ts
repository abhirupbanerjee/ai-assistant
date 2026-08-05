/**
 * GitBook API operations — implementations of each tool.
 *
 * Each function follows the OpResult<T> pattern for consistent error handling.
 * All calls use per-user GitBook access tokens fetched from the host app vault.
 */

import { AppConfig } from './config';
import { getJson, HttpError } from './http';
import { getUserToken, invalidateUserToken, RECONNECT_REQUIRED, VaultProvider } from './vault';
import { logger } from './logger';

const PROVIDER: VaultProvider = 'gitbook';

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

const GITBOOK_BASE = 'https://api.gitbook.com/v1';

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
      'GitBook account needs reconnection. Visit Settings → Connected Accounts.',
      401,
      'RECONNECT_REQUIRED'
    );
  }
  if (!vaultToken) {
    return fail(
      'No GitBook account connected. Visit Settings → Connected Accounts.',
      401,
      'NOT_CONNECTED'
    );
  }

  return ok({ token: vaultToken.accessToken });
}

/**
 * Build auth headers for a GitBook API call.
 */
function authHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Handle common GitBook API errors.
 */
function handleApiError(err: unknown, userId: string | undefined): OpResult {
  if (err instanceof HttpError) {
    if (err.status === 401) {
      if (userId) invalidateUserToken(userId, PROVIDER);
      return fail(
        'GitBook token expired or revoked. Reconnect in Settings → Connected Accounts.',
        401,
        'RECONNECT_REQUIRED'
      );
    }
    if (err.status === 403) {
      return fail('Access denied. Check GitBook integration permissions.', 403, 'ACCESS_DENIED');
    }
    if (err.status === 404) {
      return fail('Resource not found. Check the space, page, or collection ID.', 404, 'NOT_FOUND');
    }
    if (err.status === 429) {
      return fail('GitBook API rate limit exceeded. Please wait and try again.', 429, 'RATE_LIMITED');
    }
    return fail(`GitBook API error: ${err.message}`, err.status);
  }
  return fail(err instanceof Error ? err.message : 'GitBook API call failed');
}

// ============================================================================
// Spaces
// ============================================================================

async function gitbookListSpaces(
  cfg: AppConfig,
  args: { org_id: string; page_size?: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  if (args.page_size) params.set('limit', String(args.page_size));

  try {
    const data = await getJson(
      `${GITBOOK_BASE}/orgs/${encodeURIComponent(args.org_id)}/spaces?${params.toString()}`,
      authHeaders(token),
      cfg.gitbookTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

async function gitbookGetSpace(
  cfg: AppConfig,
  args: { space_id: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  try {
    const data = await getJson(
      `${GITBOOK_BASE}/spaces/${encodeURIComponent(args.space_id)}`,
      authHeaders(token),
      cfg.gitbookTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// Content
// ============================================================================

async function gitbookGetContent(
  cfg: AppConfig,
  args: { space_id: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  try {
    const data = await getJson(
      `${GITBOOK_BASE}/spaces/${encodeURIComponent(args.space_id)}/content`,
      authHeaders(token),
      cfg.gitbookTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

async function gitbookGetPage(
  cfg: AppConfig,
  args: { space_id: string; page_id: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  try {
    const data = await getJson(
      `${GITBOOK_BASE}/spaces/${encodeURIComponent(args.space_id)}/content/page/${encodeURIComponent(args.page_id)}`,
      authHeaders(token),
      cfg.gitbookTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// Search
// ============================================================================

async function gitbookSearch(
  cfg: AppConfig,
  args: { space_id: string; query: string; page_size?: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams({ query: args.query });
  if (args.page_size) params.set('limit', String(args.page_size));

  try {
    const data = await getJson(
      `${GITBOOK_BASE}/spaces/${encodeURIComponent(args.space_id)}/search?${params.toString()}`,
      authHeaders(token),
      cfg.gitbookTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// Collections
// ============================================================================

async function gitbookGetCollection(
  cfg: AppConfig,
  args: { space_id: string; collection_id: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  try {
    const data = await getJson(
      `${GITBOOK_BASE}/spaces/${encodeURIComponent(args.space_id)}/content/collection/${encodeURIComponent(args.collection_id)}`,
      authHeaders(token),
      cfg.gitbookTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// Comments
// ============================================================================

async function gitbookListComments(
  cfg: AppConfig,
  args: { space_id: string; page_size?: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  if (args.page_size) params.set('limit', String(args.page_size));

  try {
    const data = await getJson(
      `${GITBOOK_BASE}/spaces/${encodeURIComponent(args.space_id)}/comments?${params.toString()}`,
      authHeaders(token),
      cfg.gitbookTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// Users
// ============================================================================

async function gitbookGetUser(
  cfg: AppConfig,
  args: { userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  try {
    const data = await getJson(
      `${GITBOOK_BASE}/user`,
      authHeaders(token),
      cfg.gitbookTimeoutMs
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
  gitbook_list_spaces: gitbookListSpaces as OpHandler,
  gitbook_get_space: gitbookGetSpace as OpHandler,
  gitbook_get_content: gitbookGetContent as OpHandler,
  gitbook_get_page: gitbookGetPage as OpHandler,
  gitbook_search: gitbookSearch as OpHandler,
  gitbook_get_collection: gitbookGetCollection as OpHandler,
  gitbook_list_comments: gitbookListComments as OpHandler,
  gitbook_get_user: gitbookGetUser as OpHandler,
};

/**
 * Slack API operations — implementations of each tool.
 *
 * Each function follows the OpResult<T> pattern for consistent error handling.
 * All calls use per-user Slack access tokens fetched from the host app vault.
 */

import { AppConfig } from './config';
import { getJson, postFormUrlencoded, HttpError } from './http';
import { getUserToken, invalidateUserToken, RECONNECT_REQUIRED, VaultProvider } from './vault';
import { logger } from './logger';

const PROVIDER: VaultProvider = 'slack';
const SLACK_API_BASE = 'https://slack.com/api';

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
      'Slack account needs reconnection. Visit Settings → Connected Accounts.',
      401,
      'RECONNECT_REQUIRED'
    );
  }
  if (!vaultToken) {
    return fail(
      'No Slack account connected. Visit Settings → Connected Accounts.',
      401,
      'NOT_CONNECTED'
    );
  }

  return ok({ token: vaultToken.accessToken });
}

/**
 * Build auth headers for a Slack API call.
 */
function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

/**
 * Handle common Slack API errors.
 */
function handleApiError(err: unknown, userId: string | undefined): OpResult {
  if (err instanceof HttpError) {
    if (err.status === 401) {
      if (userId) invalidateUserToken(userId, PROVIDER);
      return fail(
        'Slack token expired or revoked. Reconnect in Settings → Connected Accounts.',
        401,
        'RECONNECT_REQUIRED'
      );
    }
    if (err.status === 403) {
      return fail('Access denied. Check Slack OAuth scopes.', 403, 'ACCESS_DENIED');
    }
    if (err.status === 404) {
      return fail('Resource not found.', 404, 'NOT_FOUND');
    }
    return fail(`Slack API error: ${err.message}`, err.status);
  }
  return fail(err instanceof Error ? err.message : 'Slack API call failed');
}

// ============================================================================
// Messages
// ============================================================================

async function slackSearchMessages(
  cfg: AppConfig,
  args: { query: string; limit?: number; page?: number; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  params.set('query', args.query);
  if (args.limit) params.set('count', String(args.limit));
  if (args.page) params.set('page', String(args.page));

  try {
    const data = await getJson(
      `${SLACK_API_BASE}/search.messages?${params.toString()}`,
      authHeaders(token),
      cfg.slackTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

async function slackGetChannelHistory(
  cfg: AppConfig,
  args: { channel: string; limit?: number; cursor?: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  params.set('channel', args.channel);
  if (args.limit) params.set('limit', String(args.limit));
  if (args.cursor) params.set('cursor', args.cursor);

  try {
    const data = await getJson(
      `${SLACK_API_BASE}/conversations.history?${params.toString()}`,
      authHeaders(token),
      cfg.slackTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// Channels
// ============================================================================

async function slackListChannels(
  cfg: AppConfig,
  args: { limit?: number; cursor?: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  params.set('types', 'public_channel');
  if (args.limit) params.set('limit', String(args.limit));
  if (args.cursor) params.set('cursor', args.cursor);

  try {
    const data = await getJson(
      `${SLACK_API_BASE}/conversations.list?${params.toString()}`,
      authHeaders(token),
      cfg.slackTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

// ============================================================================
// Users
// ============================================================================

async function slackListUsers(
  cfg: AppConfig,
  args: { limit?: number; cursor?: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  if (args.limit) params.set('limit', String(args.limit));
  if (args.cursor) params.set('cursor', args.cursor);

  try {
    const data = await getJson(
      `${SLACK_API_BASE}/users.list?${params.toString()}`,
      authHeaders(token),
      cfg.slackTimeoutMs
    );
    return ok(data);
  } catch (err) {
    return handleApiError(err, args.userId);
  }
}

async function slackGetUserInfo(
  cfg: AppConfig,
  args: { user: string; userId?: string }
): Promise<OpResult<unknown>> {
  const auth = await resolveAuth(cfg, args.userId);
  if (!auth.ok) return auth;
  const { token } = auth.data!;

  const params = new URLSearchParams();
  params.set('user', args.user);

  try {
    const data = await getJson(
      `${SLACK_API_BASE}/users.info?${params.toString()}`,
      authHeaders(token),
      cfg.slackTimeoutMs
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
  slack_search_messages: slackSearchMessages as OpHandler,
  slack_get_channel_history: slackGetChannelHistory as OpHandler,
  slack_list_channels: slackListChannels as OpHandler,
  slack_list_users: slackListUsers as OpHandler,
  slack_get_user_info: slackGetUserInfo as OpHandler,
};

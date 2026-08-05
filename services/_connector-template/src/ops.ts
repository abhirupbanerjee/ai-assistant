/**
 * Operations — implementations of each tool calling the external service API.
 *
 * Copy this file to your connector and replace with your service's API calls.
 * Each function follows the OpResult<T> pattern for consistent error handling.
 */

import { AppConfig } from './config';
import { getJson, postJson, HttpError } from './http';
import { getUserToken, invalidateUserToken, RECONNECT_REQUIRED, VaultProvider } from './vault';
import { logger } from './logger';

// CHANGE: Set this to your provider key (must match ConnectedAccountProvider + VaultProvider).
const PROVIDER: VaultProvider = 'google';

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

export function fail(error: string, status?: number, code?: string): OpResult {
  return { ok: false, error, status, code };
}

/**
 * Resolve per-user auth for a tool call.
 * Returns null if no user connected (caller should return NOT_CONNECTED).
 */
export async function resolveAuth(
  cfg: AppConfig,
  userId: string | undefined
): Promise<{ token: string } | OpResult> {
  if (!userId) {
    return fail('No user identity provided.', 401, 'IDENTITY_REQUIRED');
  }

  const token = await getUserToken(cfg, userId, PROVIDER);
  if (token === RECONNECT_REQUIRED) {
    return fail(
      `${PROVIDER} account needs reconnection. Visit Settings → Connected Accounts.`,
      401,
      'RECONNECT_REQUIRED'
    );
  }
  if (!token) {
    return fail(
      `No ${PROVIDER} account connected. Visit Settings → Connected Accounts.`,
      401,
      'NOT_CONNECTED'
    );
  }

  return { token: token.accessToken };
}

/**
 * Handle common API errors (401 → invalidate token, rate limiting, etc.).
 */
export function handleApiError(
  err: unknown,
  userId: string | undefined
): OpResult {
  if (err instanceof HttpError) {
    if (err.status === 401) {
      if (userId) invalidateUserToken(userId, PROVIDER);
      return fail(
        `${PROVIDER} token expired or revoked. Reconnect in Settings → Connected Accounts.`,
        401,
        'RECONNECT_REQUIRED'
      );
    }
    if (err.status === 403) {
      return fail(
        `Access denied to ${PROVIDER} resource. Check your permissions.`,
        403,
        'ACCESS_DENIED'
      );
    }
    if (err.status === 429) {
      return fail(
        `${PROVIDER} rate limit exceeded. Please wait and try again.`,
        429,
        'RATE_LIMITED'
      );
    }
    return fail(`${PROVIDER} API error: ${err.message}`, err.status);
  }
  return fail(err instanceof Error ? err.message : `${PROVIDER} API call failed`);
}

// ============================================================================
// REPLACE: Implement your service's operations below.
// ============================================================================
//
// Each operation should:
//   1. Extract userId from args (injected by server)
//   2. Call resolveAuth() to get the per-user token
//   3. Call the external API
//   4. Handle errors via handleApiError()
//
// Example:
//
// export async function myserviceGetResource(
//   cfg: AppConfig,
//   args: { resourceId: string; userId?: string }
// ): Promise<OpResult<unknown>> {
//   const auth = await resolveAuth(cfg, args.userId);
//   if (!auth || 'error' in auth) return auth as OpResult;
//
//   try {
//     const data = await getJson(
//       `https://api.myservice.com/resources/${args.resourceId}`,
//       {
//         Authorization: `Bearer ${auth.token}`,
//         Accept: 'application/json',
//       },
//       cfg.apiTimeoutMs
//     );
//     return ok(data);
//   } catch (err) {
//     return handleApiError(err, args.userId);
//   }
// }

// ============================================================================
// OP_HANDLERS map — maps tool names to their implementation functions.
// ============================================================================

export type OpHandler = (
  cfg: AppConfig,
  args: Record<string, unknown>
) => Promise<OpResult<unknown>>;

// REPLACE: Populate with your tool name → handler mappings.
export const OP_HANDLERS: Record<string, OpHandler> = {
  // 'myservice_get_resource': myserviceGetResource,
};

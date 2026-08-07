/**
 * Internal vault token endpoint — returns decrypted per-user OAuth tokens
 * for the drive-connector microservice.
 *
 * Authentication: HMAC-SHA256 signature on the `X-Connector-User-Id` header,
 * verified with the shared `CONNECTOR_HMAC_SECRET`. This is the SAME mechanism
 * used by `executeFunction()` to inject the signed identity header (§8 Task 3).
 * Session-based auth is intentionally bypassed (excluded from middleware) so
 * the connector can call this from server-side without a user session.
 *
 * Flow:
 *   1. Connector receives a tool call with `X-Connector-User-Id` + `X-Connector-User-Sig`
 *   2. Connector calls this endpoint with those same headers + `?userId=X&provider=google`
 *   3. This route verifies the HMAC, looks up the `user_connected_accounts` row,
 *      and returns the decrypted access/refresh tokens + expiry.
 *      If the access token is expired or about to expire AND the provider
 *      supports refresh (Google/Microsoft), it transparently refreshes the
 *      token via the provider's token endpoint and persists the new tokens
 *      before returning — so the connector always receives a usable token.
 *   4. Connector uses the access token to call Google APIs as that user.
 *
 * Security:
 *   - Never returns tokens without a valid HMAC signature.
 *   - Never logs raw tokens.
 *   - Returns 404 (not 403) when no connected account exists, so the connector
 *     can cleanly fall back to the service-account identity.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { getConnectedAccount } from '@/lib/db/compat/connected-accounts';
import type { ConnectedAccount, ConnectedAccountProvider } from '@/types/connected-accounts';
import {
  isRefreshableProvider,
  isTokenExpiredOrExpiring,
  refreshAndPersist,
  RefreshTokenRevokedError,
} from '@/lib/connectors/token-refresh';

export const dynamic = 'force-dynamic';

const VALID_PROVIDERS: ReadonlySet<string> = new Set(['google', 'microsoft', 'github', 'notion', 'slack', 'gitbook']);

/**
 * In-process per-(userEmail, provider) refresh lock.
 *
 * When several connector requests for the same user arrive at once (a common
 * pattern — e.g. a multi-file save operation), they can all observe the same
 * expired token and race to refresh it. This map coalesces concurrent refresh
 * attempts for a given account into a single in-flight promise so we only hit
 * the provider's token endpoint once per expiry window.
 *
 * Entries are short-lived: each is deleted in the `finally` of its refresh
 * attempt, so the map never grows unbounded.
 */
const refreshInFlight = new Map<string, Promise<ConnectedAccount | undefined>>();

function refreshLockKey(userEmail: string, provider: string): string {
  return `${provider}:${userEmail}`;
}

/**
 * Refresh the account's access token with a per-account concurrency guard.
 * Concurrent callers for the same (userEmail, provider) share a single
 * in-flight refresh promise rather than each hitting the token endpoint.
 */
async function refreshWithLock(account: ConnectedAccount): Promise<ConnectedAccount | undefined> {
  const key = refreshLockKey(account.userEmail, account.provider);
  const existing = refreshInFlight.get(key);
  if (existing) {
    return existing;
  }
  const p = refreshAndPersist(account).finally(() => {
    refreshInFlight.delete(key);
  });
  refreshInFlight.set(key, p);
  return p;
}

/**
 * Verify the HMAC signature on the X-Connector-User-Id header.
 * Mirrors the logic in function-api.ts verifyConnectorIdentity but is
 * duplicated here to avoid importing tool-layer code into an API route.
 */
function verifyHmac(userId: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(userId, 'utf8').digest('hex');
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CONNECTOR_HMAC_SECRET;
  if (!secret || secret.trim() === '') {
    return NextResponse.json(
      { error: 'Vault endpoint disabled — CONNECTOR_HMAC_SECRET not configured', code: 'VAULT_DISABLED' },
      { status: 503 }
    );
  }

  const headerUserId = request.headers.get('x-connector-user-id');
  const headerSig = request.headers.get('x-connector-user-sig');

  if (!headerUserId || !headerSig) {
    return NextResponse.json(
      { error: 'Missing X-Connector-User-Id or X-Connector-User-Sig header', code: 'IDENTITY_UNVERIFIED' },
      { status: 401 }
    );
  }

  if (!verifyHmac(headerUserId, headerSig, secret)) {
    return NextResponse.json(
      { error: 'Invalid X-Connector-User-Sig signature', code: 'IDENTITY_UNVERIFIED' },
      { status: 401 }
    );
  }

  // The header userId is the trusted identity (HMAC-verified).
  // The query param userId must match it to prevent cross-user token access
  // (a connector with one user's signature cannot fetch another user's tokens).
  const queryUserId = request.nextUrl.searchParams.get('userId');
  const provider = request.nextUrl.searchParams.get('provider');

  if (!queryUserId || queryUserId !== headerUserId) {
    return NextResponse.json(
      { error: 'userId query param must match the signed X-Connector-User-Id header', code: 'IDENTITY_MISMATCH' },
      { status: 403 }
    );
  }

  if (!provider || !VALID_PROVIDERS.has(provider)) {
    return NextResponse.json(
      { error: 'Missing or invalid provider (must be "google" or "microsoft")', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  let account;
  try {
    account = await getConnectedAccount(queryUserId, provider as ConnectedAccountProvider);
  } catch (err) {
    // DB errors should not leak internals; surface a generic message.
    return NextResponse.json(
      { error: 'Vault lookup failed', code: 'VAULT_ERROR' },
      { status: 500 }
    );
  }

  if (!account || account.revoked) {
    // 404 → connector falls back to service account (Phase 1 behavior).
    return NextResponse.json(
      { error: 'No connected account found for this user/provider', code: 'NOT_CONNECTED' },
      { status: 404 }
    );
  }

  // Only return tokens if we actually have them.
  if (!account.accessToken) {
    return NextResponse.json(
      { error: 'Connected account has no access token (reconnect required)', code: 'RECONNECT_REQUIRED' },
      { status: 409 }
    );
  }

  // ── Transparent token refresh ─────────────────────────────────────────────
  // If the access token is expired (or about to expire within the buffer
  // window) and the provider supports refresh, exchange the stored refresh
  // token for a fresh access token now — persisting the rotation back to the
  // vault — so the connector always receives a usable token. This is the fix
  // for the "token expired — must reconnect" bug: previously the vault handed
  // back the stale 1-hour-lived access token, the connector's API call 401'd,
  // the retry re-fetched the SAME stale token, the second 401 was misread as a
  // revoked connection, and the user was forced to manually reconnect.
  if (isRefreshableProvider(account.provider) && isTokenExpiredOrExpiring(account)) {
    try {
      const refreshed = await refreshWithLock(account);
      if (refreshed?.accessToken) {
        account = refreshed;
      } else {
        // Refresh succeeded but produced no access token — treat as reconnect.
        return NextResponse.json(
          { error: 'Token refresh produced no access token (reconnect required)', code: 'RECONNECT_REQUIRED' },
          { status: 409 }
        );
      }
    } catch (err) {
      if (err instanceof RefreshTokenRevokedError) {
        // The refresh token is genuinely invalid/expired — user must reconnect.
        return NextResponse.json(
          { error: `${err.provider} connection expired or been revoked. Please reconnect your account.`, code: 'RECONNECT_REQUIRED' },
          { status: 409 }
        );
      }
      // Transient refresh failure (network, provider 5xx). Return the
      // possibly-stale token we already have — the connector will retry on
      // 401, and a subsequent vault call may succeed in refreshing. Failing
      // hard here would turn a transient blip into a forced reconnect.
      console.error('[vault/tokens] Token refresh failed (transient) — returning cached token:', err);
    }
  }

  return NextResponse.json({
    ok: true,
    provider: account.provider,
    userEmail: account.userEmail,
    accessToken: account.accessToken,
    refreshToken: account.refreshToken || null,
    scopes: account.scopes,
    tokenExpiry: account.tokenExpiry || null,
  });
}

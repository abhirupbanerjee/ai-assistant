/**
 * Microsoft Graph adapter — mints and refreshes OAuth2 access tokens.
 *
 * Two modes (mirrors the Google adapter in google.ts):
 *  1. **Per-user (Phase 2):** when `userId` is provided AND the vault has a
 *     connected-account token for that user, the adapter uses the per-user
 *     access token (acting as that user via delegated permissions).
 *  2. **App-only / client-credentials (fallback):** mints a token from the
 *     Azure AD app registration (client_id + client_secret + tenant_id) via
 *     the client_credentials grant flow. This is the default when no `userId`
 *     is given or the vault has no token for the user.
 *
 * No external dependencies (no MSAL) — OAuth2 token requests use the same
 * `postJson` helper as the rest of the connector. Tokens are cached in-memory
 * with a short safety-margin TTL.
 *
 * Reference:
 *   https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow
 */

import { logger } from './logger';
import { request, HttpError } from './http';
import { AppConfig } from './config';
import { getUserToken, invalidateUserToken, RECONNECT_REQUIRED, VaultToken, resetVaultState } from './vault';
export { RECONNECT_REQUIRED };

const GRAPH_TOKEN_URL = (tenantId: string) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;

/** Cache entry for a minted app-only access token. */
interface CachedToken {
  accessToken: string;
  /** Epoch ms when the token expires. */
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
let pendingToken: Promise<string> | null = null;

/** Pre-refresh the token this many ms before its real expiry. */
const EXPIRY_SAFETY_MS = 60_000;
const MIN_TTL_MS = 5_000;

/** Check whether the app-only (client-credentials) fallback is configured. */
function isAppOnlyConfigured(cfg: AppConfig): boolean {
  return !!(cfg.msClientId && cfg.msClientSecret && cfg.msTenantId);
}

/**
 * Mint an app-only access token via the client_credentials grant flow.
 * Uses the Azure AD app registration's delegated application permissions.
 */
async function mintAppToken(cfg: AppConfig): Promise<CachedToken> {
  if (!isAppOnlyConfigured(cfg)) {
    throw new Error(
      'Microsoft Graph app-only credentials not configured. Set MS_CLIENT_ID, MS_CLIENT_SECRET, and MS_TENANT_ID (or AZURE_AD_* equivalents).'
    );
  }

  const scope = cfg.msGraphScopes.join(' ');
  const body = new URLSearchParams({
    client_id: cfg.msClientId!,
    client_secret: cfg.msClientSecret!,
    scope,
    grant_type: 'client_credentials',
  });

  // postJson expects a JSON body, but the token endpoint is form-urlencoded.
  // We use a raw request via the http module's postJson helper with the
  // correct content type by passing the URLSearchParams as a string.
  const tokenUrl = GRAPH_TOKEN_URL(cfg.msTenantId!);
  logger.debug('Minting Microsoft Graph app-only token', { tenant: cfg.msTenantId });

  const res = await postForm(tokenUrl, body.toString());

  const tokenData = res as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    error?: string;
    error_description?: string;
  };

  if (tokenData.error || !tokenData.access_token) {
    throw new Error(
      `Microsoft token endpoint error: ${tokenData.error || 'no_access_token'} — ${tokenData.error_description || ''}`
    );
  }

  const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
  return {
    accessToken: tokenData.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

/**
 * POST a URL-encoded form body and return the parsed JSON response.
 * (The Microsoft token endpoint requires application/x-www-form-urlencoded,
 * not JSON. We can't use postJson directly, so we do a lightweight wrapper.)
 */
async function postForm(url: string, body: string): Promise<unknown> {
  const res = await request({
    method: 'POST',
    url,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    timeoutMs: 30_000,
    json: true,
  });
  return res.data;
}

/**
 * Get a Microsoft Graph access token.
 *
 * Returns either an access-token string or the `RECONNECT_REQUIRED` sentinel.
 */
export async function getAccessToken(
  cfg: AppConfig,
  userId?: string
): Promise<string | typeof RECONNECT_REQUIRED> {
  // Per-user path (Phase 2).
  if (userId) {
    const vaultResult = await getUserToken(cfg, userId, 'microsoft');
    if (vaultResult === RECONNECT_REQUIRED) {
      return RECONNECT_REQUIRED;
    }
    if (vaultResult) {
      return vaultResult.accessToken;
    }
    // null → fall through to app-only.
  }

  // App-only / client-credentials path (fallback).
  if (!isAppOnlyConfigured(cfg)) {
    throw new Error(
      'Microsoft Graph is not configured. Provide a per-user token (connect your OneDrive) or set MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID for app-only access.'
    );
  }

  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt - now > EXPIRY_SAFETY_MS + MIN_TTL_MS) {
    return cachedToken.accessToken;
  }

  if (pendingToken) {
    return pendingToken;
  }

  pendingToken = (async () => {
    try {
      cachedToken = await mintAppToken(cfg);
      return cachedToken.accessToken;
    } catch (err) {
      cachedToken = null;
      logger.error('Failed to mint Microsoft Graph token', {
        error: (err as Error).message,
      });
      throw err;
    } finally {
      pendingToken = null;
    }
  })();

  return pendingToken;
}

/**
 * Force-discard the cached app-only token (e.g. on a 401 from Graph).
 * Also invalidates the per-user vault token when `userId` is provided.
 */
export function invalidateToken(userId?: string): void {
  if (userId) {
    invalidateUserToken(userId, 'microsoft');
  }
  cachedToken = null;
  logger.debug('Microsoft Graph token cache invalidated', { userId: userId || null });
}

/**
 * Build the Authorization header for a Microsoft Graph request.
 * Returns a fresh header object; safe to spread into request opts.
 *
 * Throws `RECONNECT_REQUIRED` (a Symbol) when the vault says the user must
 * reconnect — callers should catch this and surface a structured error.
 */
export async function authHeaders(
  cfg: AppConfig,
  extra?: Record<string, string>,
  userId?: string
): Promise<Record<string, string>> {
  const token = await getAccessToken(cfg, userId);
  if (token === RECONNECT_REQUIRED) {
    throw RECONNECT_REQUIRED;
  }
  return { Authorization: `Bearer ${token}`, ...(extra || {}) };
}

/** Reset all cached state — mainly for tests. */
export function resetMicrosoftState(): void {
  cachedToken = null;
  pendingToken = null;
  resetVaultState();
}

/**
 * OAuth2 token refresh — exchanges a stored refresh_token for a fresh
 * access_token, persisting the rotated tokens back to the vault.
 *
 * This is the missing piece that caused the "token expired — reconnect"
 * bug in the Drive connectors. Without it, the vault endpoint returned
 * stale 1-hour-lived access tokens forever, so every call after the first
 * hour hit a 401, which the connector's retry loop misinterpreted as a
 * revoked connection and surfaced as RECONNECT_REQUIRED.
 *
 * Providers supported: `google` and `microsoft` (the only two connectors
 * that issue expiring access tokens + refresh tokens). Slack, GitHub, and
 * Notion tokens do not expire, so they never reach this module.
 *
 * Security:
 *   - Refresh tokens never leave the trusted app backend (the connector
 *     microservice only ever sees short-lived access tokens).
 *   - Refresh tokens and access tokens are never logged.
 *   - Client secrets are read from env vars at call time, not cached.
 */

import type { ConnectedAccount, ConnectedAccountProvider } from '@/types/connected-accounts';
import { upsertConnectedAccount, getConnectedAccountById } from '@/lib/db/compat/connected-accounts';

/** Result of a successful token refresh. */
export interface RefreshedTokens {
  accessToken: string;
  /** New refresh token if the provider rotated it; otherwise the original. */
  refreshToken: string | undefined;
  /** ISO 8601 expiry timestamp for the new access token. */
  tokenExpiry: string | undefined;
  /** Scopes granted by the new token (may differ from the original). */
  scopes: string | undefined;
}

/** Sentinel error: the refresh token is invalid/expired — user must reconnect. */
export class RefreshTokenRevokedError extends Error {
  readonly code = 'REFRESH_TOKEN_REVOKED';
  readonly provider: ConnectedAccountProvider;
  constructor(provider: ConnectedAccountProvider, message: string) {
    super(message);
    this.name = 'RefreshTokenRevokedError';
    this.provider = provider;
  }
}

/** Per-provider OAuth configuration resolved from env vars. */
interface ProviderOAuthConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  tokenUrl: string;
  /** Extra form params required by this provider (e.g. Microsoft's scope). */
  extraParams?: Record<string, string>;
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MICROSOFT_SCOPES = [
  'https://graph.microsoft.com/Files.ReadWrite',
  'https://graph.microsoft.com/Files.Read.All',
  'offline_access',
  'User.Read',
  'email',
].join(' ');

function resolveProviderConfig(provider: ConnectedAccountProvider): ProviderOAuthConfig {
  switch (provider) {
    case 'google':
      return {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        tokenUrl: GOOGLE_TOKEN_URL,
      };
    case 'microsoft': {
      const tenant = process.env.MS_TENANT_ID || process.env.AZURE_AD_TENANT_ID || 'common';
      return {
        clientId: process.env.MS_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID,
        clientSecret: process.env.MS_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET,
        tokenUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
        // Microsoft requires the scope to be re-sent on refresh; without it
        // the refreshed token is scoped down to the minimum and Graph calls 401.
        extraParams: { scope: MICROSOFT_SCOPES },
      };
    }
    default:
      // Non-expiring-token providers (slack/github/notion/gitbook) should
      // never reach here — callers filter them out before calling.
      return { clientId: undefined, clientSecret: undefined, tokenUrl: '' };
  }
}

/** Providers that issue expiring access tokens + refresh tokens. */
const REFRESHABLE_PROVIDERS: ReadonlySet<ConnectedAccountProvider> = new Set(['google', 'microsoft']);

/** Returns true if this provider's tokens can be refreshed. */
export function isRefreshableProvider(provider: ConnectedAccountProvider): boolean {
  return REFRESHABLE_PROVIDERS.has(provider);
}

/**
 * Pre-refresh window: if the token expires within this many ms, refresh it
 * proactively rather than returning a token that will die mid-request.
 * Matches the connector's 60s safety margin (vault.ts EXPIRY_SAFETY_MS).
 */
export const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Returns true if the account's access token is expired or about to expire.
 * Tokens with no recorded expiry are treated as not-expiring (skip refresh).
 */
export function isTokenExpiredOrExpiring(
  account: Pick<ConnectedAccount, 'tokenExpiry'>,
  bufferMs = REFRESH_BUFFER_MS
): boolean {
  if (!account.tokenExpiry) return false;
  const expiry = Date.parse(account.tokenExpiry);
  if (Number.isNaN(expiry)) return false;
  return expiry - Date.now() <= bufferMs;
}

interface TokenEndpointResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/**
 * Exchange a refresh token for a fresh access token at the provider's token
 * endpoint. Throws `RefreshTokenRevokedError` when the provider signals the
 * refresh token is no longer valid (user revoked access, password changed,
 * etc.) — the caller should surface RECONNECT_REQUIRED in that case.
 *
 * Does NOT persist the result — callers should pass the returned tokens to
 * `refreshAndPersist()` (or inline `upsertConnectedAccount`).
 */
export async function refreshAccessToken(
  provider: ConnectedAccountProvider,
  refreshToken: string
): Promise<RefreshedTokens> {
  const cfg = resolveProviderConfig(provider);
  if (!cfg.clientId || !cfg.clientSecret || !cfg.tokenUrl) {
    // Provider OAuth not configured on the server — we can't refresh.
    // Treat as reconnect-required so the user is prompted rather than
    // silently failing with a confusing error.
    throw new RefreshTokenRevokedError(
      provider,
      `${provider} OAuth client credentials are not configured on the server; cannot refresh tokens.`
    );
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    ...(cfg.extraParams || {}),
  });

  let res: Response;
  try {
    res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    });
  } catch (err) {
    // Network/transport error — not a revoked token, just transient.
    throw new Error(
      `Failed to reach ${provider} token endpoint for refresh: ${(err as Error).message}`
    );
  }

  let data: TokenEndpointResponse;
  try {
    data = (await res.json()) as TokenEndpointResponse;
  } catch {
    throw new Error(
      `${provider} token endpoint returned non-JSON response (status ${res.status})`
    );
  }

  // Google/Microsoft return `error: "invalid_grant"` when the refresh token
  // has expired or been revoked. That's the genuinely-reconnect case.
  if (!res.ok || data.error) {
    const errCode = data.error || `http_${res.status}`;
    if (errCode === 'invalid_grant' || errCode === 'invalid_request') {
      throw new RefreshTokenRevokedError(
        provider,
        `${provider} refresh token is no longer valid (${errCode}): ${data.error_description || ''}`.trim()
      );
    }
    // Other errors (server 500, transient) — propagate as generic error.
    throw new Error(
      `${provider} token refresh failed: ${errCode} — ${data.error_description || ''}`.trim()
    );
  }

  if (!data.access_token) {
    throw new Error(`${provider} token refresh returned no access_token`);
  }

  const expiresIn = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
  const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

  return {
    accessToken: data.access_token,
    // Google rarely rotates refresh tokens; Microsoft may. Keep the new one
    // if provided, otherwise the caller should preserve the stored one.
    refreshToken: data.refresh_token || undefined,
    tokenExpiry,
    scopes: data.scope || undefined,
  };
}

/**
 * Refresh + persist in one step. Rotates the access token (and refresh token
 * if the provider issued a new one) in `user_connected_accounts`, preserving
 * all other fields (display name, etc.) via `upsertConnectedAccount`'s
 * conditional-update semantics.
 *
 * Returns the freshly persisted account (re-read from the DB so the caller
 * gets the canonical post-refresh state).
 */
export async function refreshAndPersist(
  account: ConnectedAccount
): Promise<ConnectedAccount | undefined> {
  if (!account.refreshToken) {
    // No refresh token to use — the caller should treat this as reconnect.
    throw new RefreshTokenRevokedError(
      account.provider,
      `${account.provider} account has no refresh token stored; cannot refresh.`
    );
  }

  const refreshed = await refreshAccessToken(account.provider, account.refreshToken);

  await upsertConnectedAccount({
    provider: account.provider,
    userEmail: account.userEmail,
    // Rotate the access token + expiry. When the provider didn't issue a new
    // refresh token, pass `undefined` so upsert preserves the existing one
    // (see applyUpdate() conditional logic in connected-accounts.ts).
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    scopes: refreshed.scopes || account.scopes,
    tokenExpiry: refreshed.tokenExpiry,
  });

  // Re-read to return the canonical post-refresh row.
  try {
    return await getConnectedAccountById(account.id);
  } catch {
    return undefined;
  }
}

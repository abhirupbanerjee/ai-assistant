/**
 * Token vault — fetches per-user OAuth tokens from the AI-assistant app.
 *
 * This file is reusable across all connector microservices.
 * Copy into your connector and add your provider to the VaultProvider union.
 *
 * The vault (encrypted tokens at rest) lives in the app's `user_connected_accounts`
 * Postgres table. The connector is a standalone microservice with no DB access,
 * so it calls the app's internal HMAC-verified endpoint to retrieve decrypted
 * tokens for a given user + provider.
 *
 * Flow:
 *   1. `getUserToken(cfg, userId, provider)` calls `GET {APP_BASE_URL}/api/connectors/vault/tokens`
 *      with the same `X-Connector-User-Id` + `X-Connector-User-Sig` headers that
 *      the app injected on the original /invoke call.
 *   2. The app verifies the HMAC, looks up the row, and returns decrypted tokens.
 *   3. The connector caches the access token in-memory with a short TTL.
 *   4. On 404 (no connected account), returns null.
 *   5. On 409 (RECONNECT_REQUIRED), returns a `ReconnectRequired` sentinel.
 *
 * Security:
 *   - The HMAC signature is regenerated here using the same shared secret.
 *   - Tokens are cached in-memory only (never persisted to disk).
 *   - Raw tokens are never logged.
 */

import { createHmac } from 'crypto';
import { getJson, HttpError } from './http';
import { AppConfig } from './config';
import { logger } from './logger';

/**
 * Update this union when adding a new connector/provider.
 * Must match the ConnectedAccountProvider type in the host app.
 */
export type VaultProvider = 'google' | 'microsoft' | 'github' | 'notion' | 'slack' | 'gitbook';

/** A successfully retrieved per-user token. */
export interface VaultToken {
  accessToken: string;
  refreshToken: string | null;
  scopes: string;
  /** ISO 8601 expiry timestamp, or null if unknown. */
  tokenExpiry: string | null;
}

/**
 * Sentinel returned when the vault has a connected account record but the
 * access token is missing or the account is marked as needing reconnection.
 */
export const RECONNECT_REQUIRED = Symbol('RECONNECT_REQUIRED');

/** Result of a vault lookup: a token, null (no account), or reconnect. */
export type VaultResult = VaultToken | null | typeof RECONNECT_REQUIRED;

interface CachedVaultToken extends VaultToken {
  /** Epoch ms when the access token expires (derived from tokenExpiry or a default). */
  expiresAt: number;
}

/** In-memory cache keyed by `${provider}:${userId}`. */
const tokenCache = new Map<string, CachedVaultToken>();

/** Pre-refresh this many ms before the real expiry. */
const EXPIRY_SAFETY_MS = 60_000;

/** Default TTL when the token has no expiry (treat as short-lived). */
const DEFAULT_TTL_MS = 50 * 60 * 1000; // 50 minutes

/** Cache TTL for "no connected account" results (avoid hammering the vault). */
const NEGATIVE_CACHE_MS = 30_000;
const negativeCache = new Map<string, number>();

/**
 * Build the HMAC signature for the X-Connector-User-Id header.
 */
function signUserId(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(userId, 'utf8').digest('hex');
}

/**
 * Fetch a per-user OAuth token from the app's vault endpoint.
 *
 * Returns:
 *   - `VaultToken` — a valid per-user token
 *   - `null` — no connected account for this user/provider
 *   - `RECONNECT_REQUIRED` — the account exists but needs reconnection
 */
export async function getUserToken(
  cfg: AppConfig,
  userId: string,
  provider: VaultProvider
): Promise<VaultResult> {
  // If the vault is not configured, immediately return null.
  if (!cfg.appBaseUrl || !cfg.hmacSecret) {
    return null;
  }

  const cacheKey = `${provider}:${userId}`;
  const now = Date.now();

  // Check positive cache.
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - now > EXPIRY_SAFETY_MS) {
    logger.debug('Vault token cache hit', { userId, provider });
    return cached;
  }

  // Check negative cache.
  const negExpiry = negativeCache.get(cacheKey);
  if (negExpiry && negExpiry > now) {
    logger.debug('Vault negative cache hit', { userId, provider });
    return null;
  }

  const sig = signUserId(userId, cfg.hmacSecret);
  const url = `${cfg.appBaseUrl}/api/connectors/vault/tokens?userId=${encodeURIComponent(userId)}&provider=${encodeURIComponent(provider)}`;
  const headers = {
    'X-Connector-User-Id': userId,
    'X-Connector-User-Sig': sig,
  };

  let data: unknown;
  try {
    data = await getJson(url, headers, cfg.apiTimeoutMs);
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 404) {
        negativeCache.set(cacheKey, now + NEGATIVE_CACHE_MS);
        logger.info('Vault: user not connected', { userId, provider });
        return null;
      }
      if (err.status === 409) {
        logger.warn('Vault: reconnect required', { userId, provider });
        return RECONNECT_REQUIRED;
      }
      logger.error('Vault endpoint error', {
        userId, provider, status: err.status, body: err.body.slice(0, 200),
      });
      return null;
    }
    logger.error('Vault request failed', { userId, provider, error: (err as Error).message });
    return null;
  }

  const resp = data as {
    accessToken?: string;
    refreshToken?: string | null;
    scopes?: string;
    tokenExpiry?: string | null;
  };

  if (!resp.accessToken) {
    logger.warn('Vault returned no access token', { userId, provider });
    return null;
  }

  // Compute the absolute expiry epoch-ms.
  let expiresAt: number;
  if (resp.tokenExpiry) {
    const parsed = Date.parse(resp.tokenExpiry);
    expiresAt = Number.isNaN(parsed) ? now + DEFAULT_TTL_MS : parsed;
  } else {
    expiresAt = now + DEFAULT_TTL_MS;
  }

  const token: CachedVaultToken = {
    accessToken: resp.accessToken,
    refreshToken: resp.refreshToken || null,
    scopes: resp.scopes || '',
    tokenExpiry: resp.tokenExpiry || null,
    expiresAt,
  };

  tokenCache.set(cacheKey, token);
  negativeCache.delete(cacheKey);

  logger.info('Vault: per-user token retrieved', {
    userId, provider, expiresAt: new Date(expiresAt).toISOString(),
  });

  return token;
}

/**
 * Invalidate the cached per-user token (e.g. on a 401 from the API provider).
 */
export function invalidateUserToken(userId: string, provider: VaultProvider): void {
  const cacheKey = `${provider}:${userId}`;
  tokenCache.delete(cacheKey);
  logger.debug('Vault token cache invalidated', { userId, provider });
}

/** Reset all cached vault state — mainly for tests. */
export function resetVaultState(): void {
  tokenCache.clear();
  negativeCache.clear();
}

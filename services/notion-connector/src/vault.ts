/**
 * Token vault — fetches per-user Notion OAuth tokens from the AI-assistant app.
 *
 * Copied from services/_connector-template/src/vault.ts
 * VaultProvider extended with 'notion'.
 */

import { createHmac } from 'crypto';
import { getJson, HttpError } from './http';
import { AppConfig } from './config';
import { logger } from './logger';

export type VaultProvider = 'google' | 'microsoft' | 'github' | 'notion' | 'gitbook';

export interface VaultToken {
  accessToken: string;
  refreshToken: string | null;
  scopes: string;
  tokenExpiry: string | null;
}

export const RECONNECT_REQUIRED = Symbol('RECONNECT_REQUIRED');

export type VaultResult = VaultToken | null | typeof RECONNECT_REQUIRED;

interface CachedVaultToken extends VaultToken {
  expiresAt: number;
}

const tokenCache = new Map<string, CachedVaultToken>();

const EXPIRY_SAFETY_MS = 60_000;
const DEFAULT_TTL_MS = 50 * 60 * 1000;
const NEGATIVE_CACHE_MS = 30_000;
const negativeCache = new Map<string, number>();

function signUserId(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(userId, 'utf8').digest('hex');
}

export async function getUserToken(
  cfg: AppConfig,
  userId: string,
  provider: VaultProvider
): Promise<VaultResult> {
  if (!cfg.appBaseUrl || !cfg.hmacSecret) {
    return null;
  }

  const cacheKey = `${provider}:${userId}`;
  const now = Date.now();

  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - now > EXPIRY_SAFETY_MS) {
    logger.debug('Vault token cache hit', { userId, provider });
    return cached;
  }

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
    data = await getJson(url, headers, cfg.notionTimeoutMs);
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

  let expiresAt: number;
  if (resp.tokenExpiry) {
    const parsed = Date.parse(resp.tokenExpiry);
    expiresAt = Number.isNaN(parsed) ? now + DEFAULT_TTL_MS : parsed;
  } else {
    // Notion tokens never expire — use a very long cache TTL.
    expiresAt = now + 24 * 60 * 60 * 1000; // 24 hours
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

export function invalidateUserToken(userId: string, provider: VaultProvider): void {
  const cacheKey = `${provider}:${userId}`;
  tokenCache.delete(cacheKey);
  logger.debug('Vault token cache invalidated', { userId, provider });
}

export function resetVaultState(): void {
  tokenCache.clear();
  negativeCache.clear();
}

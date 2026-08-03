/**
 * Google adapter — mints and refreshes OAuth2 access tokens.
 *
 * Two modes:
 *  1. **Per-user (Phase 2):** when `userId` is provided AND the vault has a
 *     connected-account token for that user, the adapter uses the per-user
 *     access token (acting as that user, not the service account).
 *  2. **Service account (Phase 1 / fallback):** mints a token from the GCP
 *     service-account JSON key via the JWT-bearer grant flow. This is the
 *     default when no `userId` is given or the vault has no token for the user.
 *
 * No external dependencies: JWT signing uses Node's built-in `crypto`.
 * Tokens are cached in-memory with a short safety-margin TTL so we don't
 * hit the token endpoint / vault on every request.
 *
 * Reference:
 *   https://developers.google.com/identity/protocols/oauth2/service-account#jwt-auth
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { logger } from './logger';
import { postJson, HttpError } from './http';
import { AppConfig } from './config';
import { getUserToken, invalidateUserToken, RECONNECT_REQUIRED, VaultToken, resetVaultState } from './vault';
export { RECONNECT_REQUIRED };

/** Subset of the service-account JSON key file we care about. */
interface ServiceAccountKey {
  type: 'service_account';
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  token_uri?: string;
}

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** Cache entry for a minted access token. */
interface CachedToken {
  accessToken: string;
  /** Epoch ms when the token expires. */
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
/** Prevents concurrent token requests from racing. */
let pendingToken: Promise<string> | null = null;

/** Pre-refresh the token this many ms before its real expiry. */
const EXPIRY_SAFETY_MS = 60_000;

/** Minimum TTL before we consider a cached token stale. */
const MIN_TTL_MS = 5_000;

let loadedKey: ServiceAccountKey | null = null;

/** Load and parse the service-account JSON key (from env or file path). */
function loadServiceAccountKey(cfg: AppConfig): ServiceAccountKey {
  if (loadedKey) return loadedKey;

  let raw: string;
  if (cfg.serviceAccountJson) {
    raw = cfg.serviceAccountJson;
    logger.debug('Loading service account from SERVICE_ACCOUNT_JSON env var');
  } else {
    logger.debug('Loading service account from file', { path: cfg.serviceAccountPath });
    try {
      raw = fs.readFileSync(cfg.serviceAccountPath, 'utf8');
    } catch (err) {
      throw new Error(
        `Failed to read service-account key at ${cfg.serviceAccountPath}: ${(err as Error).message}`
      );
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Service-account key is not valid JSON: ${(err as Error).message}`);
  }

  const key = parsed as ServiceAccountKey;
  if (key.type !== 'service_account' || !key.private_key || !key.client_email) {
    throw new Error(
      'Service-account JSON missing required fields (type=service_account, private_key, client_email).'
    );
  }
  loadedKey = key;
  logger.info('Service account loaded', { email: key.client_email, project: key.project_id });
  return key;
}

/**
 * Sign a JWT with the service-account private key (RS256).
 *
 * Header:  { alg: "RS256", typ: "JWT", kid: <private_key_id> }
 * Payload: { iss: client_email, scope: <space-joined scopes>,
 *            aud: token_uri, iat: now, exp: now + 1h }
 */
function signJwt(key: ServiceAccountKey, scopes: string[], tokenUri: string): string {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: key.private_key_id,
  };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: key.client_email,
    scope: scopes.join(' '),
    aud: tokenUri,
    iat: now,
    // 1 hour — the maximum Google allows for service-account JWTs.
    exp: now + 3600,
  };

  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const signingInput = `${enc(header)}.${enc(payload)}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  // The private_key PEM uses \n escape sequences in the JSON; pass as-is.
  const signature = sign.sign(key.private_key, 'base64url');

  return `${signingInput}.${signature}`;
}

/**
 * Mint a fresh access token via the JWT-bearer grant flow.
 * Throws on any non-2xx response.
 */
async function mintToken(cfg: AppConfig): Promise<CachedToken> {
  const key = loadServiceAccountKey(cfg);
  const tokenUri = key.token_uri || DEFAULT_TOKEN_URI;
  const jwt = signJwt(key, cfg.googleScopes, tokenUri);

  logger.debug('Minting access token', { tokenUri, scopes: cfg.googleScopes });

  const body = {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  };

  let data: unknown;
  try {
    data = await postJson(tokenUri, body, {}, cfg.googleTimeoutMs);
  } catch (err) {
    if (err instanceof HttpError) {
      throw new Error(
        `Google token endpoint returned ${err.status}: ${err.body.slice(0, 300)}`
      );
    }
    throw err;
  }

  const resp = data as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!resp.access_token || typeof resp.expires_in !== 'number') {
    throw new Error(
      `Google token response missing access_token: ${JSON.stringify(resp).slice(0, 300)}`
    );
  }

  const expiresAt = Date.now() + resp.expires_in * 1000;
  logger.info('Access token minted', {
    expiresInSec: resp.expires_in,
    expiresAt: new Date(expiresAt).toISOString(),
  });

  return { accessToken: resp.access_token, expiresAt };
}

/**
 * Resolve which access token to use for a given request.
 *
 * Decision order:
 *  1. If `userId` is provided, check the vault for a per-user token.
 *     - If the vault returns `RECONNECT_REQUIRED`, propagate it so the
 *       caller can surface a structured error (§8 Task 6).
 *     - If the vault returns a token, use it (acting as that user).
 *     - If the vault returns null (no connected account), fall through
 *       to the service-account token.
 *  2. Mint/refresh the service-account token (Phase 1 fallback).
 *
 * Returns either an access-token string or the `RECONNECT_REQUIRED` sentinel.
 */
export async function getAccessToken(
  cfg: AppConfig,
  userId?: string
): Promise<string | typeof RECONNECT_REQUIRED> {
  // Per-user path (Phase 2).
  if (userId) {
    const vaultResult = await getUserToken(cfg, userId, 'google');
    if (vaultResult === RECONNECT_REQUIRED) {
      return RECONNECT_REQUIRED;
    }
    if (vaultResult) {
      return vaultResult.accessToken;
    }
    // null → fall through to service account.
  }

  // Service-account path (Phase 1 / fallback).
  const now = Date.now();

  // Reuse cached token if it still has enough life left.
  if (cachedToken && cachedToken.expiresAt - now > EXPIRY_SAFETY_MS + MIN_TTL_MS) {
    return cachedToken.accessToken;
  }

  // Coalesce concurrent refreshes.
  if (pendingToken) {
    return pendingToken;
  }

  pendingToken = (async () => {
    try {
      cachedToken = await mintToken(cfg);
      return cachedToken.accessToken;
    } catch (err) {
      // Discard any stale token on failure so the next call retries.
      cachedToken = null;
      logger.error('Failed to mint access token', {
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
 * Force-discard the cached service-account token (e.g. on a 401 from Google).
 * Also invalidates the per-user vault token when `userId` is provided.
 */
export function invalidateToken(userId?: string): void {
  if (userId) {
    invalidateUserToken(userId, 'google');
  }
  cachedToken = null;
  logger.debug('Access token cache invalidated', { userId: userId || null });
}

/**
 * Build the Authorization header for a Google API request.
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
    // Throwing the sentinel lets withRetry() detect it without a try/catch
    // around every call site. The Symbol is not an Error instance.
    throw RECONNECT_REQUIRED;
  }
  return { Authorization: `Bearer ${token}`, ...(extra || {}) };
}

/** Exposed for tests / health checks. */
export function getServiceAccountEmail(cfg: AppConfig): string {
  return loadServiceAccountKey(cfg).client_email;
}

/** Reset all cached state — mainly for tests. */
export function resetGoogleState(): void {
  cachedToken = null;
  pendingToken = null;
  loadedKey = null;
  resetVaultState();
}

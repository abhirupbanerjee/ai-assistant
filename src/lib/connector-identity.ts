/**
 * Shared connector identity helpers.
 *
 * The drive-connector microservice needs a trusted user identity so it can
 * look up per-user OAuth tokens in the vault. Because LLM-generated tool
 * arguments could spoof a `userId` field, identity must travel out-of-band
 * in signed headers.
 *
 * This module builds `X-Connector-User-Id` + `X-Connector-User-Sig` headers
 * using HMAC-SHA256 over the user's email. It was extracted from
 * `src/lib/tools/function-api.ts` so API routes (e.g. the Drive bridge) can
 * reuse the same signing logic without importing tool-layer code.
 */

import { createHmac } from 'crypto';

export function getConnectorHmacSecret(): string | null {
  const secret = process.env.CONNECTOR_HMAC_SECRET;
  if (!secret || secret.trim() === '') return null;
  return secret;
}

/**
 * Build signed connector identity headers for the given user email.
 *
 * - When a secret is configured, returns both `X-Connector-User-Id` and
 *   `X-Connector-User-Sig` so the connector can verify the request.
 * - When no secret is configured (Phase 1 / shared service-account mode),
 *   returns only the unsigned `X-Connector-User-Id` header so connectors that
 *   haven't upgraded to HMAC verification can still read it.
 */
export function buildConnectorIdentityHeaders(userId: string | undefined): Record<string, string> {
  if (!userId) return {};
  const secret = getConnectorHmacSecret();
  if (!secret) {
    return { 'X-Connector-User-Id': userId };
  }
  const sig = createHmac('sha256', secret).update(userId, 'utf8').digest('hex');
  return {
    'X-Connector-User-Id': userId,
    'X-Connector-User-Sig': sig,
  };
}

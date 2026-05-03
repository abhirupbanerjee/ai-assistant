/**
 * WhatsApp Webhook Signature Verification
 *
 * Handles HMAC-SHA256 signature verification for Meta Cloud API webhooks.
 */

import { createHmac } from 'crypto';

/**
 * Generate HMAC-SHA256 signature for a payload
 */
export function generateSignature(payload: string, appSecret: string): string {
  const hmac = createHmac('sha256', appSecret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verify webhook signature from Meta
 *
 * Meta sends the signature in the X-Hub-Signature-256 header.
 * Format: "sha256=<hex_digest>"
 */
export function verifySignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature = generateSignature(payload, appSecret);

  // Use timing-safe comparison to prevent timing attacks
  return timingSafeEqual(signature, expectedSignature);
}

/**
 * Verify webhook verify token (for GET verification challenge)
 *
 * We store a hash of the verify token, so we compare hashes.
 */
export function verifyWebhookToken(
  receivedToken: string,
  storedTokenHash: string
): boolean {
  const receivedHash = hashWebhookToken(receivedToken);
  return timingSafeEqual(receivedHash, storedTokenHash);
}

/**
 * Hash a webhook verify token for storage
 */
export function hashWebhookToken(token: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Timing-safe string comparison
 * Prevents timing attacks by always comparing all characters
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
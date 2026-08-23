/**
 * Credential Encryption Utility
 *
 * Uses AES-256-GCM for encrypting sensitive data like API keys and tokens.
 * Encryption key must be provided via DATA_SOURCE_ENCRYPTION_KEY environment variable.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Get the encryption key from environment
 * Key must be a 64-character hex string (32 bytes)
 */
function getEncryptionKey(): Buffer | null {
  const key = process.env.DATA_SOURCE_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    return null;
  }
  return Buffer.from(key, 'hex');
}

/**
 * Check if encryption is properly configured
 */
export function isEncryptionConfigured(): boolean {
  return getEncryptionKey() !== null;
}

/**
 * Encrypt a plaintext string
 * Returns format: iv:authTag:ciphertext (all base64 encoded)
 *
 * @param plaintext - The string to encrypt
 * @returns Encrypted string in the format iv:authTag:ciphertext
 * @throws Error if encryption is not configured
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error(
      'Encryption not configured. Set DATA_SOURCE_ENCRYPTION_KEY environment variable (64 hex characters).'
    );
  }

  // Generate random IV
  const iv = crypto.randomBytes(IV_LENGTH);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  // Encrypt
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  // Get auth tag
  const authTag = cipher.getAuthTag();

  // Return as iv:authTag:ciphertext (base64 encoded)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt an encrypted string
 *
 * @param encrypted - The encrypted string in format iv:authTag:ciphertext
 * @returns Decrypted plaintext string
 * @throws Error if decryption fails or encryption is not configured
 */
export function decrypt(encrypted: string): string {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error(
      'Encryption not configured. Set DATA_SOURCE_ENCRYPTION_KEY environment variable (64 hex characters).'
    );
  }

  // Parse the encrypted string
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted string format. Expected iv:authTag:ciphertext');
  }

  const [ivBase64, authTagBase64, ciphertextBase64] = parts;

  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const ciphertext = Buffer.from(ciphertextBase64, 'base64');

  // Validate lengths
  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid IV length');
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  // Decrypt
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Safely encrypt a value, returning null if the value is empty or encryption fails
 *
 * @param value - The value to encrypt (can be null/undefined)
 * @returns Encrypted string or null
 */
export function safeEncrypt(value: string | null | undefined): string | null {
  if (!value || value.trim() === '') {
    return null;
  }

  if (!isEncryptionConfigured()) {
    console.warn('[Encryption] Encryption key not configured, storing value unencrypted');
    return value; // Store unencrypted if key not configured (development mode)
  }

  try {
    return encrypt(value);
  } catch (error) {
    console.error('[Encryption] Failed to encrypt value:', error);
    return null;
  }
}

/**
 * True when a stored value is in the encrypted `iv:authTag:ciphertext` format.
 *
 * The format is unambiguous because the first two segments have fixed base64
 * lengths: the GCM IV (12 bytes) encodes to 16 base64 chars and the auth tag
 * (16 bytes) encodes to 24 base64 chars. Plaintext values (even ones that
 * contain colons) therefore never match.
 */
export function isEncryptedValue(value: string | null | undefined): boolean {
  if (!value || value.trim() === '') {
    return false;
  }
  const parts = value.split(':');
  if (parts.length !== 3) {
    return false;
  }
  return parts[0].length === 16 && parts[1].length === 24;
}

/**
 * Safely decrypt a value, returning null if decryption fails.
 *
 * @param value - The encrypted value (can be null/undefined)
 * @returns Decrypted string or null. Unencrypted dev-plaintext values are
 *          returned as-is; encrypted values that cannot be decrypted (wrong or
 *          missing DATA_SOURCE_ENCRYPTION_KEY) return null — never the raw
 *          ciphertext, which would otherwise be used as a credential.
 */
export function safeDecrypt(value: string | null | undefined): string | null {
  if (!value || value.trim() === '') {
    return null;
  }

  // Unencrypted dev plaintext is returned as-is.
  if (!isEncryptedValue(value)) {
    return value;
  }

  // An encrypted value with no key available cannot be decrypted. Fail closed
  // instead of returning the ciphertext.
  if (!isEncryptionConfigured()) {
    console.warn('[Encryption] Encryption key not configured; cannot decrypt stored value. Re-save the credential once the key is configured.');
    return null;
  }

  try {
    return decrypt(value);
  } catch (error) {
    // Fail closed: an encrypted value that cannot be decrypted (wrong/missing
    // DATA_SOURCE_ENCRYPTION_KEY) must never be returned as if it were the
    // plaintext secret — doing so sends the ciphertext as the credential and
    // surfaces as a misleading "401 Invalid Authentication" upstream.
    console.error(
      '[Encryption] Failed to decrypt value; the stored value was encrypted with a different DATA_SOURCE_ENCRYPTION_KEY. Re-save the credential.',
      error
    );
    return null;
  }
}

/**
 * Generate a new encryption key (for setup purposes)
 * @returns A 64-character hex string suitable for DATA_SOURCE_ENCRYPTION_KEY
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Mask a sensitive string for display (e.g., "sk-abc...xyz")
 *
 * @param value - The value to mask
 * @param showChars - Number of characters to show at start and end (default: 4)
 * @returns Masked string
 */
export function maskSensitiveValue(value: string | null | undefined, showChars: number = 4): string {
  if (!value) return '••••••••';
  if (value.length <= showChars * 2) return '•'.repeat(value.length);

  const start = value.substring(0, showChars);
  const end = value.substring(value.length - showChars);
  return `${start}${'•'.repeat(8)}${end}`;
}

/**
 * CredentialVault — envelope-encryption service for organization credentials.
 *
 * AI & API Setup Redesign, Phase B (plan §6 "Credential Storage & Vault",
 * Decision 7). This is a service layer over `node:crypto` AES-256-GCM built on
 * top of the existing `src/lib/encryption.ts` primitives:
 *
 *   KEK  = existing `DATA_SOURCE_ENCRYPTION_KEY` (32-byte master key)
 *   DEK  = fresh random 32 bytes generated per credential
 *   secret  is encrypted under the DEK
 *   DEK     is wrapped under the KEK
 *   AAD     = organization_id + provider_id + credential_id, passed as
 *             AES-GCM associated data so a ciphertext cannot be swapped into
 *             another tenant's row
 *
 * Format tagging (`v2:`) distinguishes the new envelope format from the legacy
 * `iv:authTag:ciphertext` format produced by `encryption.ts`. Legacy values
 * remain decryptable through the existing `safeDecrypt()` path, so no existing
 * key breaks during the rollout.
 *
 * Fail-closed: `getVaultKek()` throws when the KEK is absent. There is no
 * plaintext dev fallback for organization credentials (unlike `safeEncrypt()`).
 *
 * Redaction: audit entries and any display path only ever see `redactSecret()`
 * output — never the raw key. The raw plaintext is only available to internal
 * callers via `decryptCredentialSecret()` (used by the resolver in later
 * phases), never returned by mutation APIs.
 *
 * The only application write path to `organization_provider_credentials` is the
 * set of mutation functions at the bottom of this file. They rely on the
 * PostgreSQL trigger created in `src/lib/db/kysely.ts`
 * (`bump_org_credential_version`) plus an explicit version bump for the
 * application path; together these guarantee `credential_version` increments on
 * every key mutation (including ad-hoc SQL and backup restores).
 */

import crypto from 'crypto';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from './db/db-types';
import { safeDecrypt } from './encryption';

// ============================================================================
// Constants
// ============================================================================

export const V2_PREFIX = 'v2:';
export const KEK_ENV_VAR = 'DATA_SOURCE_ENCRYPTION_KEY';
export const KEK_BYTES = 32; // AES-256
export const KEK_HEX_LENGTH = KEK_BYTES * 2; // 64 hex characters
export const DEFAULT_KEK_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

// ============================================================================
// Types
// ============================================================================

/** Binding that pins a ciphertext to exactly one organization/provider/credential. */
export interface CredentialBinding {
  organizationId: number;
  providerId: string;
  credentialId: string;
}

/** Fully encrypted credential material, as stored in the credential row. */
export interface EncryptedCredential {
  /**
   * The row identity that owns this credential. Decryption re-derives the AAD
   * from these values via `buildCredentialAad()` so a ciphertext/DEK copied into
   * another row (different org/provider/credential) fails to decrypt. Optional
   * for backward compatibility with the legacy plaintext path.
   */
  organizationId?: number;
  providerId?: string;
  credentialId?: string;
  /** `v2:<iv>:<authTag>:<ciphertext>` — secret encrypted under the DEK with AAD. */
  secretCiphertext: string;
  /** `v2:<iv>:<authTag>:<wrappedDek>` — DEK wrapped under the KEK with AAD. */
  dekWrapped: string;
  /** Stored AAD binding string (verified against the re-derived value). */
  aad: string;
  /** KEK version used to wrap the DEK. */
  kekVersion: number;
}

// ============================================================================
// KEK (fail-closed)
// ============================================================================

/**
 * Resolve the vault KEK from `DATA_SOURCE_ENCRYPTION_KEY`.
 *
 * Fail closed: throws when the key is absent or malformed. There is no plaintext
 * fallback for organization credentials, so BYOK writes are rejected when the
 * KEK is not configured.
 */
export function getVaultKek(): Buffer {
  const key = process.env[KEK_ENV_VAR];
  if (!key || key.length !== KEK_HEX_LENGTH) {
    throw new Error(
      `CredentialVault: ${KEK_ENV_VAR} is not configured (expected ${KEK_HEX_LENGTH} hex characters = ${KEK_BYTES} bytes)`
    );
  }
  const buffer = Buffer.from(key, 'hex');
  if (buffer.length !== KEK_BYTES) {
    throw new Error(
      `CredentialVault: ${KEK_ENV_VAR} decoded to ${buffer.length} bytes (expected ${KEK_BYTES})`
    );
  }
  return buffer;
}

/** True when the KEK is configured. Never throws. */
export function isVaultKekConfigured(): boolean {
  const key = process.env[KEK_ENV_VAR];
  if (!key || key.length !== KEK_HEX_LENGTH) return false;
  try {
    return Buffer.from(key, 'hex').length === KEK_BYTES;
  } catch {
    return false;
  }
}

// ============================================================================
// AAD binding
// ============================================================================

/**
 * Build the AAD binding string from the tenant identity. The same string is
 * used as AES-GCM associated data both when encrypting the secret under the DEK
 * and when wrapping the DEK under the KEK.
 */
export function buildCredentialAad(binding: CredentialBinding): string {
  return [
    `org:${binding.organizationId}`,
    `provider:${binding.providerId}`,
    `credential:${binding.credentialId}`,
  ].join('|');
}

// ============================================================================
// Low-level AES-256-GCM helpers
// ============================================================================

function aesGcmEncrypt(
  key: Buffer,
  plaintext: Buffer,
  aad: string
): { iv: Buffer; authTag: Buffer; ciphertext: Buffer } {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, authTag: cipher.getAuthTag(), ciphertext };
}

function aesGcmDecrypt(
  key: Buffer,
  iv: Buffer,
  authTag: Buffer,
  ciphertext: Buffer,
  aad: string
): Buffer {
  if (iv.length !== IV_LENGTH) throw new Error('CredentialVault: invalid IV length');
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('CredentialVault: invalid auth tag length');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Encode a `v2:<iv>:<authTag>:<ciphertext>` blob. */
function encodeV2(iv: Buffer, authTag: Buffer, ciphertext: Buffer): string {
  // Note: the tag is the bare `v2` literal — `V2_PREFIX` already includes the
  // trailing colon and is only used for `startsWith` detection.
  return [
    'v2',
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/** Decode a `v2:<iv>:<authTag>:<ciphertext>` blob. */
function decodeV2(value: string): { iv: Buffer; authTag: Buffer; ciphertext: Buffer } {
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== 'v2') {
    throw new Error('CredentialVault: invalid v2: ciphertext format');
  }
  return {
    iv: Buffer.from(parts[1], 'base64'),
    authTag: Buffer.from(parts[2], 'base64'),
    ciphertext: Buffer.from(parts[3], 'base64'),
  };
}

// ============================================================================
// DEK wrap / unwrap (under KEK)
// ============================================================================

/** Wrap a DEK under the KEK, bound to the AAD. */
export function wrapDek(dek: Buffer, aad: string): string {
  const kek = getVaultKek();
  const { iv, authTag, ciphertext } = aesGcmEncrypt(kek, dek, aad);
  return encodeV2(iv, authTag, ciphertext);
}

/** Unwrap a DEK from its KEK-wrapped form, bound to the AAD. */
export function unwrapDek(dekWrapped: string, aad: string): Buffer {
  const kek = getVaultKek();
  const { iv, authTag, ciphertext } = decodeV2(dekWrapped);
  return aesGcmDecrypt(kek, iv, authTag, ciphertext, aad);
}

// ============================================================================
// Envelope encrypt / decrypt
// ============================================================================

/** True when `value` is in the new `v2:` envelope format. */
export function isV2Ciphertext(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(V2_PREFIX);
}

/** True when `value` is in the legacy `iv:authTag:ciphertext` format. */
export function isLegacyCiphertext(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (value.startsWith(V2_PREFIX)) return false;
  return value.split(':').length === 3;
}

/**
 * Encrypt a raw secret under a fresh per-credential DEK and wrap that DEK under
 * the KEK. Fails closed (throws) when the KEK is absent.
 */
export function encryptCredentialSecret(
  secret: string,
  binding: CredentialBinding
): EncryptedCredential {
  if (!secret) {
    throw new Error('CredentialVault: cannot encrypt an empty secret');
  }
  const aad = buildCredentialAad(binding);
  const dek = crypto.randomBytes(KEK_BYTES);

  const secretBlob = aesGcmEncrypt(dek, Buffer.from(secret, 'utf8'), aad);

  return {
    organizationId: binding.organizationId,
    providerId: binding.providerId,
    credentialId: binding.credentialId,
    secretCiphertext: encodeV2(secretBlob.iv, secretBlob.authTag, secretBlob.ciphertext),
    dekWrapped: wrapDek(dek, aad),
    aad,
    kekVersion: DEFAULT_KEK_VERSION,
  };
}

/**
 * Decrypt a credential secret.
 *
 * `v2:` values are decrypted through the envelope path (unwrap DEK, decrypt
 * secret, AAD-verified). Anything else is routed through the legacy
 * `safeDecrypt()` path so pre-existing `iv:authTag:ciphertext` values (and the
 * historical dev plaintext values) keep working during the rollout.
 */
export function decryptCredentialSecret(encrypted: EncryptedCredential): string {
  if (isV2Ciphertext(encrypted.secretCiphertext)) {
    // Re-derive the AAD from the row's actual identity rather than trusting the
    // stored `aad` string verbatim. This pins the ciphertext/DEK to exactly one
    // organization + provider + credential: a ciphertext or wrapped DEK copied
    // into another row's identity fails GCM authentication (and a stored `aad`
    // that disagrees with the row identity is rejected outright).
    if (
      encrypted.organizationId == null ||
      encrypted.providerId == null ||
      encrypted.credentialId == null
    ) {
      throw new Error('CredentialVault: missing binding identity (organization/provider/credential)');
    }
    const expectedAad = buildCredentialAad({
      organizationId: encrypted.organizationId,
      providerId: encrypted.providerId,
      credentialId: encrypted.credentialId,
    });
    if (encrypted.aad && encrypted.aad !== expectedAad) {
      throw new Error('CredentialVault: AAD binding mismatch (credential row identity changed)');
    }

    const dek = unwrapDek(encrypted.dekWrapped, expectedAad);
    const { iv, authTag, ciphertext } = decodeV2(encrypted.secretCiphertext);
    return aesGcmDecrypt(dek, iv, authTag, ciphertext, expectedAad).toString('utf8');
  }

  // Legacy `iv:authTag:ciphertext` (or dev plaintext) — delegated to the
  // existing encryption module so behavior is identical to `getProviderApiKey()`.
  return safeDecrypt(encrypted.secretCiphertext) ?? '';
}

// ============================================================================
// Rotation
// ============================================================================

/**
 * Rotate a credential's DEK (per-credential data key) independently of the KEK.
 *
 * The secret is re-encrypted under a brand-new random DEK, and that new DEK is
 * wrapped under the *same* KEK. This proves DEK rotation does not require KEK
 * rotation; the KEK only needs to rotate (re-wrap DEKs) when the master key
 * itself changes.
 */
export function rotateCredentialDek(encrypted: EncryptedCredential): EncryptedCredential {
  const secret = decryptCredentialSecret(encrypted);
  // Re-derive the AAD from the row identity (verified inside
  // decryptCredentialSecret), never trusting the stored value verbatim.
  if (
    encrypted.organizationId == null ||
    encrypted.providerId == null ||
    encrypted.credentialId == null
  ) {
    throw new Error('CredentialVault: missing binding identity (organization/provider/credential)');
  }
  const aad = buildCredentialAad({
    organizationId: encrypted.organizationId,
    providerId: encrypted.providerId,
    credentialId: encrypted.credentialId,
  });
  const newDek = crypto.randomBytes(KEK_BYTES);

  const secretBlob = aesGcmEncrypt(newDek, Buffer.from(secret, 'utf8'), aad);

  return {
    organizationId: encrypted.organizationId,
    providerId: encrypted.providerId,
    credentialId: encrypted.credentialId,
    secretCiphertext: encodeV2(secretBlob.iv, secretBlob.authTag, secretBlob.ciphertext),
    dekWrapped: wrapDek(newDek, aad),
    aad,
    kekVersion: encrypted.kekVersion || DEFAULT_KEK_VERSION,
  };
}

// ============================================================================
// Versioning + redaction
// ============================================================================

/**
 * Compute the next credential version. The application mutation path sets the
 * column explicitly; the PostgreSQL trigger in `src/lib/db/kysely.ts` is the
 * backstop that increments the version for ad-hoc SQL / backup restores where
 * the explicit bump did not happen.
 */
export function nextCredentialVersion(current: number): number {
  return current + 1;
}

/**
 * Mask a secret for display/audit. Never returns the raw value; only a bounded
 * prefix and suffix so a human can recognize the key without recovering it.
 */
export function redactSecret(secret: string | null | undefined): string {
  if (!secret) return '••••••••';
  // Secrets shorter than a safe length are fully masked — revealing even a
  // first4+last4 window would disclose most of a 9-character secret.
  if (secret.length < 16) return '••••••••';
  // For long secrets, reveal at most the last 4 characters.
  return `••••••••${secret.slice(-4)}`;
}

// ============================================================================
// Audit (Decision 11)
// ============================================================================

export type CredentialAuditAction =
  | 'created'
  | 'replaced'
  | 'disabled'
  | 'enabled'
  | 'tested'
  | 'rotated';

async function writeAudit(
  db: Kysely<DB>,
  entry: {
    organizationId: number;
    providerId: string;
    credentialId: string;
    actorUserId: number | null;
    action: CredentialAuditAction;
    redactedDetail: string | null;
  }
): Promise<void> {
  await db
    .insertInto('credential_audit_log')
    .values({
      organization_id: entry.organizationId,
      provider_id: entry.providerId,
      credential_id: entry.credentialId,
      actor_user_id: entry.actorUserId,
      action: entry.action,
      redacted_detail: entry.redactedDetail,
    })
    .execute();
}

// ============================================================================
// Single mutation path (the only application write path)
// ============================================================================

export interface CreateOrganizationCredentialInput {
  organizationId: number;
  providerId: string;
  credentialId: string;
  secret: string;
  actorUserId?: number | null;
  isDefault?: boolean;
}

/**
 * Create an organization credential. The raw secret is envelope-encrypted; only
 * the redacted form ever reaches the audit log.
 */
export async function createOrganizationCredential(
  db: Kysely<DB>,
  input: CreateOrganizationCredentialInput
): Promise<number> {
  const binding: CredentialBinding = {
    organizationId: input.organizationId,
    providerId: input.providerId,
    credentialId: input.credentialId,
  };
  const encrypted = encryptCredentialSecret(input.secret, binding);

  const result = await db
    .insertInto('organization_provider_credentials')
    .values({
      organization_id: input.organizationId,
      provider_id: input.providerId,
      credential_id: input.credentialId,
      secret_ciphertext: encrypted.secretCiphertext,
      dek_wrapped: encrypted.dekWrapped,
      kek_version: encrypted.kekVersion,
      aad: encrypted.aad,
      is_default: input.isDefault ? true : false,
      status: 'active',
    })
    .onConflict((oc) =>
      oc.columns(['organization_id', 'provider_id', 'credential_id']).doNothing()
    )
    .returning('id')
    .executeTakeFirst();

  // On conflict nothing is returned — resolve the existing row id for idempotency.
  if (result) {
    await writeAudit(db, {
      organizationId: input.organizationId,
      providerId: input.providerId,
      credentialId: input.credentialId,
      actorUserId: input.actorUserId ?? null,
      action: 'created',
      redactedDetail: redactSecret(input.secret),
    });
    return result.id;
  }

  const existing = await db
    .selectFrom('organization_provider_credentials')
    .select('id')
    .where('organization_id', '=', input.organizationId)
    .where('provider_id', '=', input.providerId)
    .where('credential_id', '=', input.credentialId)
    .executeTakeFirst();

  return existing?.id ?? 0;
}

export interface ReplaceOrganizationCredentialInput {
  organizationId: number;
  providerId: string;
  credentialId: string;
  secret: string;
  actorUserId?: number | null;
}

/**
 * Replace a credential's key material (fresh DEK, new secret). Bumps
 * `credential_version` via the explicit SQL increment (the trigger only fires
 * when no explicit bump was made).
 */
export async function replaceOrganizationCredential(
  db: Kysely<DB>,
  input: ReplaceOrganizationCredentialInput
): Promise<boolean> {
  const binding: CredentialBinding = {
    organizationId: input.organizationId,
    providerId: input.providerId,
    credentialId: input.credentialId,
  };
  const encrypted = encryptCredentialSecret(input.secret, binding);

  const result = await db
    .updateTable('organization_provider_credentials')
    .set({
      secret_ciphertext: encrypted.secretCiphertext,
      dek_wrapped: encrypted.dekWrapped,
      kek_version: encrypted.kekVersion,
      aad: encrypted.aad,
      status: 'active',
      credential_version: sql<number>`credential_version + 1`,
    })
    .where('organization_id', '=', input.organizationId)
    .where('provider_id', '=', input.providerId)
    .where('credential_id', '=', input.credentialId)
    .executeTakeFirst();

  const updated = Number(result.numUpdatedRows ?? 0) > 0;
  if (updated) {
    await writeAudit(db, {
      organizationId: input.organizationId,
      providerId: input.providerId,
      credentialId: input.credentialId,
      actorUserId: input.actorUserId ?? null,
      action: 'replaced',
      redactedDetail: redactSecret(input.secret),
    });
  }
  return updated;
}

export interface SetCredentialStatusInput {
  organizationId: number;
  providerId: string;
  credentialId: string;
  actorUserId?: number | null;
}

/**
 * Disable a credential. Bumps `credential_version` (a status change is a key
 * mutation — it must invalidate any cached client).
 */
export async function disableOrganizationCredential(
  db: Kysely<DB>,
  input: SetCredentialStatusInput
): Promise<boolean> {
  const result = await db
    .updateTable('organization_provider_credentials')
    .set({
      status: 'disabled',
      credential_version: sql<number>`credential_version + 1`,
    })
    .where('organization_id', '=', input.organizationId)
    .where('provider_id', '=', input.providerId)
    .where('credential_id', '=', input.credentialId)
    .executeTakeFirst();

  const updated = Number(result.numUpdatedRows ?? 0) > 0;
  if (updated) {
    await writeAudit(db, {
      organizationId: input.organizationId,
      providerId: input.providerId,
      credentialId: input.credentialId,
      actorUserId: input.actorUserId ?? null,
      action: 'disabled',
      redactedDetail: null,
    });
  }
  return updated;
}

/**
 * Re-enable a credential. Bumps `credential_version`.
 */
export async function enableOrganizationCredential(
  db: Kysely<DB>,
  input: SetCredentialStatusInput
): Promise<boolean> {
  const result = await db
    .updateTable('organization_provider_credentials')
    .set({
      status: 'active',
      credential_version: sql<number>`credential_version + 1`,
    })
    .where('organization_id', '=', input.organizationId)
    .where('provider_id', '=', input.providerId)
    .where('credential_id', '=', input.credentialId)
    .executeTakeFirst();

  const updated = Number(result.numUpdatedRows ?? 0) > 0;
  if (updated) {
    await writeAudit(db, {
      organizationId: input.organizationId,
      providerId: input.providerId,
      credentialId: input.credentialId,
      actorUserId: input.actorUserId ?? null,
      action: 'enabled',
      redactedDetail: null,
    });
  }
  return updated;
}

/**
 * Rotate a credential's DEK in place (independent of KEK). Bumps
 * `credential_version` and writes an audit entry with the redacted secret.
 */
export async function rotateOrganizationCredentialDek(
  db: Kysely<DB>,
  input: SetCredentialStatusInput
): Promise<boolean> {
  const existing = await db
    .selectFrom('organization_provider_credentials')
    .select(['id', 'secret_ciphertext', 'dek_wrapped', 'aad', 'kek_version'])
    .where('organization_id', '=', input.organizationId)
    .where('provider_id', '=', input.providerId)
    .where('credential_id', '=', input.credentialId)
    .executeTakeFirst();

  if (!existing) return false;

  const rotated = rotateCredentialDek({
    organizationId: input.organizationId,
    providerId: input.providerId,
    credentialId: input.credentialId,
    secretCiphertext: existing.secret_ciphertext,
    dekWrapped: existing.dek_wrapped,
    aad: existing.aad,
    kekVersion: existing.kek_version,
  });

  const result = await db
    .updateTable('organization_provider_credentials')
    .set({
      secret_ciphertext: rotated.secretCiphertext,
      dek_wrapped: rotated.dekWrapped,
      kek_version: rotated.kekVersion,
      aad: rotated.aad,
      credential_version: sql<number>`credential_version + 1`,
    })
    .where('id', '=', existing.id)
    .executeTakeFirst();

  const updated = Number(result.numUpdatedRows ?? 0) > 0;
  if (updated) {
    await writeAudit(db, {
      organizationId: input.organizationId,
      providerId: input.providerId,
      credentialId: input.credentialId,
      actorUserId: input.actorUserId ?? null,
      action: 'rotated',
      redactedDetail: null,
    });
  }
  return updated;
}

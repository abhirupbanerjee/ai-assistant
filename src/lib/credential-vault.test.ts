import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KEK_ENV_VAR,
  buildCredentialAad,
  decryptCredentialSecret,
  encryptCredentialSecret,
  getVaultKek,
  isLegacyCiphertext,
  isV2Ciphertext,
  isVaultKekConfigured,
  nextCredentialVersion,
  redactSecret,
  rotateCredentialDek,
  unwrapDek,
  wrapDek,
} from './credential-vault';
import { encrypt, isEncryptionConfigured } from './encryption';
import { resolveOrganizationCredentialById } from './provider-credential';

// A valid 64-hex-character (32-byte) master key used for all non-fail-closed
// tests. `getVaultKek()` reads process.env at call time, so setting it here is
// sufficient and can be temporarily cleared for the fail-closed test.
const TEST_KEK = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

test.before(() => {
  process.env[KEK_ENV_VAR] = TEST_KEK;
});

test.after(() => {
  delete process.env[KEK_ENV_VAR];
});

const binding = { organizationId: 1, providerId: 'openai', credentialId: 'cred-abc' };

// ============================================================================
// v2: envelope encrypt / decrypt round-trip
// ============================================================================

test('v2: envelope encrypt/decrypt round-trip', () => {
  const secret = 'sk-1234567890abcdef';
  const encrypted = encryptCredentialSecret(secret, binding);

  assert.equal(isV2Ciphertext(encrypted.secretCiphertext), true);
  assert.equal(isV2Ciphertext(encrypted.dekWrapped), true);
  assert.equal(encrypted.secretCiphertext.startsWith('v2:'), true);
  assert.equal(encrypted.dekWrapped.startsWith('v2:'), true);
  assert.equal(encrypted.kekVersion, 1);

  assert.equal(decryptCredentialSecret(encrypted), secret);
});

test('each v2: encryption produces a distinct DEK and ciphertext', () => {
  const secret = 'sk-same-secret';
  const a = encryptCredentialSecret(secret, binding);
  const b = encryptCredentialSecret(secret, binding);

  // Fresh random DEK + IV per credential ⇒ ciphertext and wrapped DEK differ.
  assert.notEqual(a.secretCiphertext, b.secretCiphertext);
  assert.notEqual(a.dekWrapped, b.dekWrapped);
  assert.equal(decryptCredentialSecret(a), secret);
  assert.equal(decryptCredentialSecret(b), secret);
});

// ============================================================================
// AAD binding
// ============================================================================

test('AAD binding: ciphertext cannot decrypt under a different organization', () => {
  const encrypted = encryptCredentialSecret('sk-secret', binding);

  const swapped = {
    ...encrypted,
    aad: buildCredentialAad({ organizationId: 2, providerId: 'openai', credentialId: 'cred-abc' }),
  };

  assert.throws(() => decryptCredentialSecret(swapped));
});

test('AAD binding: ciphertext/DEK copied into another row identity fails to decrypt', () => {
  const encrypted = encryptCredentialSecret('sk-secret', binding);

  // Copy the ciphertext + wrapped DEK + stored aad verbatim, but claim a
  // different row identity (org 2). The decrypt-time re-derivation of AAD must
  // reject it — the stored aad no longer matches the row's actual identity.
  const copiedIntoOtherRow = {
    organizationId: 2,
    providerId: 'openai',
    credentialId: 'cred-abc',
    secretCiphertext: encrypted.secretCiphertext,
    dekWrapped: encrypted.dekWrapped,
    aad: encrypted.aad,
    kekVersion: encrypted.kekVersion,
  };

  assert.throws(() => decryptCredentialSecret(copiedIntoOtherRow));
});

test('AAD binding: ciphertext cannot decrypt under a different provider', () => {
  const encrypted = encryptCredentialSecret('sk-secret', binding);

  const swapped = {
    ...encrypted,
    aad: buildCredentialAad({ organizationId: 1, providerId: 'gemini', credentialId: 'cred-abc' }),
  };

  assert.throws(() => decryptCredentialSecret(swapped));
});

test('AAD binding: ciphertext cannot decrypt under a different credential_id', () => {
  const encrypted = encryptCredentialSecret('sk-secret', binding);

  const swapped = {
    ...encrypted,
    aad: buildCredentialAad({ organizationId: 1, providerId: 'openai', credentialId: 'cred-xyz' }),
  };

  assert.throws(() => decryptCredentialSecret(swapped));
});

test('AAD binding: wrapped DEK also cannot be unwrapped under a different tenant', () => {
  const aad = buildCredentialAad(binding);
  const dek = getVaultKek(); // any 32-byte buffer works as a stand-in DEK
  const wrapped = wrapDek(dek, aad);
  const otherAad = buildCredentialAad({ organizationId: 9, providerId: 'openai', credentialId: 'cred-abc' });

  assert.throws(() => unwrapDek(wrapped, otherAad));
});

// ============================================================================
// Fail-closed when KEK absent
// ============================================================================

test('fail-closed: BYOK write rejected when KEK absent (no plaintext fallback)', () => {
  const saved = process.env[KEK_ENV_VAR];
  try {
    delete process.env[KEK_ENV_VAR];
    assert.equal(isVaultKekConfigured(), false);
    assert.throws(() => getVaultKek(), /not configured/);
    assert.throws(() => encryptCredentialSecret('sk-secret', binding), /not configured/);
    assert.throws(() => wrapDek(Buffer.alloc(32), buildCredentialAad(binding)), /not configured/);
  } finally {
    if (saved === undefined) delete process.env[KEK_ENV_VAR];
    else process.env[KEK_ENV_VAR] = saved;
  }
});

test('KEK is 32 bytes when configured', () => {
  assert.equal(isVaultKekConfigured(), true);
  assert.equal(getVaultKek().length, 32);
  assert.equal(isEncryptionConfigured(), true);
});

// ============================================================================
// Legacy format remains decryptable
// ============================================================================

test('legacy iv:authTag:ciphertext format remains decryptable', () => {
  const secret = 'sk-legacy-secret';
  const legacyValue = encrypt(secret); // encryption.ts legacy format

  assert.equal(isLegacyCiphertext(legacyValue), true);
  assert.equal(isV2Ciphertext(legacyValue), false);

  const decrypted = decryptCredentialSecret({
    secretCiphertext: legacyValue,
    dekWrapped: '',
    aad: '',
    kekVersion: 1,
  });

  assert.equal(decrypted, secret);
});

// ============================================================================
// credential_version increment
// ============================================================================

test('credential_version increments on mutation (pure version helper)', () => {
  assert.equal(nextCredentialVersion(1), 2);
  assert.equal(nextCredentialVersion(0), 1);
  assert.equal(nextCredentialVersion(7), 8);
});

// ============================================================================
// DEK rotation independent of KEK
// ============================================================================

test('DEK rotation is independent of KEK (same KEK, new DEK, same secret)', () => {
  const secret = 'sk-dek-rotation-secret';
  const original = encryptCredentialSecret(secret, binding);

  const rotated = rotateCredentialDek(original);

  // New DEK ⇒ new wrapped DEK and new ciphertext.
  assert.notEqual(rotated.dekWrapped, original.dekWrapped);
  assert.notEqual(rotated.secretCiphertext, original.secretCiphertext);
  // KEK unchanged — DEK rotation does not require KEK rotation.
  assert.equal(rotated.kekVersion, original.kekVersion);
  // Round-trip still works with the same KEK.
  assert.equal(decryptCredentialSecret(rotated), secret);
});

// ============================================================================
// Redaction
// ============================================================================

test('credential redaction never returns the raw key', () => {
  const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456';
  const redacted = redactSecret(secret);

  assert.notEqual(redacted, secret);
  assert.equal(redacted.includes('abcdefghijklmnop'), false); // middle never shown
  assert.equal(redacted.startsWith('••••••••'), true); // no prefix disclosure
  assert.equal(redacted.endsWith('3456'), true); // at most the last 4 chars
});

test('redaction handles empty and short secrets safely', () => {
  assert.equal(redactSecret(''), '••••••••');
  assert.equal(redactSecret(null), '••••••••');
  assert.equal(redactSecret('short'), '••••••••');
});

test('redaction fully masks short secrets (no prefix/suffix disclosure)', () => {
  // A 9-character secret must not leak 8/9 of its characters via first4+last4.
  const secret = 'sk-abcd12';
  const redacted = redactSecret(secret);
  assert.equal(redacted, '••••••••');
  assert.equal(redacted.includes(secret), false);
  assert.equal(redactSecret('123456789012345').includes('123'), false);
});

test('exact credential resolution validates the requested id, not a sibling provider key', async () => {
  const makeRow = (credentialId: string, secret: string) => {
    const encrypted = encryptCredentialSecret(secret, {
      organizationId: 1, providerId: 'openai', credentialId,
    });
    return {
      provider_id: 'openai',
      credential_id: credentialId,
      credential_version: 1,
      status: 'active',
      secret_ciphertext: encrypted.secretCiphertext,
      dek_wrapped: encrypted.dekWrapped,
      aad: encrypted.aad,
      kek_version: encrypted.kekVersion,
    };
  };
  const rows = [
    makeRow('cred-first', 'sk-first-credential'),
    makeRow('cred-requested', 'sk-requested-credential'),
  ];
  const filters = new Map<string, unknown>();
  const builder = {
    select() { return builder; },
    where(column: string, _operator: string, value: unknown) {
      filters.set(column, value);
      return builder;
    },
    async executeTakeFirst() {
      return rows.find((row) =>
        row.provider_id === filters.get('provider_id') &&
        row.credential_id === filters.get('credential_id')
      );
    },
  };
  const db = { selectFrom() { return builder; } };

  const resolved = await resolveOrganizationCredentialById(
    db as never, 1, 'openai', 'cred-requested'
  );
  assert.equal(resolved.credentialId, 'cred-requested');
  assert.equal(resolved.apiKey, 'sk-requested-credential');
  assert.equal(filters.get('credential_id'), 'cred-requested');
});

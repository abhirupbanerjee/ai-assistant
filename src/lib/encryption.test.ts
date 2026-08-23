import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'crypto';
import {
  safeEncrypt,
  safeDecrypt,
  isEncryptedValue,
  isEncryptionConfigured,
  generateEncryptionKey,
} from './encryption';

const KEY = 'DATA_SOURCE_ENCRYPTION_KEY';

function setKey(key: string | undefined): void {
  if (key === undefined) {
    delete process.env[KEY];
  } else {
    process.env[KEY] = key;
  }
}

test('safeEncrypt/safeDecrypt round-trips with a configured key', () => {
  const key = generateEncryptionKey();
  setKey(key);
  try {
    const encrypted = safeEncrypt('sk-test-secret');
    assert.ok(encrypted, 'encrypt should produce a value');
    assert.ok(isEncryptedValue(encrypted), 'encrypted value should be detected as encrypted');
    assert.equal(safeDecrypt(encrypted), 'sk-test-secret');
  } finally {
    setKey(undefined);
  }
});

test('safeDecrypt returns null for empty values', () => {
  assert.equal(safeDecrypt(null), null);
  assert.equal(safeDecrypt(undefined), null);
  assert.equal(safeDecrypt(''), null);
  assert.equal(safeDecrypt('   '), null);
});

test('safeDecrypt passes through unencrypted dev plaintext', () => {
  assert.equal(safeDecrypt('sk-plaintext-key'), 'sk-plaintext-key');
  assert.equal(isEncryptedValue('sk-plaintext-key'), false);
});

test('safeDecrypt treats plaintext containing colons as plaintext', () => {
  // "a:b:c" has 3 segments but the segments are not base64 IV/tag lengths,
  // so it must be treated as plaintext, not as an encrypted blob.
  assert.equal(isEncryptedValue('a:b:c'), false);
  assert.equal(safeDecrypt('a:b:c'), 'a:b:c');
});

test('safeDecrypt fails closed (null) when the encryption key changed', () => {
  const keyA = generateEncryptionKey();
  const keyB = generateEncryptionKey();

  setKey(keyA);
  const encrypted = safeEncrypt('sk-secret');
  assert.ok(encrypted, 'encrypt with key A should succeed');

  // Wrong key → decryption must fail closed with null, never return ciphertext.
  setKey(keyB);
  try {
    assert.equal(safeDecrypt(encrypted), null);
  } finally {
    setKey(undefined);
  }
});

test('safeDecrypt returns value as-is when encryption is not configured', () => {
  setKey(undefined);
  assert.equal(isEncryptionConfigured(), false);
  // Plaintext stored in dev mode keeps working.
  assert.equal(safeDecrypt('sk-dev-plaintext'), 'sk-dev-plaintext');
});

test('safeDecrypt fails closed when the key is missing but the value is encrypted', () => {
  const key = generateEncryptionKey();
  setKey(key);
  const encrypted = safeEncrypt('sk-secret');
  assert.ok(encrypted, 'encrypt with a configured key should succeed');

  // Remove the key entirely: an encrypted value must fail closed (null), never
  // return the ciphertext.
  setKey(undefined);
  try {
    assert.equal(isEncryptedValue(encrypted), true);
    assert.equal(safeDecrypt(encrypted), null);
  } finally {
    setKey(undefined);
  }
});

test('isEncryptedValue detects the iv:authTag:ciphertext format', () => {
  assert.equal(isEncryptedValue(null), false);
  assert.equal(isEncryptedValue(''), false);
  assert.equal(isEncryptedValue('plain'), false);
  // 32-byte key material yields a 3-part base64-encoded value.
  const key = crypto.randomBytes(32);
  setKey(key.toString('hex'));
  try {
    const encrypted = safeEncrypt('sk-secret');
    assert.ok(encrypted);
    assert.equal(encrypted.split(':').length, 3);
    assert.equal(isEncryptedValue(encrypted), true);
  } finally {
    setKey(undefined);
  }
});

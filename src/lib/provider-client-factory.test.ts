import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProviderClientFactory,
  selectCredentialForProvider,
  buildCredentialCacheKey,
  type CredentialRef,
} from './provider-client-factory';

const openaiRef = (overrides: Partial<CredentialRef> = {}): CredentialRef => ({
  providerId: 'openai',
  credentialId: 'cred-1',
  credentialVersion: 1,
  apiKey: 'sk-test',
  apiBase: null,
  ...overrides,
});

// ============================================================================
// LRU cache: hit / miss keyed by credential_id + credential_version
// ============================================================================

test('cache hit returns the same client instance for the same key', () => {
  const factory = new ProviderClientFactory();
  const ref = openaiRef();

  const first = factory.getClient(ref);
  const second = factory.getClient(ref);

  assert.equal(first, second);
  assert.equal(factory.size, 1);
});

test('different credential_version is a cache miss (new client)', () => {
  const factory = new ProviderClientFactory();

  const v1 = factory.getClient(openaiRef({ credentialVersion: 1 }));
  const v2 = factory.getClient(openaiRef({ credentialVersion: 2 }));

  assert.notEqual(v1, v2);
  assert.equal(factory.size, 2);
});

test('different credential_id is a cache miss (new client)', () => {
  const factory = new ProviderClientFactory();

  const a = factory.getClient(openaiRef({ credentialId: 'cred-a' }));
  const b = factory.getClient(openaiRef({ credentialId: 'cred-b' }));

  assert.notEqual(a, b);
  assert.equal(factory.size, 2);
});

test('credential_version bump invalidates the cached entry', () => {
  const factory = new ProviderClientFactory();

  const before = factory.getClient(openaiRef({ credentialVersion: 1 }));
  assert.equal(factory.size, 1);

  const after = factory.getClient(openaiRef({ credentialVersion: 2 }));
  assert.notEqual(before, after);
  assert.equal(factory.size, 2);
});

test('TTL expiry evicts the entry and rebuilds the client', () => {
  let now = 0;
  const factory = new ProviderClientFactory({ now: () => now, ttlMs: 1000 });
  const ref = openaiRef();

  const first = factory.getClient(ref);
  now = 500; // still within TTL
  const second = factory.getClient(ref);
  assert.equal(first, second);

  now = 1500; // past TTL
  const third = factory.getClient(ref);
  assert.notEqual(first, third);
});

test('LRU bound evicts the least-recently-used entry', () => {
  const factory = new ProviderClientFactory({ maxEntries: 2 });

  const a1 = factory.getClient(openaiRef({ credentialId: 'a' }));
  const b = factory.getClient(openaiRef({ credentialId: 'b' }));
  assert.equal(factory.size, 2);

  // Inserting c evicts a (least recently used).
  const c = factory.getClient(openaiRef({ credentialId: 'c' }));
  assert.equal(factory.size, 2);

  // a is now a miss → new instance.
  const a2 = factory.getClient(openaiRef({ credentialId: 'a' }));
  assert.notEqual(a1, a2);
  assert.ok(b);
  assert.ok(c);
});

test('buildCredentialCacheKey encodes provider, credential id, version and timeout', () => {
  assert.equal(
    buildCredentialCacheKey(openaiRef({ providerId: 'openai', credentialId: 'cred-1', credentialVersion: 3 })),
    'openai:cred-1:3:0'
  );
  assert.equal(
    buildCredentialCacheKey(openaiRef({ providerId: 'openai', credentialId: 'cred-1', credentialVersion: 3, timeoutMs: 300_000 })),
    'openai:cred-1:3:300000'
  );
});

// ============================================================================
// Multiple active keys → is_default selection
// ============================================================================

test('is_default credential is selected when no credential_id is requested', () => {
  const selected = selectCredentialForProvider(
    [
      { credentialId: 'a', status: 'active', isDefault: false },
      { credentialId: 'b', status: 'active', isDefault: true },
    ],
    null
  );
  assert.equal(selected?.credentialId, 'b');
});

test('requested credential_id overrides is_default', () => {
  const selected = selectCredentialForProvider(
    [
      { credentialId: 'a', status: 'active', isDefault: false },
      { credentialId: 'b', status: 'active', isDefault: true },
    ],
    'a'
  );
  assert.equal(selected?.credentialId, 'a');
});

test('disabled default is skipped; sole active credential is used', () => {
  const selected = selectCredentialForProvider(
    [
      { credentialId: 'a', status: 'active', isDefault: false },
      { credentialId: 'b', status: 'disabled', isDefault: true },
    ],
    null
  );
  assert.equal(selected?.credentialId, 'a');
});

test('multiple active keys with no default → null (never arbitrary)', () => {
  const selected = selectCredentialForProvider(
    [
      { credentialId: 'a', status: 'active', isDefault: false },
      { credentialId: 'b', status: 'active', isDefault: false },
    ],
    null
  );
  assert.equal(selected, null);
});

// ============================================================================
// Factory returns the correct provider SDK type
// ============================================================================

test('factory returns an OpenAI SDK client for openai-compatible providers', () => {
  const factory = new ProviderClientFactory();
  const client = factory.getClient(openaiRef());
  assert.equal(client.kind, 'openai');
  assert.ok(client.client);
});

test('factory returns an Anthropic SDK client for anthropic', () => {
  const factory = new ProviderClientFactory();
  const client = factory.getClient(
    openaiRef({ providerId: 'anthropic', apiKey: 'sk-ant', apiBase: null })
  );
  assert.equal(client.kind, 'anthropic');
});

test('factory returns a Google GenAI client for gemini', () => {
  const factory = new ProviderClientFactory();
  const client = factory.getClient(
    openaiRef({ providerId: 'gemini', apiKey: 'sk-gemini', apiBase: null })
  );
  assert.equal(client.kind, 'google-genai');
});

test('factory returns a Cohere client for cohere', () => {
  const factory = new ProviderClientFactory();
  const client = factory.getClient(
    openaiRef({ providerId: 'cohere', apiKey: 'sk-cohere', apiBase: null })
  );
  assert.equal(client.kind, 'cohere');
});

test('factory returns an http client for key-less local providers (bge)', () => {
  const factory = new ProviderClientFactory();
  const client = factory.getClient(
    openaiRef({ providerId: 'bge', apiKey: null, apiBase: null })
  );
  assert.equal(client.kind, 'http');
  if (client.kind === 'http') {
    assert.equal(client.providerId, 'bge');
    assert.equal(client.apiKey, null);
  }
});

test('factory rejects unknown providers', () => {
  const factory = new ProviderClientFactory();
  assert.throws(
    () => factory.getClient(openaiRef({ providerId: 'does-not-exist' })),
    /unsupported provider/
  );
});

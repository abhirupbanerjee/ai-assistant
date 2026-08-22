import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveCapabilityCore,
  type ResolveInput,
  type CapabilityConfigCandidate,
  type OrgCredentialCandidate,
  type PlatformCredentialCandidate,
  type LegacyCandidate,
} from './capability-resolver';
import {
  evaluateHealthReport,
  type CapabilitySnapshot,
} from './health-evaluator';

// ============================================================================
// Fixture builders
// ============================================================================

const legacy = (overrides: Partial<LegacyCandidate> = {}): LegacyCandidate => ({
  providerId: null,
  modelOrServiceId: null,
  apiKey: null,
  apiBase: null,
  available: false,
  ...overrides,
});

const config = (overrides: Partial<CapabilityConfigCandidate> = {}): CapabilityConfigCandidate => ({
  providerId: 'openai',
  credentialId: null,
  modelOrServiceId: 'gpt-4o',
  enabled: true,
  ...overrides,
});

const platformCred = (overrides: Partial<PlatformCredentialCandidate> = {}): PlatformCredentialCandidate => ({
  providerId: 'openai',
  status: 'active',
  apiKey: 'sk-platform',
  apiBase: null,
  ...overrides,
});

const orgCred = (overrides: Partial<OrgCredentialCandidate> = {}): OrgCredentialCandidate => ({
  providerId: 'openai',
  credentialId: 'cred-1',
  credentialVersion: 1,
  status: 'active',
  isDefault: false,
  apiKey: 'sk-org',
  apiBase: null,
  ...overrides,
});

function input(overrides: Partial<ResolveInput> = {}): ResolveInput {
  return {
    capability: 'llm',
    importance: 'REQUIRED',
    orgType: 'ENTITY',
    isDefaultOrg: false,
    credentialMode: 'ORGANIZATION_BYOK',
    config: config(),
    orgCredentials: [],
    platformCredentials: [],
    legacy: legacy(),
    ...overrides,
  };
}

// ============================================================================
// Resolver: credential modes + dual-read
// ============================================================================

test('PLATFORM_MANAGED resolves to platform credentials', () => {
  const result = resolveCapabilityCore(
    input({
      credentialMode: 'PLATFORM_MANAGED',
      platformCredentials: [platformCred({ apiKey: 'sk-platform' })],
    })
  );

  assert.equal(result.health, 'READY');
  assert.equal(result.available, true);
  assert.equal(result.providerId, 'openai');
  assert.equal(result.source, 'platform');
  assert.equal(result.credentialRef?.credentialId, 'platform');
  assert.equal(result.credentialRef?.apiKey, 'sk-platform');
});

test('ORGANIZATION_BYOK resolves to the org credential', () => {
  const result = resolveCapabilityCore(
    input({
      credentialMode: 'ORGANIZATION_BYOK',
      orgCredentials: [orgCred({ credentialId: 'cred-1', apiKey: 'sk-org', isDefault: true })],
    })
  );

  assert.equal(result.health, 'READY');
  assert.equal(result.available, true);
  assert.equal(result.source, 'organization');
  assert.equal(result.credentialRef?.credentialId, 'cred-1');
  assert.equal(result.credentialRef?.apiKey, 'sk-org');
});

test('ORGANIZATION_BYOK selects the configured credential_id over is_default', () => {
  const result = resolveCapabilityCore(
    input({
      credentialMode: 'ORGANIZATION_BYOK',
      config: config({ credentialId: 'cred-2' }),
      orgCredentials: [
        orgCred({ credentialId: 'cred-1', apiKey: 'sk-1', isDefault: true }),
        orgCred({ credentialId: 'cred-2', apiKey: 'sk-2', isDefault: false }),
      ],
    })
  );

  assert.equal(result.credentialRef?.credentialId, 'cred-2');
  assert.equal(result.credentialRef?.apiKey, 'sk-2');
});

test('BYOK never falls back to platform when the org credential is missing', () => {
  const result = resolveCapabilityCore(
    input({
      credentialMode: 'ORGANIZATION_BYOK',
      orgCredentials: [],
      platformCredentials: [platformCred({ apiKey: 'sk-platform' })],
    })
  );

  assert.equal(result.health, 'UNAVAILABLE');
  assert.equal(result.available, false);
  assert.equal(result.credentialRef, null);
  assert.equal(result.source, 'organization');
  assert.match(result.warnings.join(' '), /no platform fallback/);
});

test('BYOK treats a disabled org credential as unavailable (no platform fallback)', () => {
  const result = resolveCapabilityCore(
    input({
      credentialMode: 'ORGANIZATION_BYOK',
      orgCredentials: [orgCred({ status: 'disabled' })],
      platformCredentials: [platformCred()],
    })
  );

  assert.equal(result.health, 'UNAVAILABLE');
  assert.equal(result.credentialRef, null);
});

test('absent new config falls back to legacy resolution', () => {
  const result = resolveCapabilityCore(
    input({
      credentialMode: 'PLATFORM_MANAGED',
      config: null,
      legacy: legacy({ providerId: 'openai', modelOrServiceId: 'gpt-4o', apiKey: 'sk-legacy', available: true }),
    })
  );

  assert.equal(result.health, 'READY');
  assert.equal(result.source, 'legacy');
  assert.equal(result.credentialMode, 'LEGACY');
  assert.equal(result.providerId, 'openai');
  assert.equal(result.modelOrServiceId, 'gpt-4o');
  assert.equal(result.credentialRef?.apiKey, 'sk-legacy');
});

test('explicitly disabled new config resolves to NOT_CONFIGURED', () => {
  const result = resolveCapabilityCore(
    input({
      credentialMode: 'PLATFORM_MANAGED',
      config: config({ enabled: false }),
      platformCredentials: [platformCred()],
    })
  );

  assert.equal(result.health, 'NOT_CONFIGURED');
  assert.equal(result.available, false);
  assert.equal(result.credentialRef, null);
});

test('DEFAULT org parity: new path resolves the same provider/model/key as legacy', () => {
  const legacyResult = legacy({
    providerId: 'openai',
    modelOrServiceId: 'gpt-4o',
    apiKey: 'sk-legacy',
    available: true,
  });

  const resolved = resolveCapabilityCore(
    input({
      capability: 'llm',
      orgType: 'DEFAULT',
      isDefaultOrg: true,
      credentialMode: 'PLATFORM_MANAGED',
      config: config({ providerId: 'openai', modelOrServiceId: 'gpt-4o' }),
      platformCredentials: [platformCred({ apiKey: 'sk-legacy' })],
      legacy: legacyResult,
    })
  );

  assert.equal(resolved.providerId, legacyResult.providerId);
  assert.equal(resolved.modelOrServiceId, legacyResult.modelOrServiceId);
  assert.equal(resolved.credentialRef?.apiKey, legacyResult.apiKey);
  assert.equal(resolved.health, 'READY');
});

// ============================================================================
// Health evaluator: states + rules
// ============================================================================

const snap = (overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot => ({
  capabilityId: 'llm',
  importance: 'REQUIRED',
  configured: true,
  providerId: 'openai',
  credentialAvailable: true,
  ...overrides,
});

test('health report: all required ready → READY', () => {
  const report = evaluateHealthReport([
    snap({ capabilityId: 'llm' }),
    snap({ capabilityId: 'embeddings' }),
  ]);
  assert.equal(report.readiness, 'READY');
  assert.equal(report.saveBlocking, false);
});

test('health report: missing reranker → RAG continues (DEGRADED, not blocked)', () => {
  const report = evaluateHealthReport([
    snap({ capabilityId: 'llm' }),
    snap({ capabilityId: 'embeddings' }),
    snap({ capabilityId: 'reranking', importance: 'RECOMMENDED', configured: false, credentialAvailable: false, providerId: null }),
  ]);

  const reranking = report.capabilities.find((c) => c.capabilityId === 'reranking');
  assert.equal(reranking?.state, 'NOT_CONFIGURED');
  assert.equal(report.readiness, 'DEGRADED'); // reduced quality, still usable
  assert.notEqual(report.readiness, 'UNAVAILABLE');
  assert.notEqual(report.readiness, 'NOT_CONFIGURED');
});

test('health report: embeddings missing → ingestion blocked (UNAVAILABLE)', () => {
  const report = evaluateHealthReport([
    snap({ capabilityId: 'llm' }),
    snap({ capabilityId: 'embeddings', configured: true, credentialAvailable: false }),
  ]);

  const embeddings = report.capabilities.find((c) => c.capabilityId === 'embeddings');
  assert.equal(embeddings?.state, 'UNAVAILABLE');
  assert.equal(report.readiness, 'UNAVAILABLE');
});

test('health report: missing LLM/embeddings warn without blocking save', () => {
  const report = evaluateHealthReport([
    snap({ capabilityId: 'llm', configured: false, credentialAvailable: false, providerId: null }),
    snap({ capabilityId: 'embeddings', configured: false, credentialAvailable: false, providerId: null }),
  ]);

  assert.equal(report.saveBlocking, false);
  assert.ok(report.warnings.some((w) => w.includes('LLM')));
  assert.ok(report.warnings.some((w) => w.includes('Embeddings')));
  assert.equal(report.readiness, 'NOT_CONFIGURED');
});

test('health report: optional tool absence does not degrade readiness', () => {
  const report = evaluateHealthReport([
    snap({ capabilityId: 'llm' }),
    snap({ capabilityId: 'embeddings' }),
    snap({ capabilityId: 'code-analysis', importance: 'OPTIONAL', configured: false, credentialAvailable: false, providerId: null }),
  ]);

  assert.equal(report.readiness, 'READY');
});

test('health report: Claude-without-embeddings keeps LLM READY with a warning', () => {
  const report = evaluateHealthReport([
    snap({ capabilityId: 'llm', providerId: 'anthropic' }),
    snap({ capabilityId: 'embeddings', configured: true, credentialAvailable: false, providerId: 'openai' }),
  ]);

  const llm = report.capabilities.find((c) => c.capabilityId === 'llm');
  assert.equal(llm?.state, 'READY'); // Claude can chat
  assert.ok(llm?.warnings.some((w) => w.includes('Claude')));

  const embeddings = report.capabilities.find((c) => c.capabilityId === 'embeddings');
  assert.equal(embeddings?.state, 'UNAVAILABLE');
  assert.equal(report.readiness, 'UNAVAILABLE');
});

test('health report: alternate embeddings suppress the provider warning', () => {
  const report = evaluateHealthReport([
    snap({ capabilityId: 'llm', providerId: 'anthropic' }),
    snap({ capabilityId: 'embeddings', providerId: 'openai', configured: true, credentialAvailable: true }),
  ]);

  const llm = report.capabilities.find((c) => c.capabilityId === 'llm');
  assert.equal(llm?.state, 'READY');
  assert.equal(llm?.warnings.length, 0); // no "Claude lacks embeddings" warning
  assert.equal(report.readiness, 'READY');
});

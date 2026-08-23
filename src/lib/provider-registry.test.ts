import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REGISTRY_CAPABILITIES,
  REGISTRY_PROVIDERS,
  REGISTRY_PROVIDER_CAPABILITIES,
  buildFullRegistry,
  buildProviderCapabilityRows,
  buildSupportedProviderCapabilitySet,
  isProviderCapabilitySupported,
  resolveCapabilitySelectionMode,
  resolveProviderConnectionMode,
  seedProviderRegistry,
  validateCapabilitySelection,
} from './provider-registry';

test('compiled registry includes every canonical provider, capability, and mapping', () => {
  const registry = buildFullRegistry();

  assert.equal(registry.providers.length, REGISTRY_PROVIDERS.length);
  assert.equal(registry.capabilities.length, REGISTRY_CAPABILITIES.length);
  assert.equal(registry.providerCapabilities.length, REGISTRY_PROVIDER_CAPABILITIES.length);
  assert.ok(registry.providerCapabilities.length > 0);
});

test('every capability displayed by AI & API Setup has at least one provider', () => {
  const providersByCapability = new Map<string, number>();
  for (const mapping of buildFullRegistry().providerCapabilities) {
    if (!mapping.isSupported) continue;
    providersByCapability.set(
      mapping.capabilityId,
      (providersByCapability.get(mapping.capabilityId) ?? 0) + 1
    );
  }

  for (const capability of REGISTRY_CAPABILITIES) {
    assert.ok(
      (providersByCapability.get(capability.id) ?? 0) > 0,
      `${capability.id} must have at least one supported provider`
    );
  }
});

test('provider/capability validation allows supported pairs and rejects mismatches', () => {
  const supportedPairs = buildSupportedProviderCapabilitySet(
    buildFullRegistry().providerCapabilities
  );

  assert.equal(isProviderCapabilitySupported(supportedPairs, 'openai', 'llm'), true);
  assert.equal(isProviderCapabilitySupported(supportedPairs, 'tavily', 'web-search'), true);
  assert.equal(isProviderCapabilitySupported(supportedPairs, 'anthropic', 'embeddings'), false);
  assert.equal(isProviderCapabilitySupported(supportedPairs, 'tavily', 'llm'), false);
  assert.equal(isProviderCapabilitySupported(supportedPairs, 'unknown', 'llm'), false);
});

test('unsupported registry mappings are excluded from the validation allow-list', () => {
  const supportedPairs = buildSupportedProviderCapabilitySet([
    { providerId: 'openai', capabilityId: 'llm', isSupported: true },
    { providerId: 'openai', capabilityId: 'embeddings', isSupported: false },
  ]);

  assert.equal(isProviderCapabilitySupported(supportedPairs, 'openai', 'llm'), true);
  assert.equal(isProviderCapabilitySupported(supportedPairs, 'openai', 'embeddings'), false);
});

test('registry exposes valid podcast and reranker model metadata', () => {
  const mappings = buildFullRegistry().providerCapabilities;
  const openaiPodcast = mappings.find(
    (mapping) => mapping.providerId === 'openai' && mapping.capabilityId === 'podcast-audio'
  );
  const geminiPodcast = mappings.find(
    (mapping) => mapping.providerId === 'gemini' && mapping.capabilityId === 'podcast-audio'
  );
  const bge = mappings.find(
    (mapping) => mapping.providerId === 'bge' && mapping.capabilityId === 'reranking'
  );

  assert.deepEqual(openaiPodcast?.modelOrServiceIds, ['gpt-4o-mini-tts']);
  assert.deepEqual(geminiPodcast?.modelOrServiceIds, [
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts',
  ]);
  assert.deepEqual(bge?.modelOrServiceIds, ['bge-large', 'bge-base', 'local']);
  assert.equal(bge && resolveCapabilitySelectionMode(bge), 'service');
});

test('capability selection validation rejects unsupported or irrelevant ids', () => {
  assert.deepEqual(
    validateCapabilitySelection(
      { selectionMode: 'model', modelOrServiceIds: ['allowed-model'] },
      'unknown-model'
    ),
    { valid: false, reason: 'UNSUPPORTED_SELECTION' }
  );
  assert.deepEqual(
    validateCapabilitySelection(
      { selectionMode: 'none', modelOrServiceIds: null },
      'invented-service'
    ),
    { valid: false, reason: 'SELECTION_NOT_ALLOWED' }
  );
  assert.deepEqual(
    validateCapabilitySelection(
      { selectionMode: 'model', modelOrServiceIds: null },
      'dynamic-model',
      new Set(['dynamic-model'])
    ),
    { valid: true }
  );
});

test('provider-capability rows include presentation metadata used during reseeding', () => {
  const rows = buildProviderCapabilityRows(buildFullRegistry());
  const bge = rows.find(
    (row) => row.provider_id === 'bge' && row.capability_id === 'reranking'
  );
  assert.equal(bge?.selection_mode, 'service');
  assert.ok(bge?.model_or_service_ids);
});

test('registry reseeding reconciles mutable metadata on conflict', async () => {
  const updates = new Map<string, Record<string, unknown>>();
  const db = {
    insertInto(table: string) {
      const builder = {
        values() { return builder; },
        onConflict(callback: (oc: unknown) => unknown) {
          const conflict = {
            column() {
              return { doUpdateSet(value: Record<string, unknown>) { updates.set(table, value); } };
            },
            columns() {
              return { doUpdateSet(value: Record<string, unknown>) { updates.set(table, value); } };
            },
          };
          callback(conflict);
          return builder;
        },
        async execute() {},
      };
      return builder;
    },
  };

  await seedProviderRegistry(db as never);
  assert.ok(updates.get('providers')?.name);
  assert.ok(updates.get('capabilities')?.importance);
  assert.ok(updates.get('provider_capabilities')?.model_or_service_ids);
  assert.ok(updates.get('provider_capabilities')?.selection_mode);
});

test('connection metadata separates BYOK keys from tool-config and keyless providers', () => {
  assert.equal(resolveProviderConnectionMode('openai'), 'provider-key');
  assert.equal(resolveProviderConnectionMode('sonarcloud'), 'tool-config');
  assert.equal(resolveProviderConnectionMode('bge'), 'keyless');
});

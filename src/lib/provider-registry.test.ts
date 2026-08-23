import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REGISTRY_CAPABILITIES,
  REGISTRY_PROVIDERS,
  REGISTRY_PROVIDER_CAPABILITIES,
  buildFullRegistry,
  buildSupportedProviderCapabilitySet,
  isProviderCapabilitySupported,
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

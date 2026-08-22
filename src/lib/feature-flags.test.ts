import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertFeatureFlagCombinations,
  type FeatureFlagCombinations,
} from './feature-flag-combinations';

// ============================================================================
// Fixtures
// ============================================================================

const flags = (overrides: Partial<FeatureFlagCombinations> = {}): FeatureFlagCombinations => ({
  orgTenancyEnabled: false,
  vectorTenancyEnabled: false,
  orgCredentialResolverEnabled: false,
  aiApiSetupUiEnabled: false,
  ...overrides,
});

// ============================================================================
// Valid orderings
// ============================================================================

test('accepts the all-off baseline', () => {
  assert.doesNotThrow(() => assertFeatureFlagCombinations(flags()));
});

test('accepts org-tenancy alone (Phase A/B)', () => {
  assert.doesNotThrow(() =>
    assertFeatureFlagCombinations(flags({ orgTenancyEnabled: true }))
  );
});

test('accepts the Phase D ordering: org-tenancy + resolver + vector tenancy on', () => {
  assert.doesNotThrow(() =>
    assertFeatureFlagCombinations(
      flags({
        orgTenancyEnabled: true,
        orgCredentialResolverEnabled: true,
        vectorTenancyEnabled: true,
      })
    )
  );
});

// ============================================================================
// Invalid orderings
// ============================================================================

test('rejects vector-tenancy-enabled without org-tenancy-enabled', () => {
  assert.throws(
    () => assertFeatureFlagCombinations(flags({ vectorTenancyEnabled: true })),
    /vector-tenancy-enabled requires org-tenancy-enabled/
  );
});

test('rejects org-credential-resolver-enabled without org-tenancy-enabled', () => {
  assert.throws(
    () => assertFeatureFlagCombinations(flags({ orgCredentialResolverEnabled: true })),
    /org-credential-resolver-enabled requires org-tenancy-enabled/
  );
});

test('reports every violated dependency at once', () => {
  assert.throws(
    () =>
      assertFeatureFlagCombinations(
        flags({
          vectorTenancyEnabled: true,
          orgCredentialResolverEnabled: true,
        })
      ),
    /vector-tenancy-enabled requires org-tenancy-enabled/
  );
  assert.throws(
    () =>
      assertFeatureFlagCombinations(
        flags({
          vectorTenancyEnabled: true,
          orgCredentialResolverEnabled: true,
        })
      ),
    /org-credential-resolver-enabled requires org-tenancy-enabled/
  );
});

// ============================================================================
// ai-api-setup-ui-enabled has no dependency
// ============================================================================

test('ai-api-setup-ui-enabled is independent (no org-tenancy dependency)', () => {
  assert.doesNotThrow(() =>
    assertFeatureFlagCombinations(flags({ aiApiSetupUiEnabled: true }))
  );
});

test('ai-api-setup-ui-enabled composes with the resolver flag', () => {
  assert.doesNotThrow(() =>
    assertFeatureFlagCombinations(
      flags({
        orgTenancyEnabled: true,
        orgCredentialResolverEnabled: true,
        aiApiSetupUiEnabled: true,
      })
    )
  );
});

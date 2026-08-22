/**
 * Phase E integration-style tests — the three new org × credential-mode combos
 * plus BYOK isolation, cost attribution, and redaction. Pure logic (no live
 * PostgreSQL), exercising the resolver core + org-admin decisions + vault
 * redaction + vector filter composition.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCapabilityCore, type ResolveInput } from './capability-resolver';
import {
  canViewOrganizationCost,
  canManageOrganization,
  canViewOrganization,
  type OrgActor,
} from './org-admin';
import { redactSecret } from './credential-vault';
import { buildOrgAwareFilter, ORG_ID_PAYLOAD_KEY, stampOrganizationId } from './vector-store/qdrant';
import { validateIndividualMembership } from './organization';

const LEGACY_UNAVAILABLE = {
  providerId: null,
  modelOrServiceId: null,
  apiKey: null,
  apiBase: null,
  available: false,
};

function platformInput(
  credentialMode: 'PLATFORM_MANAGED' | 'ORGANIZATION_BYOK',
  platformApiKey: string | null,
  orgCredentials: ResolveInput['orgCredentials'] = []
): ResolveInput {
  return {
    capability: 'llm',
    importance: 'REQUIRED',
    orgType: 'ENTITY',
    isDefaultOrg: false,
    credentialMode,
    config: { providerId: 'openai', credentialId: null, modelOrServiceId: 'gpt-4o-mini', enabled: true },
    orgCredentials,
    platformCredentials: [{ providerId: 'openai', status: 'active', apiKey: platformApiKey, apiBase: null }],
    legacy: LEGACY_UNAVAILABLE,
  };
}

// ============================================================================
// Combo 2 — ENTITY + PLATFORM_MANAGED
// ============================================================================

test('ENTITY + PLATFORM_MANAGED resolves the platform credential', () => {
  const res = resolveCapabilityCore(platformInput('PLATFORM_MANAGED', 'sk-platform'));
  assert.equal(res.health, 'READY');
  assert.equal(res.source, 'platform');
  assert.equal(res.credentialRef?.credentialId, 'platform');
});

test('ENTITY + PLATFORM_MANAGED with missing platform key → UNAVAILABLE', () => {
  const res = resolveCapabilityCore(platformInput('PLATFORM_MANAGED', null));
  assert.equal(res.health, 'UNAVAILABLE');
});

// ============================================================================
// Combo 3 — ENTITY + ORGANIZATION_BYOK
// ============================================================================

test('ENTITY + ORGANIZATION_BYOK resolves the org credential (no platform fallback)', () => {
  const res = resolveCapabilityCore(
    platformInput('ORGANIZATION_BYOK', 'sk-platform-should-not-be-used', [
      {
        providerId: 'openai',
        credentialId: 'openai-org-key',
        credentialVersion: 3,
        status: 'active',
        isDefault: true,
        apiKey: 'sk-org-123',
        apiBase: null,
      },
    ])
  );
  assert.equal(res.health, 'READY');
  assert.equal(res.source, 'organization');
  assert.equal(res.credentialRef?.credentialId, 'openai-org-key');
});

test('ENTITY + ORGANIZATION_BYOK with missing org key → UNAVAILABLE, never platform', () => {
  // Platform key is present but BYOK must NOT silently fall back to it.
  const res = resolveCapabilityCore(platformInput('ORGANIZATION_BYOK', 'sk-platform'));
  assert.equal(res.health, 'UNAVAILABLE');
  assert.equal(res.source, 'organization');
  assert.equal(res.credentialRef, null);
  assert.ok(res.warnings.some((w) => w.includes('no platform fallback')));
});

test('ORGANIZATION_BYOK with no capability config never falls back to legacy keys', () => {
  const res = resolveCapabilityCore({
    capability: 'llm',
    importance: 'REQUIRED',
    orgType: 'ENTITY',
    isDefaultOrg: false,
    credentialMode: 'ORGANIZATION_BYOK',
    config: null,
    orgCredentials: [],
    platformCredentials: [{ providerId: 'openai', status: 'active', apiKey: 'sk-platform', apiBase: null }],
    legacy: { providerId: 'openai', modelOrServiceId: 'gpt-4o', apiKey: 'sk-legacy', apiBase: null, available: true },
  });
  assert.equal(res.health, 'NOT_CONFIGURED');
  assert.equal(res.source, 'organization');
  assert.equal(res.credentialRef, null);
});

// ============================================================================
// Combo 4 — INDIVIDUAL + ORGANIZATION_BYOK
// ============================================================================

test('INDIVIDUAL sole member must be org_admin', () => {
  const ok = validateIndividualMembership('INDIVIDUAL', [
    { userId: 1, role: 'org_admin', status: 'active' },
  ]);
  assert.deepEqual(ok, []);
});

test('INDIVIDUAL with a member role violates the one-member org_admin rule', () => {
  const violations = validateIndividualMembership('INDIVIDUAL', [
    { userId: 1, role: 'member', status: 'active' },
  ]);
  assert.ok(violations.length > 0);
});

test('INDIVIDUAL + ORGANIZATION_BYOK without a key → cost UNAVAILABLE', () => {
  const a: OrgActor = { role: 'admin', isSuperAdmin: false, organizationId: 10, membershipRole: 'org_admin' };
  const verdict = canViewOrganizationCost(a, { id: 10, credentialMode: 'ORGANIZATION_BYOK' }, false);
  assert.equal(verdict.canView, false);
  assert.equal(verdict.reason, 'byok_missing_credential');
});

// ============================================================================
// BYOK isolation — org A cannot read org B keys / cost / vectors
// ============================================================================

test('org A org_admin cannot manage or view org B', () => {
  const orgA: OrgActor = { role: 'admin', isSuperAdmin: false, organizationId: 1, membershipRole: 'org_admin' };
  assert.equal(canManageOrganization(orgA, 2), false);
  assert.equal(canViewOrganization(orgA, 2), false);
  assert.equal(canViewOrganizationCost(orgA, { id: 2, credentialMode: 'ORGANIZATION_BYOK' }, true).canView, false);
});

test('vector isolation: org A filter differs from org B filter', () => {
  const ingested = stampOrganizationId({ documentId: 'd' }, 100);
  const searchAsB = buildOrgAwareFilter(200, { categoryId: 5 })!;
  assert.notEqual(ingested[ORG_ID_PAYLOAD_KEY], searchAsB[ORG_ID_PAYLOAD_KEY]);
});

test('buildOrgAwareFilter: caller-supplied organization_id cannot override the tenant filter', () => {
  const filter = buildOrgAwareFilter(1, { organization_id: 2, categoryId: 5 })!;
  assert.equal(filter[ORG_ID_PAYLOAD_KEY], 1);
  assert.equal(filter.categoryId, 5);
});

// ============================================================================
// Redaction — raw keys are never returned / displayed
// ============================================================================

test('redactSecret never returns the raw key', () => {
  const raw = 'sk-abcdef1234567890';
  const redacted = redactSecret(raw);
  assert.notEqual(redacted, raw);
  assert.ok(!redacted.includes(raw));
  assert.ok(redacted.includes('••••••••'));
});

test('redactSecret handles null/empty safely', () => {
  assert.equal(redactSecret(null), '••••••••');
  assert.equal(redactSecret(''), '••••••••');
});

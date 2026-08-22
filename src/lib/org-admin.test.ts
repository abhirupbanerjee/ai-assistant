/**
 * Phase E unit tests — organization administration decision helpers
 * (src/lib/org-admin.ts). Pure logic, no database. Uses `node:test`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canManageOrganization,
  canViewOrganization,
  canViewOrganizationCost,
  validateNewOrganization,
  planOrgCreationMemberships,
  validateMembershipChange,
  generateCredentialId,
  type OrgActor,
} from './org-admin';
import { canDemoteOrRemoveOrgAdmin } from './organization';

function actor(overrides: Partial<OrgActor>): OrgActor {
  return {
    role: 'admin',
    isSuperAdmin: false,
    organizationId: 10,
    membershipRole: 'org_admin',
    ...overrides,
  };
}

// ============================================================================
// Authorization — frontend org IDs are never trusted
// ============================================================================

test('org_admin can manage only their own organization', () => {
  const a = actor({});
  assert.equal(canManageOrganization(a, 10), true);
  assert.equal(canManageOrganization(a, 99), false);
});

test('member cannot manage even their own organization', () => {
  const a = actor({ membershipRole: 'member' });
  assert.equal(canManageOrganization(a, 10), false);
});

test('super_admin override manages every organization', () => {
  const a = actor({ isSuperAdmin: true, organizationId: null, membershipRole: null });
  assert.equal(canManageOrganization(a, 1), true);
  assert.equal(canManageOrganization(a, 999), true);
});

test('view is read-only for any membership, but only within the own org', () => {
  const admin = actor({});
  assert.equal(canViewOrganization(admin, 10), true);
  assert.equal(canViewOrganization(admin, 99), false);

  const member = actor({ membershipRole: 'member' });
  assert.equal(canViewOrganization(member, 10), true);
  assert.equal(canViewOrganization(member, 99), false);
});

// ============================================================================
// Cost attribution (Decision 9)
// ============================================================================

test('PLATFORM_MANAGED cost is visible only to super_admin', () => {
  const org = { id: 10, credentialMode: 'PLATFORM_MANAGED' as const };
  assert.equal(canViewOrganizationCost(actor({ isSuperAdmin: true }), org, false).canView, true);
  assert.equal(canViewOrganizationCost(actor({}), org, false).canView, false);
  assert.equal(canViewOrganizationCost(actor({ membershipRole: 'member' }), org, false).canView, false);
});

test('ORGANIZATION_BYOK cost visible to own org_admin, denied to other orgs', () => {
  const org = { id: 10, credentialMode: 'ORGANIZATION_BYOK' as const };
  assert.equal(canViewOrganizationCost(actor({}), org, true).canView, true);
  assert.equal(
    canViewOrganizationCost(actor({ organizationId: 99 }), org, true).canView,
    false
  );
});

test('BYOK org without a key reports cost UNAVAILABLE', () => {
  const org = { id: 10, credentialMode: 'ORGANIZATION_BYOK' as const };
  const verdict = canViewOrganizationCost(actor({}), org, false);
  assert.equal(verdict.canView, false);
  assert.equal(verdict.reason, 'byok_missing_credential');
});

// ============================================================================
// Organization creation (plan §4)
// ============================================================================

test('DEFAULT organization cannot be created through the UI', () => {
  const v = validateNewOrganization({ name: 'X', type: 'DEFAULT', credentialMode: 'PLATFORM_MANAGED' });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('DEFAULT')));
});

test('ENTITY + INDIVIDUAL validate; unknown types reject', () => {
  assert.equal(validateNewOrganization({ name: 'Acme', type: 'ENTITY', credentialMode: 'PLATFORM_MANAGED' }).ok, true);
  assert.equal(validateNewOrganization({ name: 'Me', type: 'INDIVIDUAL', credentialMode: 'ORGANIZATION_BYOK' }).ok, true);
  assert.equal(validateNewOrganization({ name: 'X', type: 'NOPE', credentialMode: 'PLATFORM_MANAGED' }).ok, false);
  assert.equal(validateNewOrganization({ name: '', type: 'ENTITY', credentialMode: 'PLATFORM_MANAGED' }).ok, false);
});

test('first member auto-promoted to org_admin (ENTITY + INDIVIDUAL)', () => {
  const entity = planOrgCreationMemberships('ENTITY', 7);
  assert.deepEqual(entity, [{ userId: 7, role: 'org_admin' }]);

  const individual = planOrgCreationMemberships('INDIVIDUAL', 7);
  assert.deepEqual(individual, [{ userId: 7, role: 'org_admin' }]);

  // Delegated admin (super_admin creating on someone's behalf).
  const delegated = planOrgCreationMemberships('INDIVIDUAL', 7, 8);
  assert.deepEqual(delegated, [{ userId: 8, role: 'org_admin' }]);
});

// ============================================================================
// Membership invariants (last-admin block)
// ============================================================================

test('demoting the last org_admin is blocked', () => {
  const memberships = [{ userId: 1, role: 'org_admin' as const, status: 'active' }];
  assert.equal(validateMembershipChange(memberships, 1, 'demote').allowed, false);
  assert.equal(canDemoteOrRemoveOrgAdmin(memberships, 1).allowed, false);
});

test('POST /members: re-adding the sole org_admin as member is blocked (last-admin guard)', () => {
  // An existing org_admin targeted by a `role: 'member'` upsert (POST /members)
  // must hit the same last-admin guard as the PATCH/DELETE paths.
  const memberships = [
    { userId: 1, role: 'org_admin' as const, status: 'active' },
    { userId: 2, role: 'member' as const, status: 'active' },
  ];
  assert.equal(canDemoteOrRemoveOrgAdmin(memberships, 1).allowed, false);
  // A non-admin (or a second admin) is still freely reassignable.
  assert.equal(canDemoteOrRemoveOrgAdmin(memberships, 2).allowed, true);
  assert.equal(
    canDemoteOrRemoveOrgAdmin(
      [
        { userId: 1, role: 'org_admin' as const, status: 'active' },
        { userId: 3, role: 'org_admin' as const, status: 'active' },
      ],
      1
    ).allowed,
    true
  );
});

test('removing a non-admin member is allowed', () => {
  const memberships = [
    { userId: 1, role: 'org_admin' as const, status: 'active' },
    { userId: 2, role: 'member' as const, status: 'active' },
  ];
  assert.equal(validateMembershipChange(memberships, 2, 'remove').allowed, true);
  assert.equal(validateMembershipChange(memberships, 1, 'remove').allowed, false);
});

test('promotion is always allowed from a pure decision perspective', () => {
  const memberships = [{ userId: 1, role: 'org_admin' as const, status: 'active' }];
  assert.equal(validateMembershipChange(memberships, 2, 'promote').allowed, true);
});

// ============================================================================
// Credential id generation (server-side)
// ============================================================================

test('generateCredentialId is deterministic with an injected suffix', () => {
  assert.equal(generateCredentialId('openai', 'abc'), 'openai-abc');
});

test('generateCredentialId without suffix is unique', () => {
  const a = generateCredentialId('openai');
  const b = generateCredentialId('openai');
  assert.notEqual(a, b);
});

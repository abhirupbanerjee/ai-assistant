import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertExactlyOneOrgAdmin,
  assertIndividualMembership,
  assertOrganizationType,
  assertOrgAdminMutationAllowed,
  assertSingleDefault,
  canDemoteOrRemoveOrgAdmin,
  isValidOrganizationType,
  validateExactlyOneOrgAdmin,
  validateIndividualMembership,
  validateSingleDefault,
} from './organization';

// ============================================================================
// Org-type validation (DEFAULT / ENTITY / INDIVIDUAL)
// ============================================================================

test('organization type validation accepts only DEFAULT, ENTITY, INDIVIDUAL', () => {
  for (const type of ['DEFAULT', 'ENTITY', 'INDIVIDUAL']) {
    assert.equal(isValidOrganizationType(type), true);
    assert.doesNotThrow(() => assertOrganizationType(type));
  }

  for (const invalid of ['TEAM', '', 'default', 123, null, undefined]) {
    assert.equal(isValidOrganizationType(invalid), false);
    assert.throws(() => assertOrganizationType(invalid), /Invalid organization type/);
  }
});

// ============================================================================
// Single-Default invariant (exactly one is_default = true)
// ============================================================================

test('single-Default invariant requires exactly one default organization', () => {
  assert.deepEqual(
    validateSingleDefault([
      { type: 'DEFAULT', isDefault: true },
      { type: 'ENTITY', isDefault: false },
    ]),
    []
  );
  assert.doesNotThrow(() =>
    assertSingleDefault([
      { type: 'DEFAULT', isDefault: true },
      { type: 'ENTITY', isDefault: false },
    ])
  );

  // Zero defaults
  assert.deepEqual(
    validateSingleDefault([
      { type: 'ENTITY', isDefault: false },
      { type: 'INDIVIDUAL', isDefault: false },
    ]),
    ['expected exactly one default organization, found 0']
  );
  assert.throws(
    () =>
      assertSingleDefault([
        { type: 'ENTITY', isDefault: false },
        { type: 'INDIVIDUAL', isDefault: false },
      ]),
    /found 0/
  );

  // Two defaults
  assert.deepEqual(
    validateSingleDefault([
      { type: 'DEFAULT', isDefault: true },
      { type: 'ENTITY', isDefault: true },
    ]),
    ['expected exactly one default organization, found 2']
  );
});

// ============================================================================
// INDIVIDUAL one-member rule
// ============================================================================

test('INDIVIDUAL organization must have exactly one member, and that member is org_admin', () => {
  // Valid: one active org_admin member
  assert.deepEqual(
    validateIndividualMembership('INDIVIDUAL', [{ userId: 1, role: 'org_admin' }]),
    []
  );
  assert.doesNotThrow(() =>
    assertIndividualMembership('INDIVIDUAL', [{ userId: 1, role: 'org_admin' }])
  );

  // Zero members
  assert.deepEqual(validateIndividualMembership('INDIVIDUAL', []), [
    'INDIVIDUAL organization must have exactly one active member, found 0',
  ]);

  // Two members
  assert.deepEqual(
    validateIndividualMembership('INDIVIDUAL', [
      { userId: 1, role: 'org_admin' },
      { userId: 2, role: 'member' },
    ]),
    ['INDIVIDUAL organization must have exactly one active member, found 2']
  );

  // Sole member is not org_admin
  assert.deepEqual(validateIndividualMembership('INDIVIDUAL', [{ userId: 1, role: 'member' }]), [
    'INDIVIDUAL organization sole member must be org_admin',
  ]);
});

test('INDIVIDUAL one-member rule ignores disabled memberships', () => {
  assert.deepEqual(
    validateIndividualMembership('INDIVIDUAL', [
      { userId: 1, role: 'org_admin', status: 'active' },
      { userId: 2, role: 'member', status: 'disabled' },
    ]),
    []
  );
});

test('non-INDIVIDUAL organizations are not constrained by the one-member rule', () => {
  assert.deepEqual(validateIndividualMembership('ENTITY', []), []);
  assert.deepEqual(validateIndividualMembership('DEFAULT', [{ userId: 1, role: 'member' }]), []);
});

// ============================================================================
// Exactly-one-org_admin invariant
// ============================================================================

test('exactly-one-org_admin invariant requires exactly one active org_admin', () => {
  assert.deepEqual(
    validateExactlyOneOrgAdmin([
      { userId: 1, role: 'org_admin' },
      { userId: 2, role: 'member' },
      { userId: 3, role: 'member' },
    ]),
    []
  );
  assert.doesNotThrow(() =>
    assertExactlyOneOrgAdmin([
      { userId: 1, role: 'org_admin' },
      { userId: 2, role: 'member' },
    ])
  );

  // Zero admins
  assert.deepEqual(
    validateExactlyOneOrgAdmin([
      { userId: 1, role: 'member' },
      { userId: 2, role: 'member' },
    ]),
    ['expected exactly one active org_admin, found 0']
  );

  // Two admins
  assert.deepEqual(
    validateExactlyOneOrgAdmin([
      { userId: 1, role: 'org_admin' },
      { userId: 2, role: 'org_admin' },
    ]),
    ['expected exactly one active org_admin, found 2']
  );
});

test('exactly-one-org_admin invariant only counts active memberships', () => {
  assert.deepEqual(
    validateExactlyOneOrgAdmin([
      { userId: 1, role: 'org_admin', status: 'active' },
      { userId: 2, role: 'org_admin', status: 'disabled' },
    ]),
    []
  );
  assert.deepEqual(
    validateExactlyOneOrgAdmin([
      { userId: 1, role: 'org_admin', status: 'disabled' },
    ]),
    ['expected exactly one active org_admin, found 0']
  );
});

// ============================================================================
// Last-admin demotion/delete blocked
// ============================================================================

test('last active org_admin cannot be demoted or removed', () => {
  const memberships = [
    { userId: 1, role: 'org_admin' },
    { userId: 2, role: 'member' },
  ];

  const result = canDemoteOrRemoveOrgAdmin(memberships, 1);
  assert.equal(result.allowed, false);
  assert.match(result.reason ?? '', /last org_admin/);

  assert.throws(() => assertOrgAdminMutationAllowed(memberships, 1), /last org_admin/);
});

test('non-admin members can be demoted or removed freely', () => {
  const memberships = [
    { userId: 1, role: 'org_admin' },
    { userId: 2, role: 'member' },
  ];

  assert.deepEqual(canDemoteOrRemoveOrgAdmin(memberships, 2), { allowed: true });
  assert.doesNotThrow(() => assertOrgAdminMutationAllowed(memberships, 2));
});

test('an org_admin can be demoted when another active org_admin exists', () => {
  const memberships = [
    { userId: 1, role: 'org_admin' },
    { userId: 2, role: 'org_admin' },
    { userId: 3, role: 'member' },
  ];

  assert.deepEqual(canDemoteOrRemoveOrgAdmin(memberships, 1), { allowed: true });
  assert.doesNotThrow(() => assertOrgAdminMutationAllowed(memberships, 1));
});

test('demoting a disabled org_admin is never blocked', () => {
  const memberships = [
    { userId: 1, role: 'org_admin', status: 'disabled' },
    { userId: 2, role: 'member' },
  ];

  // A disabled admin is not an active admin, so removal is allowed (and the
  // organization currently has zero active admins — a separate invariant).
  assert.deepEqual(canDemoteOrRemoveOrgAdmin(memberships, 1), { allowed: true });
});

test('target not present in memberships is allowed (no-op)', () => {
  const memberships = [{ userId: 1, role: 'org_admin' }];
  assert.deepEqual(canDemoteOrRemoveOrgAdmin(memberships, 999), { allowed: true });
});

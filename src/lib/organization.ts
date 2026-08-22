/**
 * Organization tenancy validation helpers — Phase A (AI & API Setup Redesign).
 *
 * These are pure, database-free validations of the organization model described
 * in plan §4 and Decision 1/2. They exist so the invariants are testable today,
 * before the API-layer / trigger enforcement lands in later phases.
 *
 * ⚠️ Enforcement status (Phase A):
 *   - The DB schema only carries the structural guardrails (CHECK constraints,
 *     a partial unique index on `organizations.is_default`). Row-level invariant
 *     enforcement (exactly-one-org_admin, last-admin demotion block, INDIVIDUAL
 *     one-member rule) is NOT yet wired into create/update/delete paths. These
 *     functions are the canonical validators that later phases will call from
 *     those paths.
 */

export const ORGANIZATION_TYPES = ['DEFAULT', 'ENTITY', 'INDIVIDUAL'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const CREDENTIAL_MODES = ['PLATFORM_MANAGED', 'ORGANIZATION_BYOK'] as const;
export type CredentialMode = (typeof CREDENTIAL_MODES)[number];

export const MEMBERSHIP_ROLES = ['org_admin', 'member'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/** Organization membership status vocabulary (active membership counts toward invariants). */
export const MEMBERSHIP_STATUSES = ['active', 'disabled'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Minimal shape of an organization row for invariant validation. */
export interface OrganizationLike {
  type: string;
  isDefault: boolean;
}

/** Minimal shape of a membership row for invariant validation. */
export interface MembershipLike {
  userId: number | string;
  role: string;
  /** Defaults to 'active' when omitted. */
  status?: string;
}

// ============================================================================
// Org type validation
// ============================================================================

export function isValidOrganizationType(value: unknown): value is OrganizationType {
  return (
    typeof value === 'string' &&
    (ORGANIZATION_TYPES as readonly string[]).includes(value)
  );
}

export function assertOrganizationType(value: unknown): asserts value is OrganizationType {
  if (!isValidOrganizationType(value)) {
    throw new Error(
      `Invalid organization type: ${String(value)} (expected one of ${ORGANIZATION_TYPES.join(', ')})`
    );
  }
}

// ============================================================================
// Single-Default invariant (Decision 4 / plan §4)
// ============================================================================

/**
 * Exactly one organization must be the Default (`is_default === true`).
 * The DB mirrors this with a partial unique index; this validator is the
 * in-process check used before inserts/updates.
 */
export function validateSingleDefault(organizations: OrganizationLike[]): string[] {
  const defaults = organizations.filter((org) => org.isDefault === true);
  if (defaults.length !== 1) {
    return [`expected exactly one default organization, found ${defaults.length}`];
  }
  return [];
}

export function assertSingleDefault(organizations: OrganizationLike[]): void {
  const violations = validateSingleDefault(organizations);
  if (violations.length > 0) throw new Error(violations.join('; '));
}

// ============================================================================
// INDIVIDUAL one-member rule (Decision 2 / plan §4)
// ============================================================================

/**
 * An INDIVIDUAL organization must have exactly one (active) member, and that
 * sole member must be `org_admin`.
 */
export function validateIndividualMembership(
  orgType: string,
  memberships: MembershipLike[]
): string[] {
  if (orgType !== 'INDIVIDUAL') return [];

  const violations: string[] = [];
  const active = memberships.filter((m) => (m.status ?? 'active') === 'active');

  if (active.length !== 1) {
    violations.push(
      `INDIVIDUAL organization must have exactly one active member, found ${active.length}`
    );
  }
  if (active.length === 1 && active[0].role !== 'org_admin') {
    violations.push('INDIVIDUAL organization sole member must be org_admin');
  }

  return violations;
}

export function assertIndividualMembership(
  orgType: string,
  memberships: MembershipLike[]
): void {
  const violations = validateIndividualMembership(orgType, memberships);
  if (violations.length > 0) throw new Error(violations.join('; '));
}

// ============================================================================
// Exactly-one-org_admin invariant (Decision 2)
// ============================================================================

/**
 * Exactly one active membership per organization must hold the `org_admin` role.
 */
export function validateExactlyOneOrgAdmin(memberships: MembershipLike[]): string[] {
  const activeAdmins = memberships.filter(
    (m) => (m.status ?? 'active') === 'active' && m.role === 'org_admin'
  );
  if (activeAdmins.length !== 1) {
    return [`expected exactly one active org_admin, found ${activeAdmins.length}`];
  }
  return [];
}

export function assertExactlyOneOrgAdmin(memberships: MembershipLike[]): void {
  const violations = validateExactlyOneOrgAdmin(memberships);
  if (violations.length > 0) throw new Error(violations.join('; '));
}

// ============================================================================
// Last-admin demotion/delete block (Decision 2)
// ============================================================================

export interface OrgAdminMutationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Demoting or removing the last active `org_admin` is blocked until a successor
 * is assigned. Any other member may be demoted/removed freely.
 *
 * Phase A stub: this is the pure decision function; the create/update/delete
 * paths that must call it before mutating memberships land in later phases.
 */
export function canDemoteOrRemoveOrgAdmin(
  memberships: MembershipLike[],
  targetUserId: number | string
): OrgAdminMutationResult {
  const active = memberships.filter((m) => (m.status ?? 'active') === 'active');
  const target = active.find((m) => m.userId === targetUserId);

  // Not present, or not an admin → nothing to protect.
  if (!target || target.role !== 'org_admin') {
    return { allowed: true };
  }

  const activeAdmins = active.filter((m) => m.role === 'org_admin');
  if (activeAdmins.length === 1 && activeAdmins[0].userId === targetUserId) {
    return {
      allowed: false,
      reason: 'cannot demote or remove the last org_admin; assign a successor first',
    };
  }

  return { allowed: true };
}

export function assertOrgAdminMutationAllowed(
  memberships: MembershipLike[],
  targetUserId: number | string
): void {
  const result = canDemoteOrRemoveOrgAdmin(memberships, targetUserId);
  if (!result.allowed) throw new Error(result.reason ?? 'org_admin mutation blocked');
}

/**
 * Organization administration decision helpers — AI & API Setup Redesign,
 * Phase E (plan §4, §6, §9, §15).
 *
 * Pure, database-free decision functions for the BYOK administration surface:
 *
 *   - Server-side authorization (frontend org IDs are NEVER trusted): an
 *     `org_admin` may only manage their own organization; `super_admin` is an
 *     implicit admin of every organization (platform override). Members are
 *     read-only on their own organization.
 *   - Organization creation validation (`ENTITY` / `INDIVIDUAL`; `DEFAULT` is
 *     not creatable through the UI) and the first-member auto-promotion plan.
 *   - Membership role-change validation (last-admin demotion/delete blocked),
 *     delegating to the canonical `src/lib/organization.ts` invariants.
 *   - Cost-attribution visibility (Decision 9): `PLATFORM_MANAGED` cost is
 *     `super_admin`-only; `ORGANIZATION_BYOK` cost is visible to the org's
 *     `org_admin`; a BYOK org without a key reports cost UNAVAILABLE.
 *
 * The async database operations (actor resolution, row reads/writes) live in
 * the API route layer (`src/app/api/admin/ai-setup/_service.ts`) so this module
 * stays dependency-free and unit-testable with `node:test`.
 */

import crypto from 'crypto';
import type { CredentialMode, MembershipRole, OrganizationType } from './organization';
import {
  MEMBERSHIP_ROLES,
  CREDENTIAL_MODES,
  ORGANIZATION_TYPES,
  isValidOrganizationType,
  canDemoteOrRemoveOrgAdmin,
} from './organization';

// ============================================================================
// Types
// ============================================================================

/** Minimal authenticated actor for authorization decisions. */
export interface OrgActor {
  /** Global `users.role`. */
  role: string;
  isSuperAdmin: boolean;
  /** The actor's organization id (resolved server-side from session), if any. */
  organizationId: number | null;
  /** The actor's membership role within `organizationId`, if any. */
  membershipRole: MembershipRole | null;
}

export interface OrganizationAccessResult {
  allowed: boolean;
  reason?: string;
}

/** Cost visibility verdict for an organization (Decision 9). */
export interface CostVisibility {
  canView: boolean;
  /** Why cost is visible / hidden / unavailable. */
  reason: 'platform' | 'org' | 'denied' | 'byok_missing_credential';
}

// ============================================================================
// Role helpers
// ============================================================================

/** Global role string → org-admin capability. `super_admin` overrides everything. */
export function isSuperAdminRole(role: string | null | undefined): boolean {
  return role === 'super_admin';
}

// ============================================================================
// Authorization (frontend org IDs are never trusted)
// ============================================================================

/**
 * May `actor` manage (mutate config / credentials / memberships of) `orgId`?
 *
 *   - `super_admin` → every organization (platform override).
 *   - `org_admin` of `orgId` → only that organization.
 *   - everyone else → denied.
 */
export function canManageOrganization(actor: OrgActor, orgId: number): boolean {
  if (actor.isSuperAdmin) return true;
  return actor.organizationId === orgId && actor.membershipRole === 'org_admin';
}

/**
 * May `actor` view (read config / credentials / audit / cost) `orgId`?
 *
 *   - `super_admin` → every organization.
 *   - any active membership in `orgId` → read-only view of that org.
 */
export function canViewOrganization(actor: OrgActor, orgId: number): boolean {
  if (actor.isSuperAdmin) return true;
  return actor.organizationId === orgId && actor.membershipRole !== null;
}

export function assertCanManageOrganization(actor: OrgActor, orgId: number): void {
  if (!canManageOrganization(actor, orgId)) {
    throw new Error(
      'org_admin may only modify their own organization (or super_admin override)'
    );
  }
}

export function assertCanViewOrganization(actor: OrgActor, orgId: number): void {
  if (!canViewOrganization(actor, orgId)) {
    throw new Error('You do not have access to this organization');
  }
}

// ============================================================================
// Cost attribution visibility (Decision 9)
// ============================================================================

/**
 * Decide whether an actor may see cost for an organization.
 *
 *   - `super_admin` → always (PLATFORM_MANAGED cost is super_admin-only).
 *   - `org_admin` of an ORGANIZATION_BYOK org WITH a key → own org cost.
 *   - `org_admin` of an ORGANIZATION_BYOK org WITHOUT a key → UNAVAILABLE.
 *   - `org_admin` of a PLATFORM_MANAGED org → denied (platform cost is
 *     super_admin-only).
 *   - everyone else → denied.
 */
export function canViewOrganizationCost(
  actor: OrgActor,
  org: { id: number; credentialMode: CredentialMode },
  hasActiveOrgCredential: boolean
): CostVisibility {
  if (actor.isSuperAdmin) {
    return { canView: true, reason: 'platform' };
  }
  if (actor.organizationId !== org.id || actor.membershipRole !== 'org_admin') {
    return { canView: false, reason: 'denied' };
  }
  // PLATFORM_MANAGED cost is attributed to the platform and remains
  // super_admin-only (plan §9). Only an ORGANIZATION_BYOK org_admin may see
  // their own org cost.
  if (org.credentialMode !== 'ORGANIZATION_BYOK') {
    return { canView: false, reason: 'denied' };
  }
  if (!hasActiveOrgCredential) {
    return { canView: false, reason: 'byok_missing_credential' };
  }
  return { canView: true, reason: 'org' };
}

// ============================================================================
// Organization creation validation (plan §4)
// ============================================================================

export interface NewOrganizationInput {
  name: string;
  type: unknown;
  credentialMode: unknown;
}

export interface NewOrganizationValidation {
  ok: boolean;
  errors: string[];
  type?: OrganizationType;
  credentialMode?: CredentialMode;
}

/**
 * Validate an organization-creation request from the UI. `DEFAULT` is not
 * creatable (there is exactly one, created by backfill). `ENTITY` and
 * `INDIVIDUAL` are the only creatable types.
 */
export function validateNewOrganization(input: NewOrganizationInput): NewOrganizationValidation {
  const errors: string[] = [];

  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    errors.push('organization name is required');
  }
  if (typeof input.name === 'string' && input.name.trim().length > 120) {
    errors.push('organization name must be 120 characters or fewer');
  }

  let type: OrganizationType | undefined;
  if (!isValidOrganizationType(input.type)) {
    errors.push(`invalid organization type (expected ENTITY or INDIVIDUAL)`);
  } else if (input.type === 'DEFAULT') {
    errors.push('the DEFAULT organization cannot be created through the UI');
  } else {
    type = input.type;
  }

  let credentialMode: CredentialMode | undefined;
  if (
    typeof input.credentialMode === 'string' &&
    (CREDENTIAL_MODES as readonly string[]).includes(input.credentialMode)
  ) {
    credentialMode = input.credentialMode as CredentialMode;
  } else {
    errors.push(`invalid credential mode (expected ${CREDENTIAL_MODES.join(' | ')})`);
  }

  return {
    ok: errors.length === 0,
    errors,
    type,
    credentialMode,
  };
}

/**
 * The first-member auto-promotion plan (Decision 2):
 *
 *   - `INDIVIDUAL`: exactly one active member, who is `org_admin`.
 *   - `ENTITY`: the creator is auto-promoted to `org_admin` unless an explicit
 *     admin user is delegated (super_admin creating an org on someone's behalf).
 */
export function planOrgCreationMemberships(
  type: OrganizationType,
  creatorUserId: number,
  delegatedAdminUserId?: number | null
): Array<{ userId: number; role: MembershipRole }> {
  if (type === 'INDIVIDUAL') {
    return [{ userId: delegatedAdminUserId ?? creatorUserId, role: 'org_admin' }];
  }
  // ENTITY: first member is org_admin (exactly one active org_admin invariant).
  return [{ userId: delegatedAdminUserId ?? creatorUserId, role: 'org_admin' }];
}

// ============================================================================
// Membership role-change validation (last-admin block)
// ============================================================================

export interface MembershipLike {
  userId: number;
  role: MembershipRole;
  status?: string;
}

export type MembershipChangeAction = 'demote' | 'remove' | 'promote';

export interface MembershipChangeResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Validate a membership mutation against the exactly-one-active-`org_admin`
 * invariant. Demoting or removing the last active `org_admin` is blocked until a
 * successor is assigned (plan §4 invariant 4). Promoting a member to `org_admin`
 * is always allowed from a pure perspective (the caller enforces the successor
 * swap semantics).
 */
export function validateMembershipChange(
  memberships: MembershipLike[],
  targetUserId: number,
  action: MembershipChangeAction
): MembershipChangeResult {
  if (action === 'promote') {
    return { allowed: true };
  }
  return canDemoteOrRemoveOrgAdmin(memberships, targetUserId);
}

// ============================================================================
// Credential id generation (server-side; frontend never supplies one)
// ============================================================================

/**
 * Generate a stable, server-side credential id for a new BYOK credential. The
 * frontend never supplies credential ids (guardrail: frontend org IDs / ids are
 * never trusted). `suffix` is injectable for deterministic tests.
 */
export function generateCredentialId(providerId: string, suffix?: string): string {
  const token = suffix ?? crypto.randomUUID();
  return `${providerId}-${token}`;
}

// Re-export the canonical vocabulary for callers that need it.
export { ORGANIZATION_TYPES, CREDENTIAL_MODES, MEMBERSHIP_ROLES };

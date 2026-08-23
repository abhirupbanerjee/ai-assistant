/**
 * Server-side organization membership resolution — AI & API Setup Redesign,
 * plan §4 "Target Organization Model" and Decision 2.
 *
 * This is the single source of truth for resolving which organization a session
 * user (or a raw `users.id`) belongs to. Both the admin setup surface
 * (`resolveActor()` in src/app/api/admin/ai-setup/_service.ts) and the runtime
 * routes use it, so the runtime request context (`organizationId`) and the admin
 * authorization checks always agree on tenancy.
 *
 * Resolution rules (mirroring the historical `resolveActor` behavior):
 *   - No email / no `users` row / no active membership → `null` (callers fall
 *     back to the DEFAULT organization, the single-tenant parity path).
 *   - When several active memberships exist, the `org_admin` one is preferred.
 *   - The target model is "exactly one organization per user" (Decision 12).
 *     For the transient multi-membership case the pick is still deterministic:
 *     `org_admin` wins, otherwise the lowest `organization_id` — never an
 *     arbitrary `memberships[0]`.
 */

import type { Kysely } from 'kysely';
import type { DB } from './db/db-types';
import type { MembershipRole } from './organization';
import { getDb } from './db/kysely';

export interface ResolvedUserMembership {
  /** Numeric `users.id` (the session user id is the email; audit logs need the PK). */
  userId: number | null;
  organizationId: number | null;
  membershipRole: MembershipRole | null;
}

/** Minimal session-user shape needed for resolution (email identifies the row). */
export interface SessionUserLike {
  email?: string | null;
}

async function resolveMembershipForUserId(
  db: Kysely<DB>,
  userId: number
): Promise<{ organizationId: number | null; membershipRole: MembershipRole | null }> {
  const memberships = await db
    .selectFrom('organization_memberships')
    .select(['organization_id', 'role', 'status'])
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    // Deterministic ordering (Decision 12: exactly one org per user). For the
    // transient multi-membership case the `org_admin` row still wins below;
    // when there is no admin the lowest `organization_id` is picked instead of
    // an arbitrary, DB-order-dependent `memberships[0]`.
    .orderBy('organization_id', 'asc')
    .execute();

  if (memberships.length === 0) {
    return { organizationId: null, membershipRole: null };
  }

  const admin = memberships.find((m) => m.role === 'org_admin');
  const chosen = admin ?? memberships[0];
  return { organizationId: chosen.organization_id, membershipRole: chosen.role };
}

/**
 * Resolve a session user's organization membership server-side. Never trusts a
 * frontend-supplied organization id — the membership comes from the database.
 *
 * @param user session user (only `email` is used)
 * @param db optional Kysely instance (defaults to `getDb()`)
 */
export async function resolveUserMembership(
  user: SessionUserLike | null | undefined,
  db?: Kysely<DB>
): Promise<ResolvedUserMembership> {
  if (!user?.email) {
    return { userId: null, organizationId: null, membershipRole: null };
  }

  const dbx = db ?? (await getDb());
  const dbUser = await dbx
    .selectFrom('users')
    .select(['id'])
    .where('email', '=', user.email.toLowerCase())
    .executeTakeFirst();

  if (!dbUser) {
    return { userId: null, organizationId: null, membershipRole: null };
  }

  const membership = await resolveMembershipForUserId(dbx, dbUser.id);
  return { userId: dbUser.id, ...membership };
}

/**
 * Resolve the organization a user is actively representing, honoring the
 * user-selected `users.active_organization_id`:
 *
 *   - `super_admin` → active selection (they are implicit admin of every org);
 *     `null` when unset and callers fall back to the DEFAULT org.
 *   - everyone else → active selection only when backed by an active membership;
 *     otherwise the deterministic membership fallback (`org_admin` wins, else
 *     lowest `organization_id`).
 */
export async function resolveActiveOrganizationIdByUserId(
  userId: number | null | undefined,
  db?: Kysely<DB>
): Promise<number | null> {
  if (userId == null) return null;
  const dbx = db ?? (await getDb());

  const userRow = await dbx
    .selectFrom('users')
    .select(['role', 'active_organization_id'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!userRow) return null;

  if (userRow.role === 'super_admin') {
    return userRow.active_organization_id ?? null;
  }

  const activeId = userRow.active_organization_id;
  if (activeId != null) {
    const activeMembership = await dbx
      .selectFrom('organization_memberships')
      .select('organization_id')
      .where('user_id', '=', userId)
      .where('organization_id', '=', activeId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (activeMembership) return activeId;
  }

  return (await resolveMembershipForUserId(dbx, userId)).organizationId;
}

/**
 * Resolve the organization id for a session user (the runtime request-context
 * value). `null` when there is no active membership; callers fall back to the
 * DEFAULT organization (the legacy parity path).
 */
export async function resolveUserOrganizationId(
  user: SessionUserLike | null | undefined,
  db?: Kysely<DB>
): Promise<number | null> {
  if (!user?.email) return null;
  const dbx = db ?? (await getDb());
  const dbUser = await dbx
    .selectFrom('users')
    .select('id')
    .where('email', '=', user.email.toLowerCase())
    .executeTakeFirst();
  if (!dbUser) return null;
  return resolveActiveOrganizationIdByUserId(dbUser.id, dbx);
}

/**
 * Resolve the organization id for a raw `users.id` (used by routes that already
 * have a numeric user id, e.g. the workspace chat route which reads
 * `session.user_id` directly).
 */
export async function resolveUserOrganizationIdByUserId(
  userId: number | null | undefined,
  db?: Kysely<DB>
): Promise<number | null> {
  return resolveActiveOrganizationIdByUserId(userId, db);
}

// ============================================================================
// Organization switcher (multi-org representation)
// ============================================================================

export interface RepresentableOrganization {
  id: number;
  name: string;
  type: string;
  isDefault: boolean;
  credentialMode: string;
  membershipRole: MembershipRole | null;
}

/**
 * Organizations the session user may represent in chats, plus their current
 * active organization id. `super_admin` can represent every organization;
 * everyone else can represent their active memberships only.
 */
export async function listRepresentableOrganizations(
  user: SessionUserLike | null | undefined,
  db?: Kysely<DB>
): Promise<{ organizations: RepresentableOrganization[]; activeOrganizationId: number | null }> {
  if (!user?.email) {
    return { organizations: [], activeOrganizationId: null };
  }

  const dbx = db ?? (await getDb());
  const dbUser = await dbx
    .selectFrom('users')
    .select(['id', 'role', 'active_organization_id'])
    .where('email', '=', user.email.toLowerCase())
    .executeTakeFirst();
  if (!dbUser) {
    return { organizations: [], activeOrganizationId: null };
  }

  if (dbUser.role === 'super_admin') {
    const orgs = await dbx
      .selectFrom('organizations')
      .select(['id', 'name', 'type', 'is_default', 'credential_mode'])
      .orderBy('is_default desc')
      .orderBy('id')
      .execute();
    return {
      activeOrganizationId: dbUser.active_organization_id,
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        type: o.type,
        isDefault: o.is_default,
        credentialMode: o.credential_mode,
        membershipRole: null,
      })),
    };
  }

  const rows = await dbx
    .selectFrom('organization_memberships as m')
    .innerJoin('organizations as o', 'o.id', 'm.organization_id')
    .select(['o.id', 'o.name', 'o.type', 'o.is_default', 'o.credential_mode', 'm.role'])
    .where('m.user_id', '=', dbUser.id)
    .where('m.status', '=', 'active')
    .orderBy('o.is_default desc')
    .orderBy('o.id')
    .execute();

  return {
    activeOrganizationId: dbUser.active_organization_id,
    organizations: rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      isDefault: r.is_default,
      credentialMode: r.credential_mode,
      membershipRole: r.role,
    })),
  };
}

/**
 * Set the user's active organization (validated against their representable
 * organizations). Returns the new active id, or `null` when invalid.
 */
export async function setActiveOrganization(
  user: SessionUserLike | null | undefined,
  organizationId: number | null,
  db?: Kysely<DB>
): Promise<number | null> {
  if (!user?.email) return null;
  const dbx = db ?? (await getDb());
  const dbUser = await dbx
    .selectFrom('users')
    .select(['id', 'role'])
    .where('email', '=', user.email.toLowerCase())
    .executeTakeFirst();
  if (!dbUser) return null;

  if (organizationId != null) {
    const { organizations } = await listRepresentableOrganizations(user, dbx);
    if (!organizations.some((o) => o.id === organizationId)) {
      return null;
    }
  }

  await dbx
    .updateTable('users')
    .set({ active_organization_id: organizationId })
    .where('id', '=', dbUser.id)
    .execute();

  return organizationId;
}

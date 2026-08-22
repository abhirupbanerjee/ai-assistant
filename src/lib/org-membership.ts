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
 * Resolve the organization id for a session user (the runtime request-context
 * value). `null` when there is no active membership; callers fall back to the
 * DEFAULT organization (the legacy parity path).
 */
export async function resolveUserOrganizationId(
  user: SessionUserLike | null | undefined,
  db?: Kysely<DB>
): Promise<number | null> {
  return (await resolveUserMembership(user, db)).organizationId;
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
  if (userId == null) return null;
  const dbx = db ?? (await getDb());
  const membership = await resolveMembershipForUserId(dbx, userId);
  return membership.organizationId;
}

/**
 * Shared service layer for the Phase E "AI & API Setup" admin API routes.
 *
 * All DB access lives here (or in the route handlers) and routes through the
 * Kysely instance. Authorization is server-side: the actor's organization is
 * resolved from the session + `organization_memberships`, never from a frontend
 * supplied org id. The pure decision functions used here live in
 * `src/lib/org-admin.ts` (unit-tested without a database).
 */

import { NextResponse } from 'next/server';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@/lib/db/db-types';
import { getDb } from '@/lib/db/kysely';
import { getCurrentUser } from '@/lib/auth';
import type { User } from '@/types';
import { resolveUserMembership } from '@/lib/org-membership';
import type { OrgActor } from '@/lib/org-admin';
import {
  canManageOrganization,
  canViewOrganization,
  isSuperAdminRole,
} from '@/lib/org-admin';
import { resolveProviderConnectionMode, type CapabilityId } from '@/lib/provider-registry';
import { resolveCapabilityRuntimeStatus } from '@/lib/capability-status';
import { evaluateHealthReport, type HealthReport } from '@/lib/health-evaluator';
import { redactSecret } from '@/lib/credential-vault';

// ============================================================================
// Errors
// ============================================================================

export function jsonError(message: string, code: string, status: number): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

// ============================================================================
// Actor resolution (server-side; frontend org IDs are never trusted)
// ============================================================================

export interface AiSetupActor extends OrgActor {
  user: User;
  /** Numeric `users.id` (the session user id is the email; audit logs need the PK). */
  userId: number | null;
}

/**
 * Resolve the authenticated actor and their membership. `super_admin` has no
 * membership row (implicit admin of every org). Non-super_admin actors are
 * expected to have a single active membership; when several exist the
 * `org_admin` membership is preferred.
 */
export async function resolveActor(db: Kysely<DB>, user: User): Promise<AiSetupActor> {
  const isSuperAdmin = isSuperAdminRole(user.role);

  // Shared server-side membership lookup (also used by the runtime request
  // context), so admin authorization and runtime tenancy always agree.
  const membership = await resolveUserMembership(user, db);

  return {
    user,
    userId: membership.userId,
    role: user.role ?? 'user',
    isSuperAdmin,
    organizationId: membership.organizationId,
    membershipRole: membership.membershipRole,
  };
}

/**
 * Authenticate + authorize the consolidated setup surface.
 *
 * `super_admin` (platform override) and `admin` (global role) may open it. An
 * `org_admin` membership also grants access so a BYOK organization admin can
 * set up their own keys — even when their global `users.role` is `user`.
 * `org_admin` scoping then limits which organization each actor can manage.
 */
export async function requireAiSetupActor(): Promise<AiSetupActor | NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return jsonError('Unauthorized', 'AUTH_REQUIRED', 401);
  }
  const db = await getDb();
  const actor = await resolveActor(db, user);

  const isAllowed =
    actor.isSuperAdmin ||
    actor.role === 'admin' ||
    actor.membershipRole === 'org_admin';

  if (!isAllowed) {
    return jsonError('Admin access required', 'ADMIN_REQUIRED', 403);
  }
  return actor;
}

/** Is `value` a NextResponse (i.e. an early error return)? */
export function isResponse(value: AiSetupActor | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

// ============================================================================
// Organization access
// ============================================================================

export interface OrgWithAccess {
  org: {
    id: number;
    name: string;
    type: string;
    isDefault: boolean;
    credentialMode: string;
    status: string;
    isolationMode: string;
    createdAt: string;
    updatedAt: string;
  };
  canManage: boolean;
  canView: boolean;
}

/**
 * Load an organization and compute the actor's access to it. Throws when the
 * org does not exist; callers should catch and map to a 404.
 */
export async function loadOrgWithAccess(
  db: Kysely<DB>,
  actor: AiSetupActor,
  orgId: number
): Promise<OrgWithAccess> {
  const row = await db
    .selectFrom('organizations')
    .select([
      'id',
      'name',
      'type',
      'is_default',
      'credential_mode',
      'status',
      'isolation_mode',
      'created_at',
      'updated_at',
    ])
    .where('id', '=', orgId)
    .executeTakeFirst();

  if (!row) {
    throw new Error('NOT_FOUND');
  }

  return {
    org: {
      id: row.id,
      name: row.name,
      type: row.type,
      isDefault: row.is_default,
      credentialMode: row.credential_mode,
      status: row.status,
      isolationMode: row.isolation_mode,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    canManage: canManageOrganization(actor, orgId),
    canView: canViewOrganization(actor, orgId),
  };
}

/** Organizations visible to the actor (super_admin → all; others → their own). */
export async function listOrganizationsForActor(db: Kysely<DB>, actor: AiSetupActor) {
  let query = db
    .selectFrom('organizations')
    .select([
      'id',
      'name',
      'type',
      'is_default',
      'credential_mode',
      'status',
      'isolation_mode',
      'created_at',
      'updated_at',
    ])
    .orderBy('is_default desc')
    .orderBy('id');

  if (!actor.isSuperAdmin) {
    if (actor.organizationId == null) {
      return [];
    }
    query = query.where('id', '=', actor.organizationId);
  }

  const rows = await query.execute();

  // Active BYOK credential count per org (for cost visibility).
  const orgIds = rows.map((r) => r.id);
  const counts = new Map<number, number>();
  if (orgIds.length > 0) {
    const creds = await db
      .selectFrom('organization_provider_credentials')
      .select(['organization_id'])
      .where('organization_id', 'in', orgIds)
      .where('status', '=', 'active')
      .execute();
    for (const c of creds) {
      counts.set(c.organization_id, (counts.get(c.organization_id) ?? 0) + 1);
    }
  }

  // Whether each org already has an active org_admin (drives the "Admin role
  // only for orgs without an admin" rule in user creation).
  const adminMap = new Map<number, boolean>();
  if (orgIds.length > 0) {
    const admins = await db
      .selectFrom('organization_memberships')
      .select('organization_id')
      .where('organization_id', 'in', orgIds)
      .where('role', '=', 'org_admin')
      .where('status', '=', 'active')
      .execute();
    for (const a of admins) {
      adminMap.set(a.organization_id, true);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    isDefault: r.is_default,
    credentialMode: r.credential_mode,
    status: r.status,
    isolationMode: r.isolation_mode,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    activeCredentialCount: counts.get(r.id) ?? 0,
    hasOrgAdmin: adminMap.get(r.id) ?? false,
    membershipRole:
      actor.organizationId === r.id ? actor.membershipRole : null,
  }));
}

/** Number of active org credentials for an organization (BYOK availability). */
export async function activeOrgCredentialCount(
  db: Kysely<DB>,
  orgId: number
): Promise<number> {
  const row = await db
    .selectFrom('organization_provider_credentials')
    .select(db.fn.count<number>('id').as('count'))
    .where('organization_id', '=', orgId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  return row?.count ?? 0;
}

// ============================================================================
// Registry + health (registry-driven UI; no hardcoded provider lists)
// ============================================================================

export interface RegistryPayload {
  providers: Array<{ id: string; name: string; description: string | null; enabled: boolean; sortOrder: number; connectionMode: 'provider-key' | 'tool-config' | 'keyless' }>;
  capabilities: Array<{ id: string; name: string; description: string | null; importance: string; sortOrder: number }>;
  providerCapabilities: Array<{ providerId: string; capabilityId: string; isSupported: boolean; modelOrServiceIds: unknown; selectionMode: 'none' | 'model' | 'service' }>;
}

/** Read the server-side registry rows (single source of truth for the UI). */
export async function loadRegistry(db: Kysely<DB>): Promise<RegistryPayload> {
  const [providers, capabilities, providerCapabilities] = await Promise.all([
    db
      .selectFrom('providers')
      .select(['id', 'name', 'description', 'enabled', 'sort_order'])
      .orderBy('sort_order')
      .execute(),
    db
      .selectFrom('capabilities')
      .select(['id', 'name', 'description', 'importance', 'sort_order'])
      .orderBy('sort_order')
      .execute(),
    db
      .selectFrom('provider_capabilities')
      .select(['provider_id', 'capability_id', 'is_supported', 'model_or_service_ids', 'selection_mode'])
      .execute(),
  ]);

  return {
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      enabled: p.enabled,
      sortOrder: p.sort_order,
      connectionMode: resolveProviderConnectionMode(p.id),
    })),
    capabilities: capabilities.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      importance: c.importance,
      sortOrder: c.sort_order,
    })),
    providerCapabilities: providerCapabilities.map((pc) => ({
      providerId: pc.provider_id,
      capabilityId: pc.capability_id,
      isSupported: pc.is_supported,
      modelOrServiceIds: pc.model_or_service_ids,
      selectionMode: pc.selection_mode,
    })),
  };
}

/**
 * Compute the four-state configuration health report for an organization using
 * the same resolver the runtime uses (so the UI reflects real availability),
 * aggregated through the pure `evaluateHealthReport` from the health evaluator.
 */
export async function buildHealthReport(
  db: Kysely<DB>,
  orgId: number
): Promise<HealthReport> {
  const capabilities = await db
    .selectFrom('capabilities')
    .select(['id', 'importance'])
    .orderBy('sort_order')
    .execute();

  const snapshots = [];
  for (const cap of capabilities) {
    const resolved = await resolveCapabilityRuntimeStatus(db, orgId, cap.id as CapabilityId);
    snapshots.push({
      capabilityId: cap.id,
      importance: cap.importance,
      configured: resolved.status.configured,
      providerId: resolved.providerId,
      runtimeAvailable: resolved.status.runtimeAvailable,
      warnings: resolved.status.warnings,
    });
  }

  return evaluateHealthReport(snapshots);
}

// ============================================================================
// Credentials (redacted — raw keys are never returned to the UI)
// ============================================================================

export interface RedactedCredential {
  credentialId: string;
  providerId: string;
  status: string;
  isDefault: boolean;
  credentialVersion: number;
  lastVerifiedAt: string | null;
  redactedDetail: string;
  createdAt: string;
  updatedAt: string;
}

/** List an org's credentials with all secret material redacted. */
export async function listOrgCredentialsRedacted(
  db: Kysely<DB>,
  orgId: number
): Promise<RedactedCredential[]> {
  const rows = await db
    .selectFrom('organization_provider_credentials')
    .select([
      'credential_id',
      'provider_id',
      'status',
      'is_default',
      'credential_version',
      'last_verified_at',
      'created_at',
      'updated_at',
    ])
    .where('organization_id', '=', orgId)
    .orderBy('provider_id')
    .orderBy('created_at')
    .execute();

  return rows.map((r) => ({
    credentialId: r.credential_id,
    providerId: r.provider_id,
    status: r.status,
    isDefault: r.is_default,
    credentialVersion: r.credential_version,
    lastVerifiedAt: r.last_verified_at,
    // The stored ciphertext is never selected; a bounded placeholder stands in
    // for display so the UI can render "key present" without the raw value.
    redactedDetail: redactSecret(null),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// ============================================================================
// Audit (all entries redact secret material by construction)
// ============================================================================

export interface AuditEntry {
  id: number;
  organizationId: number | null;
  providerId: string;
  credentialId: string | null;
  actorUserId: number | null;
  actorEmail: string | null;
  action: string;
  redactedDetail: string | null;
  createdAt: string;
}

/**
 * Read the credential audit log. `organizationId` null → global audit
 * (super_admin only); a value → per-organization audit (org_admin own org).
 */
export async function listCredentialAudit(
  db: Kysely<DB>,
  organizationId: number | null
): Promise<AuditEntry[]> {
  let query = db
    .selectFrom('credential_audit_log as a')
    .leftJoin('users as u', 'u.id', 'a.actor_user_id')
    .select([
      'a.id',
      'a.organization_id',
      'a.provider_id',
      'a.credential_id',
      'a.actor_user_id',
      'u.email',
      'a.action',
      'a.redacted_detail',
      'a.created_at',
    ])
    .orderBy('a.created_at desc')
    .limit(500);

  if (organizationId == null) {
    query = query.where('a.organization_id', 'is not', null);
  } else {
    query = query.where('a.organization_id', '=', organizationId);
  }

  const rows = await query.execute();
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    providerId: r.provider_id,
    credentialId: r.credential_id,
    actorUserId: r.actor_user_id,
    actorEmail: r.email,
    action: r.action,
    redactedDetail: r.redacted_detail,
    createdAt: r.created_at,
  }));
}

// ============================================================================
// Org-scoped usage / cost (Decision 9)
// ============================================================================

const ORG_COST_SQL = sql<number>`COALESCE(SUM(
  CASE
    WHEN t.input_tokens > 0 OR t.output_tokens > 0 THEN
      (t.input_tokens * COALESCE(m.input_cost_per_1m, 0) / 1000000.0) +
      (t.output_tokens * COALESCE(m.output_cost_per_1m, 0) / 1000000.0)
    ELSE
      (t.total_tokens * COALESCE(m.input_cost_per_1m, 0) / 1000000.0)
  END
), 0)`;

export interface OrgUsageByCredential {
  credentialId: string | null;
  providerId: string | null;
  totalTokens: number;
  callCount: number;
  totalCost: number;
}

export interface OrgUsageSummary {
  totalTokens: number;
  totalCalls: number;
  totalCost: number;
  byCredential: OrgUsageByCredential[];
  costUnavailable: boolean;
}

/**
 * Usage/cost for one organization. `credential_id` links rows to vault
 * credentials (BYOK attribution); cost is computed identically to the admin
 * usage dashboard so the two surfaces never disagree.
 */
export async function getOrgUsage(
  db: Kysely<DB>,
  orgId: number,
  days: number = 30
): Promise<OrgUsageSummary> {
  const since = sql<string>`NOW() - MAKE_INTERVAL(days => ${days})`;

  const totals = await db
    .selectFrom('token_usage_log as t')
    .leftJoin('enabled_models as m', 'm.id', 't.model')
    .select([
      sql<number>`COALESCE(SUM(t.total_tokens), 0)`.as('total_tokens'),
      db.fn.countAll().as('total_calls'),
      ORG_COST_SQL.as('total_cost'),
    ])
    .where('t.organization_id', '=', orgId)
    .where('t.created_at', '>=', since)
    .executeTakeFirst();

  const byCredential = await db
    .selectFrom('token_usage_log as t')
    .leftJoin('enabled_models as m', 'm.id', 't.model')
    .leftJoin('organization_provider_credentials as oc', 'oc.credential_id', 't.credential_id')
    .select([
      't.credential_id',
      'oc.provider_id',
      sql<number>`COALESCE(SUM(t.total_tokens), 0)`.as('total_tokens'),
      db.fn.countAll().as('call_count'),
      ORG_COST_SQL.as('total_cost'),
    ])
    .where('t.organization_id', '=', orgId)
    .where('t.created_at', '>=', since)
    .groupBy(['t.credential_id', 'oc.provider_id'])
    .orderBy(sql`SUM(t.total_tokens)`, 'desc')
    .execute();

  return {
    totalTokens: Number(totals?.total_tokens ?? 0),
    totalCalls: Number(totals?.total_calls ?? 0),
    totalCost: Number(totals?.total_cost ?? 0),
    byCredential: byCredential.map((r) => ({
      credentialId: r.credential_id,
      providerId: r.provider_id,
      totalTokens: Number(r.total_tokens),
      callCount: Number(r.call_count),
      totalCost: Number(r.total_cost),
    })),
    costUnavailable: false,
  };
}

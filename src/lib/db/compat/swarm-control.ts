/**
 * Swarm Control Database Operations - Async Compatibility Layer
 *
 * Phase 1 Agent System foundations (see
 * plans/agent_system_architecture___implementation_plan.md).
 *
 * Exposes the swarm kill switch (category-keyed; v1 reads only the global row)
 * and the force-swarm role allowlist. Runtime enforcement lands in Phase 4;
 * this module only reads/writes the control tables.
 *
 * All operations use the Kysely query builder for async PostgreSQL access.
 * API routes should import from '@/lib/db/compat' and use `await`.
 */

import { sql } from 'kysely';
import { getDb } from '../kysely';
import type {
  SwarmControl,
  ForceSwarmRoleAllowlist,
} from '../db-types';

// ============ Types ============

export type SwarmRole = 'super_admin' | 'admin' | 'superuser' | 'user';

export interface KillSwitchState {
  /** The row id; 'global' for the NULL-category global row. */
  id: string;
  /** Category id, or null for the global row. */
  categoryId: number | null;
  /** Whether swarm runs are enabled for this scope. */
  swarmEnabled: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

export interface RoleAllowlistEntry {
  id: string;
  role: SwarmRole;
  allowed: boolean;
}

// ============ Row Mappers ============

function mapRowToKillSwitch(row: SwarmControl): KillSwitchState {
  return {
    id: row.id,
    categoryId: row.category_id,
    swarmEnabled: row.swarm_enabled,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function mapRowToAllowlist(row: ForceSwarmRoleAllowlist): RoleAllowlistEntry {
  return {
    id: row.id,
    role: row.role as SwarmRole,
    allowed: row.allowed,
  };
}

// ============ Kill Switch ============

/**
 * Get the global kill-switch state (category_id NULL, id='global').
 * Returns a safe default (enabled=true) if the row is unexpectedly absent —
 * the migration seeds it, but defensive code never crashes on control reads.
 */
export async function getGlobalKillSwitch(): Promise<KillSwitchState> {
  const db = await getDb();
  const row = await db
    .selectFrom('swarm_control')
    .where('id', '=', 'global')
    .selectAll()
    .executeTakeFirst();
  if (row) return mapRowToKillSwitch(row);
  // Defensive fallback — should not happen post-migration.
  return {
    id: 'global',
    categoryId: null,
    swarmEnabled: true,
    updatedBy: null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Set the global kill-switch state. `updatedBy` should be the admin user email
 * or id performing the change (for audit).
 */
export async function setGlobalKillSwitch(
  swarmEnabled: boolean,
  updatedBy: string
): Promise<KillSwitchState> {
  const db = await getDb();
  const row = await db
    .updateTable('swarm_control')
    .set({
      swarm_enabled: swarmEnabled,
      updated_by: updatedBy,
      updated_at: sql`NOW()`,
    })
    .where('id', '=', 'global')
    .returningAll()
    .executeTakeFirstOrThrow();
  return mapRowToKillSwitch(row);
}

/**
 * Get a category-scoped kill-switch row, if one exists. v1 does not create
 * per-category rows; this is reserved for future use. Returns null when no
 * category-specific override is present (callers fall back to the global row).
 */
export async function getCategoryKillSwitch(
  categoryId: number
): Promise<KillSwitchState | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('swarm_control')
    .where('category_id', '=', categoryId)
    .selectAll()
    .executeTakeFirst();
  return row ? mapRowToKillSwitch(row) : null;
}

/**
 * Resolve the effective kill-switch state for a category: per-category row if
 * present, otherwise the global row. This is the single entry point the gate
 * (Phase 4) should use to decide whether swarm runs are allowed for a given
 * category.
 */
export async function getEffectiveKillSwitch(
  categoryId: number | null
): Promise<KillSwitchState> {
  if (categoryId !== null && categoryId !== undefined) {
    const catRow = await getCategoryKillSwitch(categoryId);
    if (catRow) return catRow;
  }
  return getGlobalKillSwitch();
}

// ============ Force-Swarm Role Allowlist ============

/**
 * Get the full force-swarm role allowlist (all four roles).
 */
export async function getForceSwarmRoleAllowlist(): Promise<
  RoleAllowlistEntry[]
> {
  const db = await getDb();
  const rows = await db
    .selectFrom('force_swarm_role_allowlist')
    .selectAll()
    .orderBy('role')
    .execute();
  return rows.map(mapRowToAllowlist);
}

/**
 * Is the given role permitted to use the per-message Force swarm action?
 * Returns false for unknown roles (conservative default).
 */
export async function isRoleAllowedForceSwarm(
  role: SwarmRole
): Promise<boolean> {
  const db = await getDb();
  const row = await db
    .selectFrom('force_swarm_role_allowlist')
    .where('role', '=', role)
    .select('allowed')
    .executeTakeFirst();
  return row?.allowed ?? false;
}

/**
 * Set whether a role may use the Force swarm action. Upserts the row so the
 * caller does not need to know whether it already exists.
 */
export async function setForceSwarmRoleAllowed(
  role: SwarmRole,
  allowed: boolean
): Promise<RoleAllowlistEntry> {
  const db = await getDb();
  const id = `allow-${role}`;
  // Try update first, then insert if no row was updated.
  const updated = await db
    .updateTable('force_swarm_role_allowlist')
    .set({ allowed })
    .where('role', '=', role)
    .returningAll()
    .executeTakeFirst();
  if (updated) return mapRowToAllowlist(updated);
  const row = await db
    .insertInto('force_swarm_role_allowlist')
    .values({ id, role, allowed })
    .returningAll()
    .executeTakeFirstOrThrow();
  return mapRowToAllowlist(row);
}

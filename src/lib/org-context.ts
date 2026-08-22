/**
 * Organization tenancy context helpers — AI & API Setup Redesign, Phase D
 * (plan §8 "Vector-Store Tenancy").
 *
 * Resolves the tenant organization id used for vector payload stamping and the
 * mandatory `organization_id` search filter. The request-context org wins; when
 * absent (legacy callers, background jobs) the DEFAULT org is used, which is
 * the parity target for the existing single-tenant deployment.
 *
 * Everything here is gated by the `vector-tenancy-enabled` feature flag: while
 * OFF the helpers return `null` and callers skip stamping/filtering entirely,
 * preserving the pre-Phase-D behavior.
 */

import type { Kysely } from 'kysely';
import type { DB } from './db/db-types';
import { getDb } from './db/kysely';
import { readFeatureFlagCombinations, type FeatureFlagCombinations } from './feature-flag-combinations';
import { getRequestContext } from './request-context';

/** Get the DEFAULT organization id (the parity target when no org context exists). */
export async function getDefaultOrganizationId(db: Kysely<DB>): Promise<number | null> {
  const row = await db
    .selectFrom('organizations')
    .select('id')
    .where('is_default', '=', true)
    .orderBy('id')
    .limit(1)
    .executeTakeFirst();
  return row?.id ?? null;
}

/**
 * Resolve the tenant organization id for vector stamping/filtering.
 *
 *   - `vector-tenancy-enabled` OFF → `null` (no stamp, no filter).
 *   - request context has `organizationId` → that id.
 *   - otherwise → the DEFAULT organization id (legacy parity path).
 */
/**
 * Pure decision core for vector tenancy org resolution (database-free, testable):
 *
 *   - `vector-tenancy-enabled` OFF → `null` (no stamp, no filter).
 *   - request context has `organizationId` → that id (the tenant that owns the
 *     request, set by the runtime route from the session membership).
 *   - otherwise → the DEFAULT organization id (legacy parity path).
 */
export function resolveVectorTenancyOrgIdFromContext(
  flags: FeatureFlagCombinations,
  defaultOrgId: number | null
): number | null {
  if (!flags.vectorTenancyEnabled) return null;

  const fromContext = getRequestContext().organizationId;
  if (fromContext != null) return fromContext;
  return defaultOrgId;
}

export async function resolveVectorTenancyOrgId(): Promise<number | null> {
  const db = await getDb();
  const flags = await readFeatureFlagCombinations(db);
  if (!flags.vectorTenancyEnabled) return null;
  const defaultOrgId = await getDefaultOrganizationId(db);
  return resolveVectorTenancyOrgIdFromContext(flags, defaultOrgId);
}

/**
 * Feature flag combination validation for the AI & API Setup Redesign.
 *
 * The redesign is rolled out behind four independent settings keys (see plan
 * §17). Each key defaults to `false` when absent from the `settings` table, so
 * every phase can be enabled/rolled back independently. Only the following
 * orderings are valid:
 *
 *   vector-tenancy-enabled          ⇒ org-tenancy-enabled
 *   org-credential-resolver-enabled ⇒ org-tenancy-enabled
 *   ai-api-setup-ui-enabled         ⇒ (no dependency)
 *
 * `assertFeatureFlagCombinations()` is a pure function (unit-testable without a
 * database). `readFeatureFlagCombinations()` reads the keys from the Kysely
 * `settings` table and is wired into the startup migration path in
 * `src/lib/db/kysely.ts` so an invalid combination aborts boot.
 *
 * NOTE: There is no dedicated feature-flag infrastructure in this repository.
 * This mirrors the pattern in `isWorkspacesFeatureEnabled()`
 * (`src/lib/workspace/validator.ts`), which reads a boolean settings key via
 * `getSetting()`. We read the `settings` table directly here to avoid a
 * dependency cycle with `kysely.ts` (which calls this at startup).
 */

import type { Kysely } from 'kysely';
import type { DB } from './db/db-types';

export const ORG_TENANCY_ENABLED_KEY = 'org-tenancy-enabled';
export const VECTOR_TENANCY_ENABLED_KEY = 'vector-tenancy-enabled';
export const ORG_CREDENTIAL_RESOLVER_ENABLED_KEY = 'org-credential-resolver-enabled';
export const AI_API_SETUP_UI_ENABLED_KEY = 'ai-api-setup-ui-enabled';

/** All four flag keys, including ones that only become functional in later phases. */
export const FEATURE_FLAG_KEYS = [
  ORG_TENANCY_ENABLED_KEY,
  VECTOR_TENANCY_ENABLED_KEY,
  ORG_CREDENTIAL_RESOLVER_ENABLED_KEY,
  AI_API_SETUP_UI_ENABLED_KEY,
] as const;

export interface FeatureFlagCombinations {
  orgTenancyEnabled: boolean;
  vectorTenancyEnabled: boolean;
  orgCredentialResolverEnabled: boolean;
  aiApiSetupUiEnabled: boolean;
}

/**
 * Validate the flag ordering matrix from plan §17.
 *
 * Throws an `Error` listing every violated dependency when an invalid
 * combination is detected. `ai-api-setup-ui-enabled` has no dependency and is
 * never a violation by itself.
 */
export function assertFeatureFlagCombinations(flags: FeatureFlagCombinations): void {
  const violations: string[] = [];

  if (flags.vectorTenancyEnabled && !flags.orgTenancyEnabled) {
    violations.push(`${VECTOR_TENANCY_ENABLED_KEY} requires ${ORG_TENANCY_ENABLED_KEY}`);
  }
  if (flags.orgCredentialResolverEnabled && !flags.orgTenancyEnabled) {
    violations.push(`${ORG_CREDENTIAL_RESOLVER_ENABLED_KEY} requires ${ORG_TENANCY_ENABLED_KEY}`);
  }
  // ai-api-setup-ui-enabled ⇒ no dependency; no check needed.

  if (violations.length > 0) {
    throw new Error(`Invalid feature flag combination: ${violations.join('; ')}`);
  }
}

/**
 * Read the four feature flag keys from the Kysely `settings` table.
 *
 * Absent keys (and values that fail JSON parsing) are treated as `false`, so
 * `org-tenancy-enabled` is off by default for existing deployments.
 */
export async function readFeatureFlagCombinations(db: Kysely<DB>): Promise<FeatureFlagCombinations> {
  const rows = await db
    .selectFrom('settings')
    .select(['key', 'value'])
    .where('key', 'in', [...FEATURE_FLAG_KEYS])
    .execute();

  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  const read = (key: string): boolean => {
    const raw = byKey.get(key);
    if (raw == null) return false;
    try {
      return JSON.parse(raw) === true;
    } catch {
      return false;
    }
  };

  return {
    orgTenancyEnabled: read(ORG_TENANCY_ENABLED_KEY),
    vectorTenancyEnabled: read(VECTOR_TENANCY_ENABLED_KEY),
    orgCredentialResolverEnabled: read(ORG_CREDENTIAL_RESOLVER_ENABLED_KEY),
    aiApiSetupUiEnabled: read(AI_API_SETUP_UI_ENABLED_KEY),
  };
}

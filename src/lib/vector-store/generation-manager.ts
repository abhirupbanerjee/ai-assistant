/**
 * Pure decision logic for the Vector Index Generation Manager (Phase 6).
 *
 * This module holds the deterministic, side-effect-free pieces of the
 * build/validate/activate/rollback workflow so they can be unit-tested in
 * isolation following the project's node:test pure-logic pattern (see
 * `collection-names.test.ts`). All database and Qdrant I/O lives in
 * `src/scripts/vector-index-generation.ts`.
 *
 * Only pure naming helpers are imported here — no `@/types`, no DB, no Qdrant.
 */

import {
  CATEGORY_PREFIX,
  GLOBAL_COLLECTION,
  LEGACY_COLLECTION,
  LOGICAL_GLOBAL,
  LOGICAL_LEGACY,
  LOGICAL_CATEGORY_PREFIX,
  isCategoryLogicalName,
  categorySlugFromLogicalName,
  logicalNameForCategory,
} from './collection-names';

// ============ Generation number ============

/**
 * Determine the next generation number for a fresh build.
 *
 * Generation 1 is the implicit default set of physical collections that predate
 * the generation manager (`global_documents`, `category_<slug>`,
 * `organizational_documents`), so the first recorded candidate generation is 2.
 * Subsequent candidates are one greater than the highest recorded generation.
 */
export function computeNextGeneration(existingGenerations: readonly number[]): number {
  if (existingGenerations.length === 0) return 2;
  return Math.max(...existingGenerations) + 1;
}

// ============ Physical naming ============

/**
 * Build the physical Qdrant collection name for a logical collection at a given
 * generation.
 *
 *   - `global`             → `global_documents` (+ `__gN` when N > 1)
 *   - `legacy`             → `organizational_documents` (+ `__gN` when N > 1)
 *   - `category:<slug>`    → `category_<slug>` (+ `__gN` when N > 1)
 *
 * Throws on an unknown logical name so a typo cannot silently produce a bogus
 * collection name.
 */
export function buildPhysicalCollectionName(logicalName: string, generation: number): string {
  let base: string;

  if (logicalName === LOGICAL_GLOBAL) {
    base = GLOBAL_COLLECTION;
  } else if (logicalName === LOGICAL_LEGACY) {
    base = LEGACY_COLLECTION;
  } else if (isCategoryLogicalName(logicalName)) {
    base = `${CATEGORY_PREFIX}${categorySlugFromLogicalName(logicalName)}`;
  } else {
    throw new Error(`Unknown logical collection name: ${logicalName}`);
  }

  return generation > 1 ? `${base}__g${generation}` : base;
}

/** The logical collection names a deployment manages for a set of category slugs. */
export function logicalCollectionNames(categorySlugs: readonly string[]): string[] {
  const names = [LOGICAL_GLOBAL, LOGICAL_LEGACY];
  for (const slug of categorySlugs) {
    names.push(logicalNameForCategory(slug));
  }
  return names;
}

// ============ Ownership resolution ============

/**
 * Resolve the organization id a point in a logical collection should be stamped
 * with. `global` and `legacy` are always owned by the DEFAULT organization;
 * `category:<slug>` is owned by the category's organization, falling back to the
 * DEFAULT organization when the category carries no explicit organization.
 *
 * This mirrors the review's G7 assumption: authoritative ownership derives from
 * `document_categories → categories.organization_id`, with the DEFAULT-org
 * fallback for global / uncategorized documents.
 */
export function organizationForLogicalName(
  logicalName: string,
  categoryOrganizationIds: ReadonlyMap<string, number | null | undefined>,
  defaultOrgId: number | null
): number | null {
  if (isCategoryLogicalName(logicalName)) {
    const slug = categorySlugFromLogicalName(logicalName);
    return categoryOrganizationIds.get(slug) ?? defaultOrgId;
  }
  return defaultOrgId;
}

// ============ Validation gate ============

/** The five hard gates a candidate generation must pass before cutover. */
export interface ValidationGateInput {
  /** Every ready PostgreSQL document is represented in each expected logical collection. */
  documentsRepresented: boolean;
  /** Every candidate point passes the versioned payload contract. */
  payloadsValid: boolean;
  /** Actual point counts equal expected counts per document/collection/organization. */
  countsMatch: boolean;
  /** Candidate vector dimensions match the configured embedding model. */
  dimensionsMatch: boolean;
  /** Org-aware document reads return only authorized chunks. */
  orgReadsAuthorized: boolean;
}

export interface ValidationGateResult {
  pass: boolean;
  failures: string[];
}

/**
 * Collapse the five validation gates into a single pass/fail decision and a
 * human-readable list of the failed gates. Pure so it can be tested directly.
 */
export function evaluateValidationGate(input: ValidationGateInput): ValidationGateResult {
  const failures: string[] = [];
  if (!input.documentsRepresented) {
    failures.push('not every ready document is represented in each expected logical collection');
  }
  if (!input.payloadsValid) {
    failures.push('some candidate points fail the versioned payload contract');
  }
  if (!input.countsMatch) {
    failures.push('actual point counts diverge from expected counts');
  }
  if (!input.dimensionsMatch) {
    failures.push('candidate vector dimensions do not match the configured embedding model');
  }
  if (!input.orgReadsAuthorized) {
    failures.push('org-aware document reads returned unauthorized chunks');
  }
  return { pass: failures.length === 0, failures };
}

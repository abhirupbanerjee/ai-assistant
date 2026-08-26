/**
 * Pure target-selection logic for generation dual-write (Phase 4).
 *
 * During a long-running generation rebuild, normal ingestion writes to the
 * active physical collection(s) and mirrors those writes (and deletes) into any
 * candidate (building/validating) physical collection for the same logical
 * collection name.
 *
 * This module is intentionally free of I/O and side effects (it only imports
 * pure helpers from `./collection-names`) so the target-selection logic can be
 * unit-tested in isolation following the project's node:test pure-logic
 * pattern (see `collection-names.test.ts` and `payload-contract.test.ts`).
 */

import {
  LOGICAL_GLOBAL,
  LOGICAL_LEGACY,
  isCategoryLogicalName,
  categorySlugFromLogicalName,
} from './collection-names';

/**
 * The logical collections a document currently belongs to, used to decide which
 * candidate physical collections should mirror a write or delete.
 *
 * Callers pass an explicit shape per operation step (delete vs. write) so the
 * mirror logic stays in lockstep with the active write:
 *   - a global document belongs to `global` plus every `category:<slug>`;
 *   - a categorized document belongs to each `category:<slug>`;
 *   - an uncategorized, non-global document belongs to `legacy`.
 */
export interface DocumentCollectionShape {
  isGlobal: boolean;
  categorySlugs: string[];
}

/** A candidate physical collection to mirror a write/delete into. */
export interface CandidateTarget {
  physicalName: string;
  generation: number;
}

/**
 * Whether a logical collection name is one that the given document shape
 * belongs to. Pure predicate shared by write and delete mirroring.
 */
export function shouldMirrorToLogicalName(
  logicalName: string,
  shape: DocumentCollectionShape
): boolean {
  if (logicalName === LOGICAL_GLOBAL) {
    return shape.isGlobal;
  }

  if (logicalName === LOGICAL_LEGACY) {
    return !shape.isGlobal && shape.categorySlugs.length === 0;
  }

  if (isCategoryLogicalName(logicalName)) {
    const slug = categorySlugFromLogicalName(logicalName);
    return shape.isGlobal || shape.categorySlugs.includes(slug);
  }

  return false;
}

/**
 * Select the candidate physical collections to mirror for a document shape,
 * deduplicated by physical name and in deterministic order (insertion order of
 * the candidate mappings).
 */
export function candidateTargetsForDocument(
  candidateMappings: Record<string, CandidateTarget>,
  shape: DocumentCollectionShape
): CandidateTarget[] {
  const seen = new Set<string>();
  const targets: CandidateTarget[] = [];

  for (const [logicalName, target] of Object.entries(candidateMappings)) {
    if (!shouldMirrorToLogicalName(logicalName, shape)) continue;
    if (seen.has(target.physicalName)) continue;
    seen.add(target.physicalName);
    targets.push(target);
  }

  return targets;
}

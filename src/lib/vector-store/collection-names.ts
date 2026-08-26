/**
 * Pure collection naming logic (no I/O, no side effects).
 *
 * Phase 2 separates logical naming from physical generation naming:
 *
 * - Logical names are the stable identity call sites use and are what is stored
 *   in `vector_index_generations.logical_name`:
 *     - `global`
 *     - `legacy`
 *     - `category:<slug>`
 * - Physical names are what actually exist in Qdrant. The deterministic default
 *   (generation 1 / first deployment) names are:
 *     - `global_documents`
 *     - `organizational_documents`
 *     - `category_<slug>`
 *   Subsequent generations suffix the base with `__g${n}` (e.g.
 *   `category_hr__g2`, `global_documents__g2`).
 *
 * This module is intentionally free of imports so unit tests can exercise the
 * parsing/formatting helpers in isolation (node:test pure-logic pattern).
 */

// ============ Physical default names ============

export const CATEGORY_PREFIX = 'category_';
export const GLOBAL_COLLECTION = 'global_documents';
export const LEGACY_COLLECTION = 'organizational_documents';

// ============ Logical names ============

export const LOGICAL_GLOBAL = 'global';
export const LOGICAL_LEGACY = 'legacy';
export const LOGICAL_CATEGORY_PREFIX = 'category:';

/** Build the logical name for a category collection from a category slug. */
export function logicalNameForCategory(slug: string): string {
  return `${LOGICAL_CATEGORY_PREFIX}${slug}`;
}

/** Whether a logical name refers to a category collection. */
export function isCategoryLogicalName(name: string): boolean {
  return name.startsWith(LOGICAL_CATEGORY_PREFIX);
}

/** Extract the category slug from a `category:<slug>` logical name. */
export function categorySlugFromLogicalName(name: string): string {
  return name.startsWith(LOGICAL_CATEGORY_PREFIX)
    ? name.slice(LOGICAL_CATEGORY_PREFIX.length)
    : name;
}

// ============ Generation suffix ============

const GENERATION_SUFFIX_RE = /__g(\d+)$/;

/** Whether a physical name carries a generation suffix (`...__gN`). */
export function isGenerationSuffixed(name: string): boolean {
  return GENERATION_SUFFIX_RE.test(name);
}

/** Extract the generation number from a `...__gN` physical name, or null. */
export function generationOfPhysicalName(name: string): number | null {
  const match = GENERATION_SUFFIX_RE.exec(name);
  return match ? parseInt(match[1], 10) : null;
}

/** Strip the trailing `__gN` generation suffix from a physical name. */
export function stripGenerationSuffix(name: string): string {
  return name.replace(GENERATION_SUFFIX_RE, '');
}

// ============ Physical category-name parsing (generation-aware) ============

/**
 * Whether a physical collection name is a category collection, including
 * generation-suffixed names such as `category_hr__g2`.
 */
export function isCategoryName(name: string): boolean {
  return stripGenerationSuffix(name).startsWith(CATEGORY_PREFIX);
}

/**
 * Extract the category slug from a physical collection name, stripping both the
 * `category_` prefix and any `__gN` generation suffix.
 */
export function categorySlugFromName(name: string): string {
  const base = stripGenerationSuffix(name);
  return base.startsWith(CATEGORY_PREFIX) ? base.slice(CATEGORY_PREFIX.length) : base;
}

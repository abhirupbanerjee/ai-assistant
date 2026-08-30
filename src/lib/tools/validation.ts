/**
 * Standalone validation helpers for tool configuration.
 *
 * Kept outside `tools.ts` so tool modules (e.g. share-thread) can import these
 * runtime functions without creating a circular import back through the tool
 * registry in `tools.ts`.
 */

/**
 * Coerce a config value to a finite number and check it falls within [min, max].
 * Accepts numbers or numeric strings (e.g. "15" from legacy SQLite storage).
 * Returns false for NaN, Infinity, null, undefined, empty string, or out-of-range values.
 */
export function numInRange(value: unknown, min: number, max: number): boolean {
  if (value === null || value === undefined || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}

/**
 * Coerce a config value to a finite number, or return undefined if not coercible.
 */
export function coerceNum(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

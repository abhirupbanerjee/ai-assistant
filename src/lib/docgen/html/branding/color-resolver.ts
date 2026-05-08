/**
 * Shared color resolution utilities for HTML page templates.
 *
 * Used by: gantt, dashboard, roadmap templates.
 * Centralises the "LLM color → branding primary → default palette" fallback chain.
 */
import type { BrandingConfig } from '../../../docgen/branding';
import type { GanttCategory } from '../types';

/** Default professional palette — used when neither LLM nor branding provides a color. */
export const DEFAULT_PALETTE: readonly string[] = [
  '#1f4e79', '#2C5F7A', '#5B2D8E', '#8B6914',
  '#7a3535', '#3a6b3a', '#4a4a7a', '#6b4a2a',
];

/**
 * Resolve a color for a Gantt category.
 * Priority: category.color → branding.primaryColor (index 0 only) → DEFAULT_PALETTE.
 */
export function resolveCategoryColor(
  catId: string,
  categories: GanttCategory[],
  branding: BrandingConfig,
  paletteIndex: number,
): string {
  const cat = categories.find(c => c.id === catId);
  if (cat?.color) return cat.color;
  if (paletteIndex === 0 && branding.primaryColor) return branding.primaryColor;
  return DEFAULT_PALETTE[paletteIndex % DEFAULT_PALETTE.length] as string;
}

/**
 * Pick a color from the default palette by index.
 * Useful for dashboard charts and other multi-series visuals.
 */
export function paletteColor(index: number): string {
  return DEFAULT_PALETTE[index % DEFAULT_PALETTE.length] as string;
}

/**
 * Resolve a palette of N colors, preferring branding.primaryColor for index 0.
 */
export function resolvePalette(count: number, branding: BrandingConfig): string[] {
  return Array.from({ length: count }, (_, i) => {
    if (i === 0 && branding.primaryColor) return branding.primaryColor;
    return DEFAULT_PALETTE[i % DEFAULT_PALETTE.length] as string;
  });
}

/**
 * Page Type Compatibility Matrix & Mapper
 *
 * Maps page types to themes based on availability.
 * Full (✓) = template available, Partial (◐) = needs LLM enhancement,
 * Unavailable (✗) = LLM fallback only.
 *
 * Phase 5: Full implementation with all 150 matrix cells populated.
 */

import type { ThemeId, PageTypeId } from '../themes/types';
import type { AvailabilityStatus, CompatibilityEntry } from '../themes/types';

/** Compatibility matrix — Phase 5 will populate all 150 cells */
const COMPATIBILITY_MATRIX: Record<ThemeId, Record<PageTypeId, AvailabilityStatus>> = {
  portfolio: {
    landing: 'full', article: 'full', dashboard: 'unavailable', 'data-table': 'unavailable',
    chart: 'unavailable', form: 'full', 'list-grid': 'full', detail: 'full',
    diagram: 'unavailable', playbook: 'unavailable', timeline: 'partial', faq: 'unavailable',
    comparison: 'unavailable', settings: 'unavailable', gallery: 'full',
  },
  product: {
    landing: 'full', article: 'partial', dashboard: 'unavailable', 'data-table': 'partial',
    chart: 'partial', form: 'full', 'list-grid': 'full', detail: 'full',
    diagram: 'unavailable', playbook: 'unavailable', timeline: 'unavailable', faq: 'full',
    comparison: 'full', settings: 'unavailable', gallery: 'unavailable',
  },
  company: {
    landing: 'full', article: 'full', dashboard: 'unavailable', 'data-table': 'partial',
    chart: 'partial', form: 'full', 'list-grid': 'full', detail: 'full',
    diagram: 'unavailable', playbook: 'unavailable', timeline: 'full', faq: 'full',
    comparison: 'partial', settings: 'unavailable', gallery: 'partial',
  },
  blog: {
    landing: 'full', article: 'full', dashboard: 'unavailable', 'data-table': 'unavailable',
    chart: 'unavailable', form: 'partial', 'list-grid': 'full', detail: 'full',
    diagram: 'unavailable', playbook: 'unavailable', timeline: 'unavailable', faq: 'unavailable',
    comparison: 'unavailable', settings: 'unavailable', gallery: 'unavailable',
  },
  documentation: {
    landing: 'full', article: 'full', dashboard: 'unavailable', 'data-table': 'unavailable',
    chart: 'unavailable', form: 'unavailable', 'list-grid': 'unavailable', detail: 'full',
    diagram: 'full', playbook: 'full', timeline: 'unavailable', faq: 'full',
    comparison: 'unavailable', settings: 'unavailable', gallery: 'unavailable',
  },
  dashboard: {
    landing: 'full', article: 'unavailable', dashboard: 'full', 'data-table': 'full',
    chart: 'full', form: 'unavailable', 'list-grid': 'unavailable', detail: 'unavailable',
    diagram: 'unavailable', playbook: 'unavailable', timeline: 'unavailable', faq: 'unavailable',
    comparison: 'unavailable', settings: 'full', gallery: 'unavailable',
  },
  store: {
    landing: 'full', article: 'unavailable', dashboard: 'unavailable', 'data-table': 'full',
    chart: 'unavailable', form: 'full', 'list-grid': 'full', detail: 'full',
    diagram: 'unavailable', playbook: 'unavailable', timeline: 'unavailable', faq: 'unavailable',
    comparison: 'full', settings: 'unavailable', gallery: 'full',
  },
  event: {
    landing: 'full', article: 'partial', dashboard: 'unavailable', 'data-table': 'unavailable',
    chart: 'unavailable', form: 'full', 'list-grid': 'unavailable', detail: 'full',
    diagram: 'unavailable', playbook: 'unavailable', timeline: 'full', faq: 'full',
    comparison: 'unavailable', settings: 'unavailable', gallery: 'partial',
  },
  nonprofit: {
    landing: 'full', article: 'full', dashboard: 'unavailable', 'data-table': 'unavailable',
    chart: 'unavailable', form: 'full', 'list-grid': 'full', detail: 'full',
    diagram: 'unavailable', playbook: 'unavailable', timeline: 'unavailable', faq: 'unavailable',
    comparison: 'unavailable', settings: 'unavailable', gallery: 'full',
  },
  education: {
    landing: 'full', article: 'full', dashboard: 'partial', 'data-table': 'full',
    chart: 'partial', form: 'full', 'list-grid': 'full', detail: 'full',
    diagram: 'full', playbook: 'full', timeline: 'full', faq: 'full',
    comparison: 'unavailable', settings: 'unavailable', gallery: 'unavailable',
  },
};

/**
 * Check if a page type is available for a given theme.
 */
export function getAvailability(
  themeId: ThemeId,
  pageType: PageTypeId
): AvailabilityStatus {
  return COMPATIBILITY_MATRIX[themeId]?.[pageType] ?? 'unavailable';
}

/**
 * Get all page types for a theme grouped by availability.
 */
export function getPageTypesByAvailability(
  themeId: ThemeId
): Record<AvailabilityStatus, PageTypeId[]> {
  const matrix = COMPATIBILITY_MATRIX[themeId];
  if (!matrix) return { full: [], partial: [], unavailable: [] };

  const result: Record<AvailabilityStatus, PageTypeId[]> = {
    full: [],
    partial: [],
    unavailable: [],
  };

  for (const [pageType, status] of Object.entries(matrix)) {
    result[status as AvailabilityStatus].push(pageType as PageTypeId);
  }

  return result;
}

/**
 * List all page types that have at least a partial template for a theme.
 */
export function getAvailablePageTypes(themeId: ThemeId): PageTypeId[] {
  const matrix = COMPATIBILITY_MATRIX[themeId];
  if (!matrix) return [];

  return Object.entries(matrix)
    .filter(([, status]) => status !== 'unavailable')
    .map(([pageType]) => pageType as PageTypeId);
}

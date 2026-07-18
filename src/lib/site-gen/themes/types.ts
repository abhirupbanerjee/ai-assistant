/**
 * Theme Types — Site Generator
 *
 * TypeScript interfaces for the theme system.
 * All 10 themes share this type contract.
 */

import type { ThemeId, PageTypeId } from '../../tools/site-gen';

// Re-export for consumers within site-gen module
export type { ThemeId, PageTypeId };

// ============ Token Types ============

/** A single DTCG design token */
export interface DesignToken {
  $value: string;
  $type: string;
  $description?: string;
}

/** Color tokens (semantic tier) */
export interface ColorTokens {
  primary: string;
  'primary-hover': string;
  secondary: string;
  background: string;
  surface: string;
  text: string;
  'text-muted': string;
  border: string;
  success: string;
  warning: string;
  error: string;
}

/** Font tokens */
export interface FontTokens {
  heading: string;
  body: string;
  mono: string;
}

/** Spacing tokens */
export interface SpacingTokens {
  'spacing-xs': string;
  'spacing-sm': string;
  'spacing-md': string;
  'spacing-lg': string;
  'spacing-xl': string;
  'spacing-section': string;
}

/** Shadow tokens */
export interface ShadowTokens {
  'shadow-sm': string;
  'shadow-md': string;
  'shadow-lg': string;
}

/** Complete theme token set */
export interface ThemeTokens {
  themeId: ThemeId;
  displayName: string;
  description: string;
  cssPath: string;
  colors: ColorTokens;
  fonts: FontTokens;
  spacing: SpacingTokens;
  shadows: ShadowTokens;
  googleFonts: GoogleFontConfig;
}

// ============ Font Types ============

/** Google Fonts configuration for a theme */
export interface GoogleFontConfig {
  /** Font families with weights (e.g., "Inter:wght@400;500;700") */
  families: string[];
  /** display strategy (always 'swap' for v1) */
  display: 'swap';
}

// ============ Page Types ============

/** Availability status for a page type in a theme */
export type AvailabilityStatus = 'full' | 'partial' | 'unavailable';

/** Compatibility matrix entry */
export interface CompatibilityEntry {
  themeId: ThemeId;
  pageType: PageTypeId;
  status: AvailabilityStatus;
}

/** Page type metadata */
export interface PageTypeMetadata {
  pageType: PageTypeId;
  displayName: string;
  description: string;
  requiredFields: Record<string, FieldSchema>;
}

/** Field schema for template placeholders */
export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  minCount?: number;
  maxCount?: number;
  items?: Record<string, FieldSchema>;
  format?: string;
}

// ============ Generated Page ============

/** A single generated page */
export interface GeneratedPage {
  slug: string;
  title: string;
  pageType: PageTypeId;
  html: string;
  isFallback: boolean;
}

// ============ Theme Keywords ============

/** Keyword-to-theme mapping for auto-selection */
export type ThemeKeywords = Record<ThemeId, string[]>;

/**
 * PPTX Theme Definitions
 *
 * Two universal themes: Light (white background) and Dark (black background).
 * Each accepts a configurable accent color for highlights, chart fills, and stat numbers.
 */

import type { ThemeName, ThemeConfig } from '@/types/pptx-gen';

// ============ Base Theme Definitions (without accent color) ============

interface BaseTheme {
  background: string;
  textColor: string;
  bodyTextColor: string;
  borderColor: string;
  headerFont: string;
  bodyFont: string;
}

const BASE_THEMES: Record<ThemeName, BaseTheme> = {
  light: {
    background: 'FFFFFF',
    textColor: '1A1A1A',
    bodyTextColor: '333333',
    borderColor: 'E5E5E5',
    headerFont: 'Arial',
    bodyFont: 'Arial',
  },
  dark: {
    background: '000000',
    textColor: 'FFFFFF',
    bodyTextColor: 'CCCCCC',
    borderColor: '333333',
    headerFont: 'Arial',
    bodyFont: 'Arial',
  },
};

const DEFAULT_ACCENT_COLOR = '3B82F6'; // Blue

/**
 * Validate and normalize a hex color string to a 6-digit hex (without #).
 * Falls back to DEFAULT_ACCENT_COLOR if the input is malformed.
 */
function normalizeHexColor(input?: string): string {
  if (!input) return DEFAULT_ACCENT_COLOR;
  const stripped = input.replace('#', '').trim();
  // Accept 6-digit hex (e.g. "3B82F6") or 3-digit shorthand (e.g. "3B8" → "3BB888")
  if (/^[0-9a-fA-F]{6}$/.test(stripped)) return stripped.toUpperCase();
  if (/^[0-9a-fA-F]{3}$/.test(stripped)) {
    return (stripped[0] + stripped[0] + stripped[1] + stripped[1] + stripped[2] + stripped[2]).toUpperCase();
  }
  return DEFAULT_ACCENT_COLOR;
}

// ============ Theme Utilities ============

/**
 * Get theme configuration by name, with optional accent color override.
 * Falls back to light theme if the name is unrecognized.
 */
export function getTheme(name: ThemeName, accentColor?: string): ThemeConfig {
  const base = BASE_THEMES[name] || BASE_THEMES.light;
  return {
    ...base,
    accentColor: normalizeHexColor(accentColor),
  };
}

/**
 * Get all available theme names.
 */
export function getAvailableThemes(): ThemeName[] {
  return Object.keys(BASE_THEMES) as ThemeName[];
}

/**
 * Map legacy theme names to the new light/dark system.
 * Used for backward compatibility when old configs reference
 * 'corporate', 'modern', 'minimal', or 'bold'.
 */
export function mapLegacyTheme(legacyName?: string): { theme: ThemeName; accentColor: string } {
  switch (legacyName) {
    case 'corporate':
      return { theme: 'light', accentColor: '1E2761' }; // Navy
    case 'modern':
      return { theme: 'light', accentColor: '065A82' }; // Deep blue
    case 'minimal':
      return { theme: 'light', accentColor: '36454F' }; // Charcoal
    case 'bold':
      return { theme: 'dark', accentColor: 'F96167' }; // Coral
    default:
      return { theme: 'light', accentColor: DEFAULT_ACCENT_COLOR };
  }
}

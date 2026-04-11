/**
 * PPTX Theme Definitions
 *
 * Predefined visual themes for PowerPoint presentations.
 */

import type { ThemeName, ThemeConfig } from '@/types/pptx-gen';

// ============ Theme Definitions ============

export const THEMES: Record<ThemeName, ThemeConfig> = {
  corporate: {
    primary: '1E2761', // Navy
    secondary: 'CADCFC', // Ice blue
    accent: 'FFFFFF',
    headerFont: 'Arial Black',
    bodyFont: 'Arial',
    darkTitleSlide: true,
  },
  modern: {
    primary: '065A82', // Deep blue
    secondary: '1C7293', // Teal
    accent: '21295C', // Midnight
    headerFont: 'Trebuchet MS',
    bodyFont: 'Calibri',
    darkTitleSlide: true,
  },
  minimal: {
    primary: '36454F', // Charcoal
    secondary: 'F2F2F2', // Off-white
    accent: '212121', // Black
    headerFont: 'Calibri',
    bodyFont: 'Calibri Light',
    darkTitleSlide: false,
  },
  bold: {
    primary: 'F96167', // Coral
    secondary: 'F9E795', // Gold
    accent: '2F3C7E', // Navy
    headerFont: 'Impact',
    bodyFont: 'Arial',
    darkTitleSlide: true,
  },
};

// ============ Theme Utilities ============

/**
 * Get theme configuration by name
 */
export function getTheme(name: ThemeName): ThemeConfig {
  return THEMES[name] || THEMES.corporate;
}

/**
 * Build a custom theme from a color scheme
 */
export function buildCustomTheme(colors: {
  primary: string;
  secondary: string;
  accent: string;
}): ThemeConfig {
  return {
    primary: (colors.primary || '1E2761').replace('#', ''),
    secondary: (colors.secondary || 'CADCFC').replace('#', ''),
    accent: (colors.accent || 'FFFFFF').replace('#', ''),
    headerFont: 'Arial Black',
    bodyFont: 'Arial',
    darkTitleSlide: true,
  };
}

/**
 * Get all available theme names
 */
export function getAvailableThemes(): ThemeName[] {
  return Object.keys(THEMES) as ThemeName[];
}

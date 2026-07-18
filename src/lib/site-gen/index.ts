/**
 * Site Generator — Barrel Export
 * Purpose-based theme system for multi-page website generation.
 */

export { THEME_IDS, THEME_DISPLAY_NAMES, THEME_DESCRIPTIONS, getThemeCssPath, validateThemeTokens, getAllThemeIds } from './themes/registry';
export type { ThemeTokens, ColorTokens, FontTokens, SpacingTokens, ShadowTokens, GoogleFontConfig, AvailabilityStatus, CompatibilityEntry, PageTypeMetadata, FieldSchema, GeneratedPage, ThemeKeywords } from './themes/types';

export { THEME_KEYWORDS, selectTheme } from './themes/selector';
export type { ThemeSelectionResult } from './themes/selector';

export { getAvailability, getPageTypesByAvailability, getAvailablePageTypes } from './templates/mapper';
export { renderTemplate, loadTemplate, loadComponent, templateExists } from './renderer/engine';
export { wrapPage } from './renderer/assembler';
export type { PageInfo, AssemblyInput } from './renderer/assembler';

export { buildFallbackPrompt, validateFallbackHtml, buildRetryPrompt } from './renderer/fallback';

export { generateSampleData, getPlaceholderImage } from './data/generator';

export { packageWebsite, getZipFilename } from './packager/zip';

export { runPipeline } from './pipeline/orchestrator';
export type { PipelineInput, PipelineOutput } from './pipeline/orchestrator';

export type { ThemeId, PageTypeId, SiteGenConfig, SiteGenArgs } from '../tools/site-gen';

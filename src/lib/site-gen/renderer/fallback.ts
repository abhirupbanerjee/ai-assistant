/**
 * LLM Fallback System (Phase 6)
 *
 * When a page type has ✗ in the compatibility matrix for the selected theme,
 * or the template is unavailable, this system:
 * 1. Builds a prompt with theme CSS tokens injected
 * 2. Calls an LLM to generate custom HTML
 * 3. Validates the output (no hardcoded colors, uses CSS variables)
 * 4. Retries up to maxRetries times with stricter prompts
 */

import type { ThemeId, PageTypeId } from '../../tools/site-gen';
import { readFileSync } from 'fs';
import { join } from 'path';

const DIST_DIR = join(process.cwd(), 'src/lib/site-gen/themes/dist');

/**
 * Build the fallback prompt for LLM HTML generation.
 * Injects theme CSS tokens and page requirements.
 */
export function buildFallbackPrompt(
  themeId: ThemeId,
  pageType: PageTypeId,
  pagePurpose: string,
  sampleData: Record<string, unknown>
): string {
  const themeCss = loadThemeCssForPrompt(themeId);

  return [
    `You are generating a custom HTML section for a ${themeId} website.`,
    '',
    'THEME CSS TOKENS (you MUST use these variables):',
    themeCss,
    '',
    'PAGE REQUIREMENTS:',
    `- Page type: ${pageType}`,
    `- Purpose: ${pagePurpose}`,
    `- Content data: ${JSON.stringify(sampleData, null, 2)}`,
    '',
    'RULES:',
    '1. Use ONLY the CSS variables defined above (e.g., var(--color-primary))',
    '2. Do NOT hardcode any colors, fonts, or spacing values',
    '3. Follow the typography scale: h1 = var(--font-size-h1), body = var(--font-size-base)',
    '4. Use var(--content-width) for max-width containers',
    '5. Use var(--spacing-section) for section padding',
    '6. Use var(--border-radius) for all rounded elements',
    '7. Include responsive breakpoints (@media max-width: 768px)',
    '8. Output clean, semantic HTML5',
    '9. Include inline <style> block using the CSS variables',
    '10. Do NOT include <html>, <head>, or <body> tags (only the page content)',
    '11. Dark mode: use var(--color-*) tokens only',
    '',
    'OUTPUT: Return only the HTML content for this page section. No markdown fences, no explanations.',
  ].join('\n');
}

/**
 * Validate LLM-generated HTML:
 * - No hardcoded hex colors
 * - Uses at least 5 CSS variables
 * - Contains semantic HTML tags
 * - No hardcoded font-family values
 */
export function validateFallbackHtml(html: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for hardcoded hex colors (exclude CSS variable definitions)
  const hexColorRegex = /(?<!var\(--[^)]{0,50})#[0-9a-fA-F]{3,6}(?![^)]*\))/g;
  const hardcodedColors = html.match(hexColorRegex);
  if (hardcodedColors && hardcodedColors.length > 0) {
    errors.push(`Found ${hardcodedColors.length} hardcoded hex color(s): ${hardcodedColors.slice(0, 5).join(', ')}`);
  }

  // Check CSS variable usage
  const varUsage = html.match(/var\(--[^)]+\)/g);
  if (!varUsage || varUsage.length < 5) {
    errors.push(`Uses only ${varUsage?.length || 0} CSS variables (minimum 5 required)`);
  }

  // Check for semantic HTML
  const semanticTags = ['section', 'article', 'nav', 'header', 'footer', 'main', 'aside'];
  const hasSemantic = semanticTags.some(tag => html.includes(`<${tag}`));
  if (!hasSemantic) {
    errors.push('No semantic HTML tags found (section, article, nav, etc.)');
  }

  // Check for hardcoded font-family
  const hardcodedFonts = html.match(/font-family:\s*(?!var\(--font)/g);
  if (hardcodedFonts && hardcodedFonts.length > 0) {
    errors.push(`Found ${hardcodedFonts.length} hardcoded font-family value(s)`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Generate a stricter retry prompt after validation failure.
 */
export function buildRetryPrompt(
  originalPrompt: string,
  errors: string[],
  previousHtml: string
): string {
  return [
    originalPrompt,
    '',
    '=== PREVIOUS ATTEMPT FAILED VALIDATION ===',
    'The previous HTML was rejected for these reasons:',
    ...errors.map(e => `- ${e}`),
    '',
    'Previous output (DO NOT repeat these mistakes):',
    '```html',
    previousHtml.slice(0, 500),
    '```',
    '',
    'FIX ALL ISSUES and try again. This is your last chance.',
  ].join('\n');
}

/**
 * Load theme CSS tokens for prompt injection.
 * Strips dark mode block to keep prompt size reasonable.
 */
function loadThemeCssForPrompt(themeId: ThemeId): string {
  try {
    const css = readFileSync(join(DIST_DIR, themeId, 'global.css'), 'utf8');
    // Extract only :root block (light mode) for the prompt
    const rootMatch = css.match(/:root\s*\{([^}]+)\}/);
    if (rootMatch) {
      return rootMatch[0].replace(/\n\s*/g, '\n  ');
    }
    return css.slice(0, 2000); // Fallback: first 2000 chars
  } catch {
    return '/* Theme CSS not available — use sane defaults */';
  }
}

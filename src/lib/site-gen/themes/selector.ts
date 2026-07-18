/**
 * Theme Auto-Selection Engine
 *
 * Keyword-based theme selection from user requirements.
 * Phase 3: Full scoring algorithm with edge case handling.
 */

import type { ThemeId } from './types';

/** Keyword-to-theme mapping for auto-selection */
export const THEME_KEYWORDS: Record<ThemeId, string[]> = {
  portfolio: [
    'portfolio', 'showcase', 'photographer', 'designer', 'developer',
    'artist', 'freelancer', 'personal site', 'my work', 'projects',
  ],
  product: [
    'saas', 'product', 'app', 'software', 'platform', 'tool',
    'landing page', 'features', 'pricing', 'startup',
  ],
  company: [
    'company', 'business', 'agency', 'firm', 'enterprise',
    'corporate', 'services', 'team', 'about us', 'organization',
  ],
  blog: [
    'blog', 'article', 'posts', 'writing', 'magazine',
    'newsletter', 'journal', 'stories', 'content',
  ],
  documentation: [
    'documentation', 'docs', 'api', 'knowledge base', 'manual',
    'guide', 'reference', 'technical', 'help center', 'wiki',
  ],
  dashboard: [
    'dashboard', 'admin', 'analytics', 'monitoring', 'reports',
    'metrics', 'panel', 'control center', 'data view',
  ],
  store: [
    'store', 'shop', 'ecommerce', 'e-commerce', 'products',
    'catalog', 'buy', 'cart', 'marketplace', 'retail',
  ],
  event: [
    'event', 'conference', 'meetup', 'workshop', 'summit',
    'festival', 'registration', 'schedule', 'speakers',
  ],
  nonprofit: [
    'nonprofit', 'ngo', 'charity', 'foundation', 'cause',
    'donation', 'mission', 'volunteer', 'social impact',
  ],
  education: [
    'education', 'course', 'learning', 'training', 'lms',
    'school', 'university', 'academy', 'tutorial', 'class',
  ],
};

export interface ThemeSelectionResult {
  themeId: ThemeId;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  alternatives?: ThemeId[];
}

/**
 * Select the best theme based on keyword matching in the requirement text.
 * Phase 3: Full implementation with tie-breaking and confidence scoring.
 *
 * @param requirement   The user's requirement description (used for keyword matching).
 * @param explicitTheme Optional explicit theme override (bypasses auto-detection).
 * @param defaultTheme  Admin-configured fallback theme used when keyword detection has
 *                      low confidence. `"auto"` (default) keeps the highest-scoring theme
 *                      even at score 0 — i.e. the LLM is trusted to pick via the theme arg
 *                      or keyword detection. A concrete ThemeId is used as the fallback.
 */
export function selectTheme(
  requirement: string,
  explicitTheme?: ThemeId,
  defaultTheme: ThemeId | 'auto' = 'auto'
): ThemeSelectionResult {
  // Explicit override takes precedence
  if (explicitTheme) {
    return {
      themeId: explicitTheme,
      confidence: 'high',
      reason: `Theme explicitly specified as "${explicitTheme}".`,
    };
  }

  const normalizedInput = requirement.toLowerCase().trim();
  const scores: Record<string, number> = {};

  // Score each theme by keyword matches
  for (const [themeId, keywords] of Object.entries(THEME_KEYWORDS)) {
    scores[themeId] = 0;
    for (const keyword of keywords) {
      if (normalizedInput.includes(keyword)) {
        // Weight: multi-word phrases score higher than single words
        scores[themeId] += keyword.split(' ').length;
      }
    }
  }

  // Find highest scoring theme
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const bestTheme = sorted[0];

  // If no keywords matched, use the admin-configured default.
  if (bestTheme[1] === 0) {
    if (defaultTheme === 'auto') {
      // Trust the LLM: keep the first theme alphabetically as a neutral starting point.
      const firstTheme = sorted[0][0] as ThemeId;
      return {
        themeId: firstTheme,
        confidence: 'low',
        reason: 'No specific keywords detected. Auto mode — defaulting to the first theme; LLM may override via the theme argument.',
        alternatives: ['company', 'portfolio', 'blog'],
      };
    }
    return {
      themeId: defaultTheme,
      confidence: 'low',
      reason: `No specific keywords detected. Defaulting to ${defaultTheme} theme (admin-configured default).`,
      alternatives: ['company', 'portfolio', 'blog'],
    };
  }

  // Check for ties
  const tiedThemes = sorted.filter(([, score]) => score === bestTheme[1]);

  return {
    themeId: bestTheme[0] as ThemeId,
    confidence: bestTheme[1] >= 3 ? 'high' : 'medium',
    reason: `Matched keywords for ${bestTheme[0]} theme.`,
    alternatives: tiedThemes.length > 1
      ? tiedThemes.slice(1).map(([id]) => id as ThemeId)
      : undefined,
  };
}

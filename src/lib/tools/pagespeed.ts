/**
 * Website Analysis Tool - Google PageSpeed Insights Integration
 *
 * Provides website performance, accessibility, SEO, and best practices analysis
 * using Google's PageSpeed Insights API (Lighthouse).
 */

import { getToolConfig } from '../db/compat/tool-config';
import { getEffectiveToolConfig } from '../db/compat/category-tool-config';
import { hashQuery, getCachedQuery, cacheQuery } from '../redis';
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';

// ============ Types ============

export interface CoreWebVitals {
  lcp: number;  // Largest Contentful Paint (ms)
  fid: number;  // First Input Delay (ms)
  cls: number;  // Cumulative Layout Shift
  fcp: number;  // First Contentful Paint (ms)
  ttfb: number; // Time to First Byte (ms)
}

export interface LighthouseScores {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}

export interface AuditItem {
  id: string;
  title: string;
  description: string;
  score: number | null;
  displayValue?: string;
}

export interface WcagViolation {
  auditId: string;
  title: string;
  description: string;
  wcagCriterion: string | null;
  wcagLevel: 'A' | 'AA' | 'AAA' | null;
  wcagPrinciple: string | null;
  score: number | null;
  displayValue?: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
}

export interface AccessibilityAudit {
  accessibilityScore: number;
  wcagLevel: 'A' | 'AA' | 'Partial AA' | 'Failing';
  totalViolations: number;
  byLevel: { A: number; AA: number; AAA: number; unmapped: number };
  violations: WcagViolation[];
  recommendations: string[];
}

export interface PageSpeedResult {
  url: string;
  fetchTime: string;
  strategy: 'mobile' | 'desktop';
  scores: LighthouseScores;
  coreWebVitals: CoreWebVitals;
  opportunities: AuditItem[];
  diagnostics: AuditItem[];
  accessibilityAudit?: AccessibilityAudit;
}

interface WebsiteAnalysisConfig {
  apiKey: string;
  defaultStrategy: 'mobile' | 'desktop';
  cacheTTLSeconds: number;
  includeOpportunities: boolean;
  includeDiagnostics: boolean;
}

// ============ WCAG Mapping ============

const WCAG_MAP: Record<string, { criterion: string; level: 'A' | 'AA' | 'AAA'; principle: string }> = {
  'image-alt':              { criterion: '1.1.1', level: 'A',  principle: 'Images must have alternative text' },
  'input-image-alt':        { criterion: '1.1.1', level: 'A',  principle: 'Image buttons must have alternative text' },
  'object-alt':             { criterion: '1.1.1', level: 'A',  principle: 'Object elements must have alternative text' },
  'video-caption':          { criterion: '1.2.2', level: 'A',  principle: 'Videos must have captions' },
  'audio-caption':          { criterion: '1.2.4', level: 'AA', principle: 'Live audio must have captions' },
  'color-contrast':         { criterion: '1.4.3', level: 'AA', principle: 'Text must have sufficient colour contrast' },
  'color-contrast-enhanced':{ criterion: '1.4.6', level: 'AAA',principle: 'Text must have enhanced colour contrast' },
  'meta-viewport':          { criterion: '1.4.4', level: 'AA', principle: 'Page must not disable user scaling' },
  'document-title':         { criterion: '2.4.2', level: 'A',  principle: 'Page must have a descriptive title' },
  'html-has-lang':          { criterion: '3.1.1', level: 'A',  principle: 'Page must have a language attribute' },
  'html-lang-valid':        { criterion: '3.1.1', level: 'A',  principle: 'Page language attribute must be valid' },
  'valid-lang':             { criterion: '3.1.2', level: 'AA', principle: 'Language of parts must be valid' },
  'label':                  { criterion: '1.3.1', level: 'A',  principle: 'Form inputs must have associated labels' },
  'button-name':            { criterion: '4.1.2', level: 'A',  principle: 'Buttons must have accessible names' },
  'link-name':              { criterion: '2.4.4', level: 'A',  principle: 'Links must have descriptive text' },
  'frame-title':            { criterion: '2.4.1', level: 'A',  principle: 'Frames must have titles' },
  'duplicate-id-active':    { criterion: '4.1.1', level: 'A',  principle: 'Active elements must not share IDs' },
  'duplicate-id-aria':      { criterion: '4.1.1', level: 'A',  principle: 'ARIA IDs must be unique' },
  'aria-allowed-attr':      { criterion: '4.1.2', level: 'A',  principle: 'ARIA attributes must be valid for role' },
  'aria-required-attr':     { criterion: '4.1.2', level: 'A',  principle: 'Required ARIA attributes must be present' },
  'aria-roles':             { criterion: '4.1.2', level: 'A',  principle: 'ARIA roles must be valid' },
  'aria-valid-attr':        { criterion: '4.1.2', level: 'A',  principle: 'ARIA attributes must be valid' },
  'aria-valid-attr-value':  { criterion: '4.1.2', level: 'A',  principle: 'ARIA attribute values must be valid' },
  'aria-hidden-focus':      { criterion: '4.1.2', level: 'A',  principle: 'aria-hidden must not contain focusable elements' },
  'tabindex':               { criterion: '2.4.3', level: 'A',  principle: 'tabindex values greater than 0 disrupt focus order' },
  'logical-tab-order':      { criterion: '2.4.3', level: 'A',  principle: 'Focus order must be logical' },
  'focusable-controls':     { criterion: '2.1.1', level: 'A',  principle: 'All interactive controls must be keyboard accessible' },
  'interactive-element-affordance': { criterion: '2.1.1', level: 'A', principle: 'Interactive elements must be operable' },
  'managed-focus':          { criterion: '2.4.3', level: 'A',  principle: 'Focus must be managed after dynamic content changes' },
  'use-landmarks':          { criterion: '1.3.6', level: 'AAA',principle: 'Page should use ARIA landmark regions' },
  'bypass':                 { criterion: '2.4.1', level: 'A',  principle: 'Mechanism must exist to bypass repeated blocks' },
  'heading-order':          { criterion: '1.3.1', level: 'A',  principle: 'Heading levels must be sequential' },
  'list':                   { criterion: '1.3.1', level: 'A',  principle: 'Lists must be marked up correctly' },
  'listitem':               { criterion: '1.3.1', level: 'A',  principle: 'List items must be inside list elements' },
  'definition-list':        { criterion: '1.3.1', level: 'A',  principle: 'Definition lists must be correctly structured' },
  'dlitem':                 { criterion: '1.3.1', level: 'A',  principle: 'Definition list items must be properly nested' },
  'td-headers-attr':        { criterion: '1.3.1', level: 'A',  principle: 'Table cells must reference valid headers' },
  'th-has-data-cells':      { criterion: '1.3.1', level: 'A',  principle: 'Table headers must have associated data cells' },
};

function classifyViolations(
  audits: Record<string, { id: string; title: string; description: string; score: number | null; displayValue?: string }>
): WcagViolation[] {
  const violations: WcagViolation[] = [];

  for (const [id, audit] of Object.entries(audits)) {
    // Only include failing audits (score < 1 and not null)
    if (audit.score === null || audit.score >= 1) continue;

    const wcag = WCAG_MAP[id] || null;

    const impact: WcagViolation['impact'] =
      audit.score === 0 ? 'critical'
      : audit.score < 0.5 ? 'serious'
      : audit.score < 0.9 ? 'moderate'
      : 'minor';

    violations.push({
      auditId: id,
      title: audit.title,
      description: audit.description,
      wcagCriterion: wcag?.criterion || null,
      wcagLevel: wcag?.level || null,
      wcagPrinciple: wcag?.principle || null,
      score: audit.score,
      displayValue: audit.displayValue,
      impact,
    });
  }

  const impactOrder = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  return violations.sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact]);
}

function assessWcagLevel(score: number, byLevel: { A: number; AA: number }): AccessibilityAudit['wcagLevel'] {
  if (byLevel.A > 0) return 'Failing';
  if (score >= 90 && byLevel.AA === 0) return 'AA';
  if (score >= 75) return 'Partial AA';
  return 'Failing';
}

function buildAccessibilityAudit(
  accessibilityScore: number,
  audits: Record<string, { id: string; title: string; description: string; score: number | null; displayValue?: string }>
): AccessibilityAudit {
  const violations = classifyViolations(audits);

  const byLevel = { A: 0, AA: 0, AAA: 0, unmapped: 0 };
  for (const v of violations) {
    if (v.wcagLevel === 'A') byLevel.A++;
    else if (v.wcagLevel === 'AA') byLevel.AA++;
    else if (v.wcagLevel === 'AAA') byLevel.AAA++;
    else byLevel.unmapped++;
  }

  const wcagLevel = assessWcagLevel(accessibilityScore, byLevel);

  const recommendations: string[] = [];
  const critical = violations.filter(v => v.impact === 'critical');
  const serious = violations.filter(v => v.impact === 'serious');

  if (critical.length > 0) {
    recommendations.push(`${critical.length} critical violation(s): ${critical.map(v => v.title).join(', ')}`);
  }
  if (serious.length > 0) {
    recommendations.push(`${serious.length} serious violation(s): ${serious.map(v => v.title).join(', ')}`);
  }
  if (byLevel.A > 0) {
    recommendations.push(`${byLevel.A} WCAG Level A failure(s) — these are the minimum conformance requirements and must be fixed.`);
  }
  if (byLevel.AA > 0) {
    recommendations.push(`${byLevel.AA} WCAG Level AA failure(s) — required for most accessibility standards and regulations.`);
  }
  if (recommendations.length === 0) {
    recommendations.push('No accessibility violations detected. Score meets WCAG AA conformance.');
  }

  return {
    accessibilityScore,
    wcagLevel,
    totalViolations: violations.length,
    byLevel,
    violations,
    recommendations,
  };
}

// ============ PageSpeed Client ============

const PAGESPEED_API_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/**
 * Analyze a URL using Google PageSpeed Insights API
 */
async function analyzeUrl(
  url: string,
  options: {
    apiKey?: string;
    strategy: 'mobile' | 'desktop';
    includeOpportunities: boolean;
    includeDiagnostics: boolean;
    accessibilityAudit?: boolean;
  }
): Promise<PageSpeedResult> {
  // Build URL with parameters
  const params = new URLSearchParams({
    url,
    strategy: options.strategy,
  });

  // Add all categories
  ['performance', 'accessibility', 'best-practices', 'seo'].forEach(cat => {
    params.append('category', cat);
  });

  if (options.apiKey) {
    params.append('key', options.apiKey);
  }

  const requestUrl = `${PAGESPEED_API_URL}?${params.toString()}`;
  console.log('[PageSpeed] Analyzing:', url, 'strategy:', options.strategy);

  const response = await fetch(requestUrl);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('[PageSpeed] API error:', response.status, errorData);
    throw new Error(
      errorData.error?.message || `PageSpeed API error: ${response.status}`
    );
  }

  const data = await response.json();
  return normalizeResponse(data, options);
}

/**
 * Normalize PageSpeed API response to our format
 */
function normalizeResponse(
  data: Record<string, unknown>,
  options: { strategy: 'mobile' | 'desktop'; includeOpportunities: boolean; includeDiagnostics: boolean; accessibilityAudit?: boolean }
): PageSpeedResult {
  const lighthouse = data.lighthouseResult as Record<string, unknown> | undefined;
  const categories = (lighthouse?.categories || {}) as Record<string, { score?: number; auditRefs?: { id: string }[] }>;
  const audits = (lighthouse?.audits || {}) as Record<string, {
    id: string;
    title: string;
    description: string;
    score: number | null;
    displayValue?: string;
    numericValue?: number;
    details?: { type?: string };
  }>;

  // Extract scores (convert 0-1 to 0-100)
  const scores: LighthouseScores = {
    performance: Math.round((categories.performance?.score || 0) * 100),
    accessibility: Math.round((categories.accessibility?.score || 0) * 100),
    bestPractices: Math.round((categories['best-practices']?.score || 0) * 100),
    seo: Math.round((categories.seo?.score || 0) * 100),
  };

  // Extract Core Web Vitals
  const coreWebVitals: CoreWebVitals = {
    lcp: Math.round(audits['largest-contentful-paint']?.numericValue || 0),
    fid: Math.round(audits['max-potential-fid']?.numericValue || 0),
    cls: Number((audits['cumulative-layout-shift']?.numericValue || 0).toFixed(3)),
    fcp: Math.round(audits['first-contentful-paint']?.numericValue || 0),
    ttfb: Math.round(audits['server-response-time']?.numericValue || 0),
  };

  // Extract opportunities (actionable improvements)
  let opportunities: AuditItem[] = [];
  if (options.includeOpportunities) {
    opportunities = Object.values(audits)
      .filter(
        (audit) =>
          audit.details?.type === 'opportunity' &&
          audit.score !== null &&
          audit.score < 1
      )
      .sort((a, b) => (a.score || 0) - (b.score || 0))
      .slice(0, 5)
      .map((audit) => ({
        id: audit.id,
        title: audit.title,
        description: audit.description,
        score: audit.score,
        displayValue: audit.displayValue,
      }));
  }

  // Extract diagnostics (informational items)
  let diagnostics: AuditItem[] = [];
  if (options.includeDiagnostics) {
    diagnostics = Object.values(audits)
      .filter(
        (audit) =>
          audit.details?.type === 'table' &&
          audit.score !== null &&
          audit.score < 1
      )
      .sort((a, b) => (a.score || 0) - (b.score || 0))
      .slice(0, 5)
      .map((audit) => ({
        id: audit.id,
        title: audit.title,
        description: audit.description,
        score: audit.score,
        displayValue: audit.displayValue,
      }));
  }

  // Build accessibility audit if requested
  let accessibilityAudit: AccessibilityAudit | undefined;
  if (options.accessibilityAudit) {
    const a11yIds = new Set(
      (categories.accessibility as { auditRefs?: { id: string }[] })?.auditRefs?.map(r => r.id) ?? []
    );
    const a11yAudits = a11yIds.size > 0
      ? Object.fromEntries(Object.entries(audits).filter(([id]) => a11yIds.has(id)))
      : audits;
    accessibilityAudit = buildAccessibilityAudit(scores.accessibility, a11yAudits);
  }

  return {
    url: data.id as string,
    fetchTime: data.analysisUTCTimestamp as string,
    strategy: options.strategy,
    scores,
    coreWebVitals,
    opportunities,
    diagnostics,
    accessibilityAudit,
  };
}

// ============ Config Helpers ============

/**
 * Get website analysis configuration
 */
export async function getWebsiteAnalysisConfig(categoryId?: number): Promise<{
  enabled: boolean;
  config: WebsiteAnalysisConfig;
}> {
  // If category provided, get effective config (global + category merged)
  if (categoryId) {
    const effective = await getEffectiveToolConfig('website_analysis', categoryId);
    return {
      enabled: effective.enabled,
      config: (effective.config as unknown as WebsiteAnalysisConfig) || defaultConfig,
    };
  }

  // Otherwise get global config
  const toolConfig = await getToolConfig('website_analysis');
  if (toolConfig) {
    return {
      enabled: toolConfig.isEnabled,
      config: toolConfig.config as unknown as WebsiteAnalysisConfig,
    };
  }

  return {
    enabled: false,
    config: defaultConfig,
  };
}

// ============ Config Schema ============

const configSchema = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      title: 'Google API Key',
      description: 'Optional but recommended for higher rate limits. Get from https://console.cloud.google.com/apis/credentials',
      format: 'password',
    },
    defaultStrategy: {
      type: 'string',
      title: 'Default Strategy',
      description: 'Default device type for analysis',
      enum: ['mobile', 'desktop'],
      default: 'mobile',
    },
    cacheTTLSeconds: {
      type: 'number',
      title: 'Cache Duration (seconds)',
      description: 'How long to cache analysis results (reduces API calls)',
      minimum: 60,
      maximum: 86400,
      default: 86400,
    },
    includeOpportunities: {
      type: 'boolean',
      title: 'Include Opportunities',
      description: 'Include optimization opportunities in results',
      default: true,
    },
    includeDiagnostics: {
      type: 'boolean',
      title: 'Include Diagnostics',
      description: 'Include detailed diagnostic information',
      default: true,
    },
  },
};

const defaultConfig: WebsiteAnalysisConfig = {
  apiKey: '',
  defaultStrategy: 'mobile',
  cacheTTLSeconds: 86400,
  includeOpportunities: true,
  includeDiagnostics: true,
};

/**
 * Validate website analysis configuration
 */
function validateConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // Validate defaultStrategy
  if (config.defaultStrategy && !['mobile', 'desktop'].includes(config.defaultStrategy as string)) {
    errors.push('defaultStrategy must be "mobile" or "desktop"');
  }

  // Validate cacheTTLSeconds
  if (config.cacheTTLSeconds !== undefined) {
    const cacheTTL = config.cacheTTLSeconds as number;
    if (typeof cacheTTL !== 'number' || cacheTTL < 60 || cacheTTL > 86400) {
      errors.push('cacheTTLSeconds must be a number between 60 and 86400');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============ Tool Definition ============

export const websiteAnalysisTool: ToolDefinition = {
  name: 'website_analysis',
  displayName: 'Website Analysis',
  description: 'Analyze website performance, accessibility, SEO, and best practices using Google PageSpeed Insights.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'website_analysis',
      description: 'Analyze a website for performance, accessibility, SEO, and best practices using Google PageSpeed Insights. Use when users ask about website speed, Core Web Vitals, performance optimization, SEO issues, or accessibility problems. Returns scores (0-100), Core Web Vitals metrics, and actionable optimization opportunities. Set accessibilityAudit=true for a detailed WCAG 2.1 compliance report.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL of the website to analyze (e.g., https://example.com). Must include protocol (http/https).',
          },
          strategy: {
            type: 'string',
            enum: ['mobile', 'desktop'],
            description: 'Device type for the analysis. Mobile is typically more important for SEO and is the default.',
          },
          accessibilityAudit: {
            type: 'boolean',
            description: 'Set to true for a detailed WCAG 2.1 accessibility audit with violations mapped to specific WCAG criteria and levels (A/AA/AAA). Use when users specifically ask about WCAG compliance, accessibility violations, or need a detailed a11y report.',
          },
        },
        required: ['url'],
      },
    },
  },

  validateConfig,
  defaultConfig: defaultConfig as unknown as Record<string, unknown>,
  configSchema,

  execute: async (
    args: {
      url: string;
      strategy?: 'mobile' | 'desktop';
      accessibilityAudit?: boolean;
    },
    options?: ToolExecutionOptions
  ): Promise<string> => {
    // Get config - check for category-level override
    const categoryIds = (options as { categoryIds?: number[] })?.categoryIds || [];
    const { enabled, config: globalSettings } = categoryIds.length > 0
      ? await getWebsiteAnalysisConfig(categoryIds[0])
      : await getWebsiteAnalysisConfig();

    // Merge skill-level config override
    const configOverride = options?.configOverride || {};
    const settings = { ...globalSettings, ...configOverride } as WebsiteAnalysisConfig;

    // Check if tool is enabled
    if (!enabled) {
      return JSON.stringify({
        success: false,
        error: 'Website analysis is currently disabled',
        errorCode: 'TOOL_DISABLED',
      });
    }

    // Validate URL
    try {
      new URL(args.url);
    } catch {
      return JSON.stringify({
        success: false,
        error: 'Invalid URL format. Please provide a full URL including protocol (e.g., https://example.com)',
        errorCode: 'INVALID_URL',
      });
    }

    // Get API key (config > specific env var > general Google env var)
    const apiKey = settings.apiKey || process.env.PAGESPEED_API_KEY || process.env.GOOGLE_API_KEY;

    // Resolve strategy
    const strategy = args.strategy ?? settings.defaultStrategy ?? 'mobile';

    // Check cache
    const wcagSuffix = args.accessibilityAudit ? ':wcag' : '';
    const cacheKey = hashQuery(`pagespeed:${args.url}:${strategy}${wcagSuffix}`);
    const cached = await getCachedQuery(`pagespeed:${cacheKey}`);
    if (cached) {
      console.log('[PageSpeed] Cache hit:', args.url);
      return cached;
    }

    // Call PageSpeed API
    console.log('[PageSpeed] Cache miss - calling API:', args.url);
    try {
      const result = await analyzeUrl(args.url, {
        apiKey,
        strategy,
        includeOpportunities: settings.includeOpportunities,
        includeDiagnostics: settings.includeDiagnostics,
        accessibilityAudit: args.accessibilityAudit,
      });

      const response = {
        success: true,
        data: result,
      };

      const resultString = JSON.stringify(response, null, 2);

      // Cache the result
      await cacheQuery(`pagespeed:${cacheKey}`, resultString, settings.cacheTTLSeconds);

      return resultString;
    } catch (error) {
      console.error('[PageSpeed] API error:', error);
      return JSON.stringify({
        success: false,
        error: 'Website analysis failed',
        errorCode: 'API_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
};

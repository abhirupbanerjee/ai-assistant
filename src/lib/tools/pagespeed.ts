/**
 * Website Analysis Tool - Google PageSpeed Insights Integration
 *
 * Provides website performance, accessibility, SEO, and best practices analysis
 * using Google's PageSpeed Insights API (Lighthouse).
 */

import { getToolConfig } from '../db/tool-config';
import { getEffectiveToolConfig } from '../db/category-tool-config';
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

export interface PageSpeedResult {
  url: string;
  fetchTime: string;
  strategy: 'mobile' | 'desktop';
  scores: LighthouseScores;
  coreWebVitals: CoreWebVitals;
  opportunities: AuditItem[];
  diagnostics: AuditItem[];
}

interface WebsiteAnalysisConfig {
  apiKey: string;
  defaultStrategy: 'mobile' | 'desktop';
  cacheTTLSeconds: number;
  includeOpportunities: boolean;
  includeDiagnostics: boolean;
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
  options: { strategy: 'mobile' | 'desktop'; includeOpportunities: boolean; includeDiagnostics: boolean }
): PageSpeedResult {
  const lighthouse = data.lighthouseResult as Record<string, unknown> | undefined;
  const categories = (lighthouse?.categories || {}) as Record<string, { score?: number }>;
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

  return {
    url: data.id as string,
    fetchTime: data.analysisUTCTimestamp as string,
    strategy: options.strategy,
    scores,
    coreWebVitals,
    opportunities,
    diagnostics,
  };
}

// ============ Config Helpers ============

/**
 * Get website analysis configuration
 */
export function getWebsiteAnalysisConfig(categoryId?: number): {
  enabled: boolean;
  config: WebsiteAnalysisConfig;
} {
  // If category provided, get effective config (global + category merged)
  if (categoryId) {
    const effective = getEffectiveToolConfig('website_analysis', categoryId);
    return {
      enabled: effective.enabled,
      config: (effective.config as unknown as WebsiteAnalysisConfig) || defaultConfig,
    };
  }

  // Otherwise get global config
  const toolConfig = getToolConfig('website_analysis');
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
      default: 3600,
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
  cacheTTLSeconds: 3600,
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
      description: 'Analyze a website for performance, accessibility, SEO, and best practices using Google PageSpeed Insights. Use when users ask about website speed, Core Web Vitals, performance optimization, SEO issues, or accessibility problems. Returns scores (0-100), Core Web Vitals metrics, and actionable optimization opportunities.',
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
    },
    options?: ToolExecutionOptions
  ): Promise<string> => {
    // Get config - check for category-level override
    const categoryIds = (options as { categoryIds?: number[] })?.categoryIds || [];
    const { enabled, config: globalSettings } = categoryIds.length > 0
      ? getWebsiteAnalysisConfig(categoryIds[0])
      : getWebsiteAnalysisConfig();

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

    // Get API key (config > env var)
    const apiKey = settings.apiKey || process.env.PAGESPEED_API_KEY;

    // Resolve strategy
    const strategy = args.strategy ?? settings.defaultStrategy ?? 'mobile';

    // Check cache
    const cacheKey = hashQuery(`pagespeed:${args.url}:${strategy}`);
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

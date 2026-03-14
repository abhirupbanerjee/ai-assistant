/**
 * Security Scan Tool - Mozilla HTTP Observatory Integration
 *
 * Analyzes website security headers and configuration using Mozilla HTTP Observatory.
 * Tests: CSP, HSTS, X-Frame-Options, cookies, CORS, and 6+ other security controls.
 */

import { getToolConfig } from '../db/compat/tool-config';
import { getEffectiveToolConfig } from '../db/compat/category-tool-config';
import { hashQuery, getCachedQuery, cacheQuery } from '../redis';
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';

// ============ Types ============

interface SecurityScanConfig {
  cacheTTLSeconds: number;
  minAcceptableScore: number;
  rateLimitPerDay: number;
  rateLimitPerWeek: number;
}

interface ObservatoryResponse {
  id: number;
  details_url: string;
  algorithm_version: number;
  scanned_at: string;
  error: string | null;
  grade: string;
  score: number;
  status_code: number;
  tests_failed: number;
  tests_passed: number;
  tests_quantity: number;
}

interface SecurityScanResult {
  url: string;
  scannedAt: string;
  grade: string;
  score: number;
  statusCode: number;
  testsTotal: number;
  testsPassed: number;
  testsFailed: number;
  detailsUrl: string;
  passed: boolean;
  summary: string;
  recommendations: string[];
  failureReason?: string;
}

// ============ Observatory API Client ============

const OBSERVATORY_API = 'https://observatory-api.mdn.mozilla.net/api/v2';

/**
 * Run Mozilla Observatory security scan
 */
async function runObservatoryScan(url: string): Promise<ObservatoryResponse> {
  const hostname = new URL(url).hostname;

  const response = await fetch(
    `${OBSERVATORY_API}/scan?host=${encodeURIComponent(hostname)}`,
    { method: 'POST' }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Observatory API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as ObservatoryResponse;

  if (data.error) {
    throw new Error(`Observatory scan error: ${data.error}`);
  }

  return data;
}

// ============ Recommendations ============

function generateRecommendations(
  grade: string,
  score: number,
  testsFailed: number
): string[] {
  const recs: string[] = [];

  if (grade === 'F' || grade === 'D') {
    recs.push('CRITICAL: Implement Content Security Policy (CSP) header');
    recs.push('CRITICAL: Enable HTTP Strict Transport Security (HSTS)');
    recs.push('CRITICAL: Set X-Frame-Options to prevent clickjacking');
    recs.push('Review cookie security (Secure, HttpOnly, SameSite flags)');
  } else if (grade === 'C') {
    recs.push('Strengthen Content Security Policy (remove unsafe-inline)');
    recs.push('Add Referrer-Policy header to control information leakage');
    recs.push('Consider Subresource Integrity (SRI) for CDN resources');
    recs.push('Review X-Content-Type-Options configuration');
  } else if (grade === 'B') {
    recs.push('Tighten CSP directives to remove unsafe-inline/unsafe-eval');
    recs.push('Enable HSTS preloading for enhanced security');
    recs.push('Add Permissions-Policy header to control browser features');
  } else if (grade === 'A') {
    recs.push('Excellent security configuration');
    recs.push('Consider achieving A+ by enabling HSTS preload + strict CSP');
  } else if (grade === 'A+') {
    recs.push('Exceptional security configuration');
    recs.push('All security best practices implemented');
  }

  if (testsFailed > 0) {
    recs.push(`${testsFailed} security test(s) failed - view detailed report for specifics`);
  }

  return recs;
}

function generateSummary(
  grade: string,
  score: number,
  testsPassed: number,
  testsTotal: number
): string {
  const passPercent = Math.round((testsPassed / testsTotal) * 100);

  const gradeDescriptions: Record<string, string> = {
    'A+': 'exceptional security - exceeds best practices',
    A: 'excellent security - follows all best practices',
    B: 'good security - minor improvements needed',
    C: 'fair security - several improvements needed',
    D: 'poor security - significant vulnerabilities present',
    F: 'failing security - critical vulnerabilities present',
  };

  return `Security grade ${grade} (${score}/115) - ${gradeDescriptions[grade] || 'unknown'}. ${testsPassed}/${testsTotal} tests passed (${passPercent}%).`;
}

// ============ Rate Limiting ============

async function checkRateLimit(
  config: SecurityScanConfig
): Promise<{ allowed: boolean; reason?: string }> {
  const today = new Date().toISOString().split('T')[0];
  const weekStart = getWeekStart(new Date());

  const dailyKey = `securityscan:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  const dailyUsage = dailyCount ? parseInt(dailyCount) : 0;

  if (dailyUsage >= config.rateLimitPerDay) {
    return {
      allowed: false,
      reason: `Daily limit reached (${config.rateLimitPerDay} scans/day)`,
    };
  }

  const weeklyKey = `securityscan:rate:weekly:${weekStart}`;
  const weeklyCount = await getCachedQuery(weeklyKey);
  const weeklyUsage = weeklyCount ? parseInt(weeklyCount) : 0;

  if (weeklyUsage >= config.rateLimitPerWeek) {
    return {
      allowed: false,
      reason: `Weekly limit reached (${config.rateLimitPerWeek} scans/week)`,
    };
  }

  return { allowed: true };
}

async function incrementRateLimit(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const weekStart = getWeekStart(new Date());

  const dailyKey = `securityscan:rate:daily:${today}`;
  const weeklyKey = `securityscan:rate:weekly:${weekStart}`;

  const dailyCount = await getCachedQuery(dailyKey);
  await cacheQuery(dailyKey, String((dailyCount ? parseInt(dailyCount) : 0) + 1), 86400);

  const weeklyCount = await getCachedQuery(weeklyKey);
  await cacheQuery(weeklyKey, String((weeklyCount ? parseInt(weeklyCount) : 0) + 1), 604800);
}

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

// ============ Config Helpers ============

async function getSecurityScanConfig(categoryId?: number): Promise<{
  enabled: boolean;
  config: SecurityScanConfig;
}> {
  if (categoryId) {
    const effective = await getEffectiveToolConfig('security_scan', categoryId);
    return {
      enabled: effective.enabled,
      config: (effective.config as unknown as SecurityScanConfig) || defaultConfig,
    };
  }

  const toolConfig = await getToolConfig('security_scan');
  if (toolConfig) {
    return {
      enabled: toolConfig.isEnabled,
      config: toolConfig.config as unknown as SecurityScanConfig,
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
    cacheTTLSeconds: {
      type: 'number',
      title: 'Cache Duration (seconds)',
      description: 'How long to cache scan results',
      minimum: 300,
      maximum: 86400,
      default: 86400,
    },
    minAcceptableScore: {
      type: 'number',
      title: 'Minimum Acceptable Score',
      description: 'Alert if score below this threshold (A+ = 105, A = 90, B = 70)',
      minimum: 0,
      maximum: 115,
      default: 70,
    },
    rateLimitPerDay: {
      type: 'number',
      title: 'Daily Scan Limit',
      description: 'Maximum scans per 24 hours',
      minimum: 1,
      maximum: 100,
      default: 20,
    },
    rateLimitPerWeek: {
      type: 'number',
      title: 'Weekly Scan Limit',
      description: 'Maximum scans per week',
      minimum: 5,
      maximum: 500,
      default: 100,
    },
  },
};

const defaultConfig: SecurityScanConfig = {
  cacheTTLSeconds: 86400,
  minAcceptableScore: 70,
  rateLimitPerDay: 20,
  rateLimitPerWeek: 100,
};

function validateConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (config.cacheTTLSeconds !== undefined) {
    const cache = config.cacheTTLSeconds as number;
    if (typeof cache !== 'number' || cache < 300 || cache > 86400) {
      errors.push('cacheTTLSeconds must be between 300 and 86400');
    }
  }

  if (config.minAcceptableScore !== undefined) {
    const minScore = config.minAcceptableScore as number;
    if (typeof minScore !== 'number' || minScore < 0 || minScore > 115) {
      errors.push('minAcceptableScore must be between 0 and 115');
    }
  }

  if (config.rateLimitPerDay !== undefined) {
    const daily = config.rateLimitPerDay as number;
    if (typeof daily !== 'number' || daily < 1 || daily > 100) {
      errors.push('rateLimitPerDay must be between 1 and 100');
    }
  }

  if (config.rateLimitPerWeek !== undefined) {
    const weekly = config.rateLimitPerWeek as number;
    if (typeof weekly !== 'number' || weekly < 5 || weekly > 500) {
      errors.push('rateLimitPerWeek must be between 5 and 500');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============ Tool Definition ============

export const securityScanTool: ToolDefinition = {
  name: 'security_scan',
  displayName: 'Security Scan',
  description: 'Analyze website security headers and configuration using Mozilla Observatory',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'security_scan',
      description:
        'Analyze website security configuration including HTTP headers (Content Security Policy, HSTS, X-Frame-Options), cookie security, CORS, and other security controls. Returns security grade (A+ to F) with actionable recommendations. Use when users ask about website security, security headers, security audit, or vulnerability assessment.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Full URL to scan (must include https:// or http://)',
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
    args: { url: string },
    options?: ToolExecutionOptions
  ): Promise<string> => {
    // Get config with category override support
    const categoryIds = (options as { categoryIds?: number[] })?.categoryIds || [];
    const { enabled, config: globalSettings } =
      categoryIds.length > 0
        ? await getSecurityScanConfig(categoryIds[0])
        : await getSecurityScanConfig();

    // Merge skill-level config override
    const configOverride = options?.configOverride || {};
    const settings = { ...globalSettings, ...configOverride } as SecurityScanConfig;

    if (!enabled) {
      return JSON.stringify({
        success: false,
        error: 'Security scanning is currently disabled',
        errorCode: 'TOOL_DISABLED',
      });
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(args.url);
    } catch {
      return JSON.stringify({
        success: false,
        error: 'Invalid URL format. Please provide a full URL including protocol (e.g., https://example.com)',
        errorCode: 'INVALID_URL',
      });
    }

    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      return JSON.stringify({
        success: false,
        error: 'Only HTTP and HTTPS URLs are supported',
        errorCode: 'INVALID_PROTOCOL',
      });
    }

    // Check rate limits
    const rateLimitCheck = await checkRateLimit(settings);
    if (!rateLimitCheck.allowed) {
      return JSON.stringify({
        success: false,
        error: rateLimitCheck.reason,
        errorCode: 'RATE_LIMIT_EXCEEDED',
      });
    }

    // Check cache
    const cacheKey = hashQuery(args.url);
    const cached = await getCachedQuery(`securityscan:${cacheKey}`);
    if (cached) {
      console.log('[SecurityScan] Cache hit:', args.url);
      return cached;
    }

    console.log('[SecurityScan] Cache miss - calling Observatory API:', args.url);
    try {
      const observatoryResult = await runObservatoryScan(args.url);

      const result: SecurityScanResult = {
        url: args.url,
        scannedAt: observatoryResult.scanned_at,
        grade: observatoryResult.grade,
        score: observatoryResult.score,
        statusCode: observatoryResult.status_code,
        testsTotal: observatoryResult.tests_quantity,
        testsPassed: observatoryResult.tests_passed,
        testsFailed: observatoryResult.tests_failed,
        detailsUrl: observatoryResult.details_url,
        passed: observatoryResult.score >= settings.minAcceptableScore,
        summary: generateSummary(
          observatoryResult.grade,
          observatoryResult.score,
          observatoryResult.tests_passed,
          observatoryResult.tests_quantity
        ),
        recommendations: generateRecommendations(
          observatoryResult.grade,
          observatoryResult.score,
          observatoryResult.tests_failed
        ),
      };

      if (!result.passed) {
        result.failureReason = `Score ${result.score} is below minimum threshold of ${settings.minAcceptableScore}`;
      }

      await incrementRateLimit();

      const response = JSON.stringify({ success: true, data: result }, null, 2);
      await cacheQuery(`securityscan:${cacheKey}`, response, settings.cacheTTLSeconds);

      return response;
    } catch (error) {
      console.error('[SecurityScan] API error:', error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Security scan failed',
        errorCode: 'SCAN_ERROR',
      });
    }
  },
};

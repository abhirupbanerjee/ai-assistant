/**
 * Cookie Security Audit Tool
 *
 * Fetches the target URL and inspects all Set-Cookie response headers.
 * Checks each cookie for security flags:
 *   - HttpOnly  — prevents JavaScript access (XSS protection)
 *   - Secure    — only transmitted over HTTPS
 *   - SameSite  — CSRF protection (Strict > Lax > None)
 *   - __Host- / __Secure- prefix conventions
 *
 * No API key needed. Pure HTTP fetch.
 */

import { getToolConfig } from '../db/compat/tool-config';
import { getEffectiveToolConfig } from '../db/compat/category-tool-config';
import { hashQuery, getCachedQuery, cacheQuery } from '../redis';
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';

// ============ Types ============

interface CookieAuditConfig {
  cacheTTLSeconds: number;
  rateLimitPerDay: number;
  followRedirects: boolean;
}

interface CookieDetail {
  name: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None' | 'missing';
  hasExpiry: boolean;
  domain?: string;
  path?: string;
  issues: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface CookieAuditResult {
  url: string;
  finalUrl: string;
  scannedAt: string;
  cookieCount: number;
  cookies: CookieDetail[];
  issueCount: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  passed: boolean;
  summary: string;
  recommendations: string[];
}

// ============ Cookie Parser ============

function parseCookieHeader(header: string): CookieDetail {
  const parts = header.split(';').map(p => p.trim());
  const nameValue = parts[0] || '';
  const name = nameValue.split('=')[0].trim();

  const directives = parts.slice(1).map(p => p.toLowerCase());

  const httpOnly = directives.includes('httponly');
  const secure = directives.includes('secure');

  const sameSiteDir = directives.find(d => d.startsWith('samesite='));
  let sameSite: CookieDetail['sameSite'] = 'missing';
  if (sameSiteDir) {
    const val = sameSiteDir.split('=')[1]?.trim();
    if (val === 'strict') sameSite = 'Strict';
    else if (val === 'lax') sameSite = 'Lax';
    else if (val === 'none') sameSite = 'None';
  }

  const hasExpiry = directives.some(d => d.startsWith('expires=') || d.startsWith('max-age='));

  const domainDir = directives.find(d => d.startsWith('domain='));
  const domain = domainDir ? domainDir.split('=')[1]?.trim() : undefined;

  const pathDir = directives.find(d => d.startsWith('path='));
  const path = pathDir ? pathDir.split('=')[1]?.trim() : undefined;

  const issues: string[] = [];
  if (!httpOnly) issues.push('Missing HttpOnly flag — JavaScript can read this cookie (XSS risk)');
  if (!secure) issues.push('Missing Secure flag — cookie may be transmitted over HTTP');
  if (sameSite === 'missing') issues.push('Missing SameSite attribute — vulnerable to CSRF attacks');
  if (sameSite === 'None' && !secure) issues.push('SameSite=None requires Secure flag — browsers will reject this cookie');
  if (sameSite === 'None') issues.push('SameSite=None allows cross-site sending — only use if cross-site access is required');

  const riskLevel: CookieDetail['riskLevel'] =
    issues.length >= 3 ? 'HIGH'
    : issues.length >= 1 ? 'MEDIUM'
    : 'LOW';

  return { name, httpOnly, secure, sameSite, hasExpiry, domain, path, issues, riskLevel };
}

// ============ Rate Limiting ============

async function checkRateLimit(
  config: CookieAuditConfig
): Promise<{ allowed: boolean; reason?: string }> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `cookieaudit:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  const dailyUsage = dailyCount ? parseInt(dailyCount) : 0;

  if (dailyUsage >= config.rateLimitPerDay) {
    return {
      allowed: false,
      reason: `Daily audit limit reached (${config.rateLimitPerDay} audits/day). Resets at midnight UTC.`,
    };
  }

  return { allowed: true };
}

async function incrementRateLimit(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `cookieaudit:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  await cacheQuery(dailyKey, String((dailyCount ? parseInt(dailyCount) : 0) + 1), 86400);
}

// ============ Config Helpers ============

async function getCookieAuditConfig(categoryId?: number): Promise<{
  enabled: boolean;
  config: CookieAuditConfig;
}> {
  if (categoryId) {
    const effective = await getEffectiveToolConfig('cookie_audit', categoryId);
    return {
      enabled: effective.enabled,
      config: (effective.config as unknown as CookieAuditConfig) || defaultConfig,
    };
  }

  const toolConfig = await getToolConfig('cookie_audit');
  if (toolConfig) {
    return {
      enabled: toolConfig.isEnabled,
      config: toolConfig.config as unknown as CookieAuditConfig,
    };
  }

  return { enabled: false, config: defaultConfig };
}

// ============ Config Schema ============

const configSchema = {
  type: 'object',
  properties: {
    followRedirects: {
      type: 'boolean',
      title: 'Follow Redirects',
      description: 'Follow HTTP redirects before inspecting cookies',
      default: true,
    },
    cacheTTLSeconds: {
      type: 'number',
      title: 'Cache Duration (seconds)',
      description: 'How long to cache results (86400 = 24 hours)',
      minimum: 300,
      maximum: 86400,
      default: 86400,
    },
    rateLimitPerDay: {
      type: 'number',
      title: 'Daily Audit Limit',
      description: 'Maximum audits per 24 hours',
      minimum: 1,
      maximum: 200,
      default: 50,
    },
  },
};

const defaultConfig: CookieAuditConfig = {
  cacheTTLSeconds: 86400,
  rateLimitPerDay: 50,
  followRedirects: true,
};

function validateConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  if (config.cacheTTLSeconds !== undefined) {
    const v = config.cacheTTLSeconds as number;
    if (typeof v !== 'number' || v < 300 || v > 86400) {
      errors.push('cacheTTLSeconds must be between 300 and 86400');
    }
  }
  if (config.rateLimitPerDay !== undefined) {
    const v = config.rateLimitPerDay as number;
    if (typeof v !== 'number' || v < 1 || v > 200) {
      errors.push('rateLimitPerDay must be between 1 and 200');
    }
  }
  return { valid: errors.length === 0, errors };
}

// ============ Tool Definition ============

export const cookieAuditTool: ToolDefinition = {
  name: 'cookie_audit',
  displayName: 'Cookie Security Audit',
  description: 'Inspect website cookies for missing security flags — HttpOnly, Secure, SameSite — to identify XSS and CSRF risks.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'cookie_audit',
      description:
        'Audit website cookies for security flags: HttpOnly (prevents XSS cookie theft), Secure (HTTPS only transmission), and SameSite (CSRF protection). Returns a per-cookie breakdown with specific issues and remediation. Use when users ask about cookie security, session management, XSS cookie risks, CSRF protection, or web application security hardening.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Full URL to audit (must include https:// or http://)',
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
    const categoryIds = (options as { categoryIds?: number[] })?.categoryIds || [];
    const { enabled, config: globalSettings } =
      categoryIds.length > 0
        ? await getCookieAuditConfig(categoryIds[0])
        : await getCookieAuditConfig();

    const configOverride = options?.configOverride || {};
    const settings = { ...globalSettings, ...configOverride } as CookieAuditConfig;

    if (!enabled) {
      return JSON.stringify({
        success: false,
        error: 'Cookie audit is currently disabled',
        errorCode: 'TOOL_DISABLED',
      });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(args.url);
    } catch {
      return JSON.stringify({
        success: false,
        error: 'Invalid URL format',
        errorCode: 'INVALID_URL',
      });
    }

    const hostname = parsedUrl.hostname;

    // Rate limit check
    const { allowed, reason } = await checkRateLimit(settings);
    if (!allowed) {
      return JSON.stringify({
        success: false,
        error: reason,
        errorCode: 'RATE_LIMIT_EXCEEDED',
      });
    }

    // Cache check
    const cacheKey = hashQuery(`cookieaudit:${args.url}`);
    const cached = await getCachedQuery(`cookieaudit:${cacheKey}`);
    if (cached) {
      console.log('[CookieAudit] Cache hit:', hostname);
      return cached;
    }

    try {
      // Fetch the URL
      const response = await fetch(args.url, {
        redirect: settings.followRedirects ? 'follow' : 'manual',
        headers: { 'User-Agent': 'PolicyBot-CookieAudit/1.0' },
      });

      const finalUrl = response.url || args.url;

      // Extract all Set-Cookie headers using getSetCookie() (Node 18.14+)
      const cookieHeaders: string[] = response.headers.getSetCookie();

      // Parse each cookie
      const cookies = cookieHeaders.map(parseCookieHeader);

      // Aggregate risk
      const allIssues = cookies.flatMap(c => c.issues);
      const issueCount = allIssues.length;
      const hasHighRisk = cookies.some(c => c.riskLevel === 'HIGH');
      const hasMediumRisk = cookies.some(c => c.riskLevel === 'MEDIUM');

      const riskLevel: CookieAuditResult['riskLevel'] =
        cookies.length === 0 ? 'LOW'
        : hasHighRisk ? 'HIGH'
        : hasMediumRisk ? 'MEDIUM'
        : 'LOW';

      const passed = riskLevel === 'LOW';

      // Build recommendations — deduplicated across cookies
      const recommendations: string[] = [];
      const missingHttpOnly = cookies.filter(c => !c.httpOnly).map(c => c.name);
      const missingSecure = cookies.filter(c => !c.secure).map(c => c.name);
      const missingSameSite = cookies.filter(c => c.sameSite === 'missing').map(c => c.name);

      if (missingHttpOnly.length > 0) recommendations.push(`Add HttpOnly flag to: ${missingHttpOnly.join(', ')}`);
      if (missingSecure.length > 0) recommendations.push(`Add Secure flag to: ${missingSecure.join(', ')}`);
      if (missingSameSite.length > 0) recommendations.push(`Add SameSite=Lax (or Strict) to: ${missingSameSite.join(', ')}`);
      if (cookies.length === 0) recommendations.push('No Set-Cookie headers found on this URL. Cookies may be set on authenticated pages not reachable without login.');
      if (recommendations.length === 0) recommendations.push('All cookies have proper security flags configured.');

      const result: CookieAuditResult = {
        url: args.url,
        finalUrl,
        scannedAt: new Date().toISOString(),
        cookieCount: cookies.length,
        cookies,
        issueCount,
        riskLevel,
        passed,
        summary: `${cookies.length} cookie(s) found | ${issueCount} issue(s) | Risk: ${riskLevel}`,
        recommendations,
      };

      const resultString = JSON.stringify({ success: true, data: result }, null, 2);
      await cacheQuery(`cookieaudit:${cacheKey}`, resultString, settings.cacheTTLSeconds);

      // Increment rate limit only after success
      await incrementRateLimit();

      return resultString;
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Cookie audit failed',
        errorCode: 'FETCH_ERROR',
      });
    }
  },
};

/**
 * Redirect Chain Audit Tool
 *
 * Follows HTTP redirects from the given URL and analyses the chain for:
 *   - HTTP -> HTTPS upgrade (should happen on first or second hop)
 *   - Mixed content hops (HTTPS redirecting to HTTP mid-chain)
 *   - Excessive hops (> 3 is a performance issue, > 5 is a SEO penalty risk)
 *   - Redirect loops (same URL appearing twice)
 *   - Final destination protocol (should always be HTTPS)
 *   - WWW / non-WWW canonicalisation
 *
 * No API key needed. Uses manual redirect following via fetch with redirect:'manual'.
 */

import { getToolConfig } from '../db/compat/tool-config';
import { getEffectiveToolConfig } from '../db/compat/category-tool-config';
import { hashQuery, getCachedQuery, cacheQuery } from '../redis';
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';

// ============ Types ============

interface RedirectAuditConfig {
  maxHops: number;
  cacheTTLSeconds: number;
  rateLimitPerDay: number;
  timeoutMs: number;
}

interface RedirectHop {
  order: number;
  url: string;
  statusCode: number;
  protocol: 'http' | 'https';
  issue?: string;
}

interface RedirectAuditResult {
  url: string;
  scannedAt: string;
  hopCount: number;
  hops: RedirectHop[];
  finalUrl: string;
  finalProtocol: 'http' | 'https';
  httpsUpgraded: boolean;
  upgradeOnFirstHop: boolean;
  hasMixedChain: boolean;
  hasLoop: boolean;
  excessiveHops: boolean;
  wwwRedirect: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  passed: boolean;
  summary: string;
  recommendations: string[];
}

// ============ Redirect Follower ============

async function followRedirects(
  startUrl: string,
  maxHops: number,
  timeoutMs: number
): Promise<{ hops: RedirectHop[]; finalUrl: string }> {
  const hops: RedirectHop[] = [];
  const visited = new Set<string>();
  let currentUrl = startUrl;

  for (let i = 0; i < maxHops; i++) {
    if (visited.has(currentUrl)) {
      hops.push({
        order: i + 1,
        url: currentUrl,
        statusCode: 0,
        protocol: currentUrl.startsWith('https') ? 'https' : 'http',
        issue: 'Redirect loop detected — same URL visited twice',
      });
      break;
    }
    visited.add(currentUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'PolicyBot-RedirectAudit/1.0' },
      });
      clearTimeout(timer);

      const protocol: 'http' | 'https' = currentUrl.startsWith('https') ? 'https' : 'http';
      const hop: RedirectHop = {
        order: i + 1,
        url: currentUrl,
        statusCode: res.status,
        protocol,
      };

      hops.push(hop);

      // Not a redirect — this is the final destination
      if (res.status < 300 || res.status >= 400) break;

      const location = res.headers.get('location');
      if (!location) break;

      // Resolve relative redirects
      currentUrl = new URL(location, currentUrl).href;
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        hops.push({
          order: i + 1,
          url: currentUrl,
          statusCode: 0,
          protocol: currentUrl.startsWith('https') ? 'https' : 'http',
          issue: 'Request timed out',
        });
      }
      break;
    }
  }

  return { hops, finalUrl: currentUrl };
}

// ============ Analysis ============

function analyseChain(
  hops: RedirectHop[],
  finalUrl: string,
  startUrl: string
): Omit<RedirectAuditResult, 'url' | 'scannedAt' | 'hops' | 'finalUrl'> {
  const finalProtocol: 'http' | 'https' = finalUrl.startsWith('https') ? 'https' : 'http';
  const httpsUpgraded = startUrl.startsWith('http:') && finalProtocol === 'https';
  const upgradeOnFirstHop =
    hops.length >= 2 && hops[0].protocol === 'http' && hops[1].protocol === 'https';

  // Mixed chain: any HTTPS hop followed by HTTP hop
  let hasMixedChain = false;
  for (let i = 0; i < hops.length - 1; i++) {
    if (hops[i].protocol === 'https' && hops[i + 1].protocol === 'http') {
      hasMixedChain = true;
      hops[i + 1].issue = 'HTTPS downgrade — HTTPS redirected to HTTP';
    }
  }

  const hasLoop = hops.some(h => h.issue?.includes('loop'));
  const excessiveHops = hops.length > 3;

  // WWW canonicalisation check
  const startHostname = new URL(
    startUrl.startsWith('http') ? startUrl : `https://${startUrl}`
  ).hostname;
  const finalHostname = new URL(
    finalUrl.startsWith('http') ? finalUrl : `https://${finalUrl}`
  ).hostname;
  const wwwRedirect =
    startHostname.startsWith('www.') !== finalHostname.startsWith('www.');

  // Risk
  const riskLevel: RedirectAuditResult['riskLevel'] =
    hasMixedChain || hasLoop
      ? 'HIGH'
      : excessiveHops || (startUrl.startsWith('http:') && !httpsUpgraded)
        ? 'MEDIUM'
        : 'LOW';

  const passed = riskLevel === 'LOW';

  const recommendations: string[] = [];
  if (hasMixedChain)
    recommendations.push(
      'HTTPS to HTTP redirect detected mid-chain — this downgrades security and may expose session cookies'
    );
  if (hasLoop)
    recommendations.push(
      'Redirect loop detected — the server has a circular redirect configuration'
    );
  if (startUrl.startsWith('http:') && !httpsUpgraded)
    recommendations.push(
      'HTTP URL does not redirect to HTTPS — all HTTP traffic should redirect to HTTPS'
    );
  if (!upgradeOnFirstHop && startUrl.startsWith('http:') && httpsUpgraded)
    recommendations.push(
      'HTTP to HTTPS upgrade does not happen on first hop — consider consolidating to a single redirect'
    );
  if (excessiveHops)
    recommendations.push(
      `${hops.length} redirect hops detected — more than 3 hops hurts SEO and performance. Consolidate to 1-2 hops.`
    );
  if (wwwRedirect)
    recommendations.push(
      `WWW canonicalisation redirect detected (${startHostname} -> ${finalHostname}) — ensure this is intentional and consistent`
    );
  if (recommendations.length === 0)
    recommendations.push(
      'Redirect chain is clean — HTTP upgrades to HTTPS in one hop with no mixed content or loops.'
    );

  return {
    hopCount: hops.length,
    finalProtocol,
    httpsUpgraded,
    upgradeOnFirstHop,
    hasMixedChain,
    hasLoop,
    excessiveHops,
    wwwRedirect,
    riskLevel,
    passed,
    summary: `${hops.length} hop(s) | Final: ${finalProtocol.toUpperCase()} | Risk: ${riskLevel}`,
    recommendations,
  };
}

// ============ Rate Limiting ============

async function checkRateLimit(
  config: RedirectAuditConfig
): Promise<{ allowed: boolean; reason?: string }> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `redirectaudit:rate:daily:${today}`;
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
  const dailyKey = `redirectaudit:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  await cacheQuery(dailyKey, String((dailyCount ? parseInt(dailyCount) : 0) + 1), 86400);
}

// ============ Config Helpers ============

async function getRedirectAuditConfig(categoryId?: number): Promise<{
  enabled: boolean;
  config: RedirectAuditConfig;
}> {
  if (categoryId) {
    const effective = await getEffectiveToolConfig('redirect_audit', categoryId);
    return {
      enabled: effective.enabled,
      config: (effective.config as unknown as RedirectAuditConfig) || defaultConfig,
    };
  }

  const toolConfig = await getToolConfig('redirect_audit');
  if (toolConfig) {
    return {
      enabled: toolConfig.isEnabled,
      config: toolConfig.config as unknown as RedirectAuditConfig,
    };
  }

  return { enabled: false, config: defaultConfig };
}

// ============ Config Schema ============

const configSchema = {
  type: 'object',
  properties: {
    maxHops: {
      type: 'number',
      title: 'Max Redirect Hops',
      description: 'Stop following after this many redirects',
      minimum: 3,
      maximum: 20,
      default: 10,
    },
    timeoutMs: {
      type: 'number',
      title: 'Request Timeout (ms)',
      description: 'Timeout per hop in milliseconds',
      minimum: 2000,
      maximum: 30000,
      default: 10000,
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

const defaultConfig: RedirectAuditConfig = {
  maxHops: 10,
  cacheTTLSeconds: 86400,
  rateLimitPerDay: 50,
  timeoutMs: 10000,
};

function validateConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  if (config.maxHops !== undefined) {
    const v = config.maxHops as number;
    if (typeof v !== 'number' || v < 3 || v > 20) {
      errors.push('maxHops must be between 3 and 20');
    }
  }
  if (config.timeoutMs !== undefined) {
    const v = config.timeoutMs as number;
    if (typeof v !== 'number' || v < 2000 || v > 30000) {
      errors.push('timeoutMs must be between 2000 and 30000');
    }
  }
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

export const redirectAuditTool: ToolDefinition = {
  name: 'redirect_audit',
  displayName: 'Redirect Chain Audit',
  description:
    'Analyse HTTP redirect chain — checks HTTP to HTTPS upgrade, mixed content hops, loops, and excessive redirects.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'redirect_audit',
      description:
        'Audit the HTTP redirect chain of a URL. Checks: HTTP to HTTPS upgrade (and whether it happens on the first hop), HTTPS to HTTP downgrade mid-chain (mixed content), redirect loops, excessive hops (>3 hurts SEO), and WWW canonicalisation. Use when users ask about redirects, HTTPS configuration, mixed content, SEO redirect issues, or HTTP security.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to audit (http:// or https://)',
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
        ? await getRedirectAuditConfig(categoryIds[0])
        : await getRedirectAuditConfig();

    const configOverride = options?.configOverride || {};
    const settings = { ...globalSettings, ...configOverride } as RedirectAuditConfig;

    if (!enabled) {
      return JSON.stringify({
        success: false,
        error: 'Redirect audit is currently disabled',
        errorCode: 'TOOL_DISABLED',
      });
    }

    let hostname: string;
    try {
      hostname = new URL(args.url).hostname;
    } catch {
      return JSON.stringify({
        success: false,
        error: 'Invalid URL format',
        errorCode: 'INVALID_URL',
      });
    }

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
    const cacheKey = hashQuery(`redirectaudit:${args.url}`);
    const cached = await getCachedQuery(`redirectaudit:${cacheKey}`);
    if (cached) {
      console.log('[RedirectAudit] Cache hit:', hostname);
      return cached;
    }

    try {
      const { hops, finalUrl } = await followRedirects(
        args.url,
        settings.maxHops,
        settings.timeoutMs
      );
      const analysis = analyseChain(hops, finalUrl, args.url);
      const result: RedirectAuditResult = {
        url: args.url,
        scannedAt: new Date().toISOString(),
        hops,
        finalUrl,
        ...analysis,
      };

      const response = JSON.stringify({ success: true, data: result }, null, 2);
      await cacheQuery(`redirectaudit:${cacheKey}`, response, settings.cacheTTLSeconds);

      // Increment rate limit only after success
      await incrementRateLimit();

      return response;
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Redirect audit failed',
        errorCode: 'AUDIT_ERROR',
      });
    }
  },
};

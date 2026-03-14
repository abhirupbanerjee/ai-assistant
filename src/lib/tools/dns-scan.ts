/**
 * DNS Security Scan Tool — DNS-over-HTTPS Integration
 *
 * Checks email authentication and DNS security records for a domain:
 * - SPF  (Sender Policy Framework)     — prevents email spoofing
 * - DMARC (Domain-based Message Auth)  — email authentication policy
 * - DKIM  (DomainKeys Identified Mail) — email signing (common selectors)
 * - DNSSEC                             — DNS response integrity
 *
 * Uses Google DNS-over-HTTPS (dns.google/resolve) — free, no API key needed.
 * Results cached 24 hours (DNS records change infrequently).
 */

import { getToolConfig } from '../db/compat/tool-config';
import { getEffectiveToolConfig } from '../db/compat/category-tool-config';
import { hashQuery, getCachedQuery, cacheQuery } from '../redis';
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';

// ============ Types ============

interface DnsScanConfig {
  cacheTTLSeconds: number;
  rateLimitPerDay: number;
  dkimSelectors: string[];
}

interface SpfResult {
  exists: boolean;
  record: string | null;
  mechanism: string | null;
  issue: string | null;
}

interface DmarcResult {
  exists: boolean;
  record: string | null;
  policy: string | null;
  subdomainPolicy: string | null;
  pct: number | null;
  issue: string | null;
}

interface DkimResult {
  checked: string[];
  found: string[];
  exists: boolean;
}

interface DnssecResult {
  enabled: boolean;
  issue: string | null;
}

interface DnsScanResult {
  url: string;
  hostname: string;
  scannedAt: string;
  spf: SpfResult;
  dmarc: DmarcResult;
  dkim: DkimResult;
  dnssec: DnssecResult;
  issuesCount: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  passed: boolean;
  summary: string;
  recommendations: string[];
}

// ============ DNS Query Helper ============

const DNS_API = 'https://dns.google/resolve';

async function dnsQuery(name: string, type: string): Promise<string[]> {
  try {
    const res = await fetch(
      `${DNS_API}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      { headers: { Accept: 'application/dns-json' } }
    );
    if (!res.ok) return [];
    const data = await res.json() as { Answer?: Array<{ data: string }> };
    return (data.Answer || []).map(r => r.data.replace(/^"|"$/g, '').trim());
  } catch {
    return [];
  }
}

async function dnsQueryRaw(name: string, type: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(
      `${DNS_API}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      { headers: { Accept: 'application/dns-json' } }
    );
    if (!res.ok) return {};
    return await res.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ============ Individual Record Checkers ============

async function checkSpf(hostname: string): Promise<SpfResult> {
  const records = await dnsQuery(hostname, 'TXT');
  const spfRecord = records.find(r => r.startsWith('v=spf1'));

  if (!spfRecord) {
    return {
      exists: false,
      record: null,
      mechanism: null,
      issue: 'SPF record missing — anyone can send email appearing to be from this domain',
    };
  }

  const allMatch = spfRecord.match(/([+\-~?])all/);
  const mechanism = allMatch ? allMatch[0] : null;

  let issue: string | null = null;
  if (mechanism === '+all') {
    issue = 'SPF uses "+all" — allows ANY server to send mail. This provides no protection.';
  } else if (mechanism === '?all') {
    issue = 'SPF uses "?all" (neutral) — no enforcement. Consider changing to "~all" or "-all".';
  } else if (!mechanism) {
    issue = 'SPF record has no "all" mechanism — incomplete policy.';
  }

  return { exists: true, record: spfRecord, mechanism, issue };
}

async function checkDmarc(hostname: string): Promise<DmarcResult> {
  const records = await dnsQuery(`_dmarc.${hostname}`, 'TXT');
  const dmarcRecord = records.find(r => r.startsWith('v=DMARC1'));

  if (!dmarcRecord) {
    return {
      exists: false,
      record: null,
      policy: null,
      subdomainPolicy: null,
      pct: null,
      issue: 'DMARC record missing — no email authentication policy in place',
    };
  }

  const policyMatch = dmarcRecord.match(/\bp=(\w+)/);
  const policy = policyMatch ? policyMatch[1].toLowerCase() : null;

  const spMatch = dmarcRecord.match(/\bsp=(\w+)/);
  const subdomainPolicy = spMatch ? spMatch[1].toLowerCase() : null;

  const pctMatch = dmarcRecord.match(/\bpct=(\d+)/);
  const pct = pctMatch ? parseInt(pctMatch[1], 10) : 100;

  let issue: string | null = null;
  if (policy === 'none') {
    issue = 'DMARC policy is "none" — monitoring only, no enforcement. Upgrade to "quarantine" or "reject".';
  } else if (pct !== null && pct < 100) {
    issue = `DMARC pct=${pct} — policy only applies to ${pct}% of messages. Set pct=100 for full enforcement.`;
  }

  return { exists: true, record: dmarcRecord, policy, subdomainPolicy, pct, issue };
}

async function checkDkim(hostname: string, selectors: string[]): Promise<DkimResult> {
  const checks = await Promise.allSettled(
    selectors.map(selector =>
      dnsQuery(`${selector}._domainkey.${hostname}`, 'TXT')
    )
  );

  const found: string[] = [];
  checks.forEach((result, index) => {
    if (
      result.status === 'fulfilled' &&
      result.value.length > 0 &&
      result.value.some(r => r.includes('v=DKIM1') || r.includes('k=rsa') || r.includes('p='))
    ) {
      found.push(selectors[index]);
    }
  });

  return {
    checked: selectors,
    found,
    exists: found.length > 0,
  };
}

async function checkDnssec(hostname: string): Promise<DnssecResult> {
  const dsData = await dnsQueryRaw(hostname, 'DS');
  const answers = (dsData.Answer as unknown[]) || [];

  const adData = await dnsQueryRaw(hostname, 'A');
  const adFlag = (adData as { AD?: boolean }).AD === true;

  const enabled = answers.length > 0 || adFlag;

  return {
    enabled,
    issue: enabled ? null : 'DNSSEC not enabled — DNS responses can be spoofed (DNS cache poisoning)',
  };
}

// ============ Risk Assessment ============

function assessRisk(result: { spf: SpfResult; dmarc: DmarcResult; dkim: DkimResult; dnssec: DnssecResult }): {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  issuesCount: number;
} {
  let highCount = 0;
  let mediumCount = 0;

  if (!result.spf.exists) highCount++;
  else if (result.spf.mechanism === '+all' || result.spf.mechanism === '?all') highCount++;

  if (!result.dmarc.exists) highCount++;
  else if (result.dmarc.policy === 'none') mediumCount++;

  if (!result.dkim.exists) mediumCount++;
  if (!result.dnssec.enabled) mediumCount++;

  const issuesCount = highCount + mediumCount;

  const riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' =
    highCount >= 2 ? 'CRITICAL'
    : highCount === 1 ? 'HIGH'
    : mediumCount >= 1 ? 'MEDIUM'
    : 'LOW';

  return { riskLevel, issuesCount };
}

function buildRecommendations(result: { spf: SpfResult; dmarc: DmarcResult; dkim: DkimResult; dnssec: DnssecResult }): string[] {
  const recs: string[] = [];

  if (result.spf.issue) recs.push(`SPF: ${result.spf.issue}`);
  if (result.dmarc.issue) recs.push(`DMARC: ${result.dmarc.issue}`);
  if (!result.dkim.exists) {
    recs.push(`DKIM: No DKIM record found on checked selectors (${result.dkim.checked.join(', ')}). Configure DKIM signing on your mail server and publish the public key.`);
  }
  if (result.dnssec.issue) recs.push(`DNSSEC: ${result.dnssec.issue}`);

  if (recs.length === 0) {
    recs.push('All email security records are properly configured. Continue monitoring for changes.');
  }

  return recs;
}

// ============ Rate Limiting ============

async function checkRateLimit(
  config: DnsScanConfig
): Promise<{ allowed: boolean; reason?: string }> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `dnsscan:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  const dailyUsage = dailyCount ? parseInt(dailyCount) : 0;

  if (dailyUsage >= config.rateLimitPerDay) {
    return {
      allowed: false,
      reason: `Daily scan limit reached (${config.rateLimitPerDay} scans/day). Resets at midnight UTC.`,
    };
  }

  return { allowed: true };
}

async function incrementRateLimit(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `dnsscan:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  await cacheQuery(dailyKey, String((dailyCount ? parseInt(dailyCount) : 0) + 1), 86400);
}

// ============ Config Helpers ============

async function getDnsScanConfig(categoryId?: number): Promise<{
  enabled: boolean;
  config: DnsScanConfig;
}> {
  if (categoryId) {
    const effective = await getEffectiveToolConfig('dns_scan', categoryId);
    return {
      enabled: effective.enabled,
      config: (effective.config as unknown as DnsScanConfig) || defaultConfig,
    };
  }

  const toolConfig = await getToolConfig('dns_scan');
  if (toolConfig) {
    return {
      enabled: toolConfig.isEnabled,
      config: toolConfig.config as unknown as DnsScanConfig,
    };
  }

  return { enabled: false, config: defaultConfig };
}

// ============ Config Schema ============

const configSchema = {
  type: 'object',
  properties: {
    dkimSelectors: {
      type: 'array',
      title: 'DKIM Selectors to Check',
      description: 'List of DKIM selector names to probe. Common selectors: default, google, selector1, selector2, mail, smtp',
      items: { type: 'string' },
      default: ['default', 'google', 'selector1', 'selector2', 'mail', 'smtp', 'dkim'],
    },
    cacheTTLSeconds: {
      type: 'number',
      title: 'Cache Duration (seconds)',
      description: 'DNS records change infrequently — 24 hours is appropriate (86400)',
      minimum: 3600,
      maximum: 86400,
      default: 86400,
    },
    rateLimitPerDay: {
      type: 'number',
      title: 'Daily Scan Limit',
      description: 'Maximum scans per 24 hours per domain',
      minimum: 1,
      maximum: 200,
      default: 50,
    },
  },
};

const defaultConfig: DnsScanConfig = {
  cacheTTLSeconds: 86400,
  rateLimitPerDay: 50,
  dkimSelectors: ['default', 'google', 'selector1', 'selector2', 'mail', 'smtp', 'dkim'],
};

function validateConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  if (config.cacheTTLSeconds !== undefined) {
    const v = config.cacheTTLSeconds as number;
    if (typeof v !== 'number' || v < 3600 || v > 86400) {
      errors.push('cacheTTLSeconds must be between 3600 and 86400');
    }
  }
  if (config.rateLimitPerDay !== undefined) {
    const v = config.rateLimitPerDay as number;
    if (typeof v !== 'number' || v < 1 || v > 200) {
      errors.push('rateLimitPerDay must be between 1 and 200');
    }
  }
  if (config.dkimSelectors !== undefined && !Array.isArray(config.dkimSelectors)) {
    errors.push('dkimSelectors must be an array of strings');
  }
  return { valid: errors.length === 0, errors };
}

// ============ Tool Definition ============

export const dnsScanTool: ToolDefinition = {
  name: 'dns_scan',
  displayName: 'DNS Security Scan',
  description: 'Check email authentication and DNS security records — SPF, DMARC, DKIM, and DNSSEC.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'dns_scan',
      description:
        'Check DNS security records for a domain including: SPF (Sender Policy Framework — prevents email spoofing), DMARC (email authentication policy and reporting), DKIM (email signing key detection on common selectors), and DNSSEC (DNS response integrity). Returns a risk level (LOW/MEDIUM/HIGH/CRITICAL) with specific issues and remediation advice. Use when users ask about email security, DNS configuration, email spoofing, phishing risk, or domain security posture.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Full URL or domain to check (e.g. https://gov.gd or gov.gd)',
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
        ? await getDnsScanConfig(categoryIds[0])
        : await getDnsScanConfig();

    const configOverride = options?.configOverride || {};
    const settings = { ...globalSettings, ...configOverride } as DnsScanConfig;

    if (!enabled) {
      return JSON.stringify({
        success: false,
        error: 'DNS security scanning is currently disabled',
        errorCode: 'TOOL_DISABLED',
      });
    }

    // Extract hostname — accept both full URL and bare domain
    let hostname: string;
    try {
      const input = args.url.includes('://') ? args.url : `https://${args.url}`;
      hostname = new URL(input).hostname;
    } catch {
      return JSON.stringify({
        success: false,
        error: 'Invalid URL or domain format',
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
    const cacheKey = hashQuery(`dnsscan:${hostname}`);
    const cached = await getCachedQuery(`dnsscan:${cacheKey}`);
    if (cached) {
      console.log('[DNSScan] Cache hit:', hostname);
      return cached;
    }

    // Run all DNS checks in parallel
    const [spf, dmarc, dkim, dnssec] = await Promise.all([
      checkSpf(hostname),
      checkDmarc(hostname),
      checkDkim(hostname, settings.dkimSelectors),
      checkDnssec(hostname),
    ]);

    const partial = { spf, dmarc, dkim, dnssec };
    const { riskLevel, issuesCount } = assessRisk(partial);
    const recommendations = buildRecommendations(partial);
    const passed = riskLevel === 'LOW';

    const checks = [
      spf.exists ? 'SPF OK' : 'SPF MISSING',
      dmarc.exists ? `DMARC (${dmarc.policy})` : 'DMARC MISSING',
      dkim.exists ? `DKIM (${dkim.found.join(', ')})` : 'DKIM NOT FOUND',
      dnssec.enabled ? 'DNSSEC OK' : 'DNSSEC OFF',
    ];

    const result: DnsScanResult = {
      url: args.url,
      hostname,
      scannedAt: new Date().toISOString(),
      spf,
      dmarc,
      dkim,
      dnssec,
      issuesCount,
      riskLevel,
      passed,
      summary: `Risk: ${riskLevel} | ${checks.join(' | ')}`,
      recommendations,
    };

    const response = JSON.stringify({ success: true, data: result }, null, 2);
    await cacheQuery(`dnsscan:${cacheKey}`, response, settings.cacheTTLSeconds);

    // Increment rate limit only after success
    await incrementRateLimit();

    return response;
  },
};

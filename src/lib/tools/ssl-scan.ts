/**
 * SSL Scan Tool — SSL Labs API v4 Integration
 *
 * Analyzes SSL/TLS configuration of a website using the free SSL Labs API.
 * Checks: TLS grade (A+ to F), protocol versions, certificate validity,
 * cipher strength, and known vulnerabilities (BEAST, Heartbleed, POODLE, etc.)
 *
 * API docs: https://github.com/ssllabs/ssllabs-scan/blob/master/ssllabs-api-docs-v4.md
 * Free, but requires one-time email registration at https://api.ssllabs.com/api/v4/register
 * Results cached 24 hours.
 *
 * Note: v3 was deprecated January 2024. v4 requires the registered email sent as a
 * request header. Without an email configured, falls back to direct TLS check.
 */

import * as tls from 'tls';
import { getToolConfig } from '../db/compat/tool-config';
import { getEffectiveToolConfig } from '../db/compat/category-tool-config';
import { hashQuery, getCachedQuery, cacheQuery } from '../redis';
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';

// ============ Types ============

interface SslScanConfig {
  maxWaitSeconds: number;
  cacheTTLSeconds: number;
  rateLimitPerDay: number;
  email: string;
}

interface SslScanResult {
  url: string;
  hostname: string;
  scannedAt: string;
  grade: string;
  gradeTrustIgnored?: string;
  protocol: string;
  certExpiry: string | null;
  certIssuer: string | null;
  daysUntilExpiry: number | null;
  supportsOldTls: boolean;
  forwardSecrecy: boolean;
  vulnerabilities: string[];
  passed: boolean;
  summary: string;
  recommendations: string[];
}

// ============ SSL Labs Client ============

const SSL_LABS_API = 'https://api.ssllabs.com/api/v4/analyze';

async function pollSslLabs(
  hostname: string,
  maxWaitSeconds: number,
  email: string
): Promise<Record<string, unknown>> {
  const headers = { 'User-Agent': 'PolicyBot-SSLScan/1.0', email };

  const triggerRes = await fetch(
    `${SSL_LABS_API}?host=${encodeURIComponent(hostname)}&all=done`,
    { headers }
  );
  if (!triggerRes.ok) {
    const body = await triggerRes.text().catch(() => '');
    throw new Error(`SSL Labs API error: ${triggerRes.status} ${triggerRes.statusText}${body ? ` — ${body}` : ''}`);
  }

  let data = await triggerRes.json() as Record<string, unknown>;

  const deadline = Date.now() + maxWaitSeconds * 1000;
  while (
    data.status !== 'READY' &&
    data.status !== 'ERROR' &&
    Date.now() < deadline
  ) {
    await new Promise(resolve => setTimeout(resolve, 10000));

    const pollRes = await fetch(
      `${SSL_LABS_API}?host=${encodeURIComponent(hostname)}&all=done`,
      { headers }
    );
    if (!pollRes.ok) {
      throw new Error(`SSL Labs polling error: ${pollRes.status} ${pollRes.statusText}`);
    }
    data = await pollRes.json() as Record<string, unknown>;
  }

  if (data.status === 'ERROR') {
    const errMsg = (data.statusMessage as string) || 'SSL Labs analysis failed';
    throw new Error(`SSL Labs error: ${errMsg}`);
  }

  if (data.status !== 'READY') {
    throw new Error(
      `SSL Labs analysis timed out after ${maxWaitSeconds}s. ` +
      `This usually means SSL Labs is busy. Try again in a few minutes.`
    );
  }

  return data;
}

function normalizeResult(url: string, data: Record<string, unknown>): SslScanResult {
  const endpoints = (data.endpoints as Record<string, unknown>[]) || [];
  const endpoint = endpoints[0] || {};
  const details = (endpoint.details as Record<string, unknown>) || {};

  const grade = (endpoint.grade as string) || 'N/A';
  const gradeTrustIgnored = (endpoint.gradeTrustIgnored as string) || undefined;

  const protocols = (details.protocols as Array<{ name: string; version: string }>) || [];
  const sorted = [...protocols].sort(
    (a, b) => parseFloat(b.version) - parseFloat(a.version)
  );
  const protocol = sorted.length > 0
    ? `${sorted[0].name} ${sorted[0].version}`
    : 'Unknown';

  const certs = (data.certs as Record<string, unknown>[]) || [];
  const cert = certs[0] || (details.cert as Record<string, unknown>) || {};
  const notAfterMs = cert.notAfter as number | undefined;
  let certExpiry: string | null = null;
  let daysUntilExpiry: number | null = null;

  if (notAfterMs) {
    const expiryDate = new Date(notAfterMs);
    certExpiry = expiryDate.toISOString().split('T')[0];
    daysUntilExpiry = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }

  const certIssuer = (cert.issuerLabel as string) || null;

  const supportsOldTls = protocols.some(
    p => p.name === 'TLS' && parseFloat(p.version) < 1.2
  );

  const fsValue = (details.forwardSecrecy as number) || 0;
  const forwardSecrecy = fsValue >= 2;

  const vulnerabilities: string[] = [];
  if (details.vulnBeast) vulnerabilities.push('BEAST');
  if (details.heartbleed) vulnerabilities.push('Heartbleed');
  if (details.poodle) vulnerabilities.push('POODLE (SSLv3)');
  if ((details.poodleTls as number) === 2) vulnerabilities.push('POODLE (TLS)');
  if (details.freak) vulnerabilities.push('FREAK');
  if (details.logjam) vulnerabilities.push('Logjam');
  if (details.drownVulnerable) vulnerabilities.push('DROWN');
  if ((details.ticketbleed as number) === 2) vulnerabilities.push('Ticketbleed');
  if ((details.bleichenbacher as number) > 1) vulnerabilities.push('ROBOT/Bleichenbacher');

  const recommendations: string[] = [];
  if (grade === 'F' || grade === 'T') {
    recommendations.push('Certificate is untrusted or TLS configuration has failed — resolve immediately.');
  }
  if (grade === 'M') {
    recommendations.push('Certificate name mismatch — ensure the certificate covers this hostname.');
  }
  if (vulnerabilities.length > 0) {
    recommendations.push(`Known vulnerabilities detected: ${vulnerabilities.join(', ')} — patch or reconfigure the server immediately.`);
  }
  if (supportsOldTls) {
    recommendations.push('Server supports deprecated TLS 1.0/1.1 — disable these protocol versions.');
  }
  if (!forwardSecrecy) {
    recommendations.push('Forward secrecy not fully supported — enable ECDHE cipher suites.');
  }
  if (daysUntilExpiry !== null && daysUntilExpiry < 30) {
    recommendations.push(`Certificate expires in ${daysUntilExpiry} days — renew immediately.`);
  } else if (daysUntilExpiry !== null && daysUntilExpiry < 60) {
    recommendations.push(`Certificate expires in ${daysUntilExpiry} days — schedule renewal soon.`);
  }
  if (recommendations.length === 0) {
    recommendations.push('SSL/TLS configuration is strong. Continue monitoring certificate expiry.');
  }

  const passed = ['A+', 'A', 'A-', 'B'].includes(grade);

  const summaryParts: string[] = [
    `Grade: ${grade}`,
    `Protocol: ${protocol}`,
  ];
  if (certExpiry) summaryParts.push(`Cert expires: ${certExpiry} (${daysUntilExpiry}d)`);
  if (certIssuer) summaryParts.push(`Issuer: ${certIssuer}`);
  if (vulnerabilities.length > 0) summaryParts.push(`Vulnerabilities: ${vulnerabilities.join(', ')}`);

  return {
    url,
    hostname: new URL(url).hostname,
    scannedAt: new Date().toISOString(),
    grade,
    gradeTrustIgnored,
    protocol,
    certExpiry,
    certIssuer,
    daysUntilExpiry,
    supportsOldTls,
    forwardSecrecy,
    vulnerabilities,
    passed,
    summary: summaryParts.join(' | '),
    recommendations,
  };
}

// ============ TLS Direct Fallback ============
// Used when SSL Labs API is unavailable (529 overloaded). Connects directly to port 443
// and extracts certificate info, protocol version, and cipher from the TLS handshake.

async function tlsDirectCheck(url: string, hostname: string): Promise<SslScanResult> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate(true);
        const protocol = socket.getProtocol() ?? 'Unknown';
        const cipher = socket.getCipher();
        socket.destroy();

        let certExpiry: string | null = null;
        let daysUntilExpiry: number | null = null;
        if (cert.valid_to) {
          const expiryDate = new Date(cert.valid_to);
          certExpiry = expiryDate.toISOString().split('T')[0];
          daysUntilExpiry = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        }

        const issuer = cert.issuer as unknown as Record<string, string>;
        const certIssuer = issuer?.O || issuer?.CN || null;

        const authorized = socket.authorized;
        const authError = socket.authorizationError;

        // Forward secrecy: cipher name includes DHE or ECDHE
        const cipherName = cipher?.name ?? '';
        const forwardSecrecy = /ECDHE|DHE/.test(cipherName);

        const recommendations: string[] = [];
        if (!authorized && authError) {
          recommendations.push(`Certificate trust issue: ${authError}`);
        }
        if (daysUntilExpiry !== null && daysUntilExpiry < 30) {
          recommendations.push(`Certificate expires in ${daysUntilExpiry} days — renew immediately.`);
        } else if (daysUntilExpiry !== null && daysUntilExpiry < 60) {
          recommendations.push(`Certificate expires in ${daysUntilExpiry} days — schedule renewal soon.`);
        }
        if (!forwardSecrecy) {
          recommendations.push('Forward secrecy not detected — consider enabling ECDHE cipher suites.');
        }
        if (recommendations.length === 0) {
          recommendations.push('Certificate is valid and TLS connection succeeded. Run a full SSL Labs scan for a detailed grade.');
        }

        const passed = authorized && (daysUntilExpiry === null || daysUntilExpiry > 0);
        const summaryParts = [`Protocol: ${protocol}`, `Cipher: ${cipherName}`];
        if (certExpiry) summaryParts.push(`Cert expires: ${certExpiry} (${daysUntilExpiry}d)`);
        if (certIssuer) summaryParts.push(`Issuer: ${certIssuer}`);

        resolve({
          url,
          hostname,
          scannedAt: new Date().toISOString(),
          grade: 'N/A (SSL Labs unavailable — direct TLS check)',
          protocol,
          certExpiry,
          certIssuer,
          daysUntilExpiry,
          supportsOldTls: false,
          forwardSecrecy,
          vulnerabilities: [],
          passed,
          summary: summaryParts.join(' | '),
          recommendations,
        });
      }
    );

    socket.setTimeout(15000, () => {
      socket.destroy();
      reject(new Error('TLS connection timed out'));
    });
    socket.on('error', reject);
  });
}

// ============ Rate Limiting ============

async function checkRateLimit(
  hostname: string,
  config: SslScanConfig
): Promise<{ allowed: boolean; reason?: string }> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `sslscan:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  const dailyUsage = dailyCount ? parseInt(dailyCount) : 0;

  if (dailyUsage >= config.rateLimitPerDay) {
    return {
      allowed: false,
      reason: `Daily scan limit reached for ${hostname} (${config.rateLimitPerDay} scans/day). Resets at midnight UTC.`,
    };
  }

  return { allowed: true };
}

async function incrementRateLimit(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `sslscan:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  await cacheQuery(dailyKey, String((dailyCount ? parseInt(dailyCount) : 0) + 1), 86400);
}

// ============ Config Helpers ============

async function getSslScanConfig(categoryId?: number): Promise<{
  enabled: boolean;
  config: SslScanConfig;
}> {
  if (categoryId) {
    const effective = await getEffectiveToolConfig('ssl_scan', categoryId);
    return {
      enabled: effective.enabled,
      config: (effective.config as unknown as SslScanConfig) || defaultConfig,
    };
  }

  const toolConfig = await getToolConfig('ssl_scan');
  if (toolConfig) {
    return {
      enabled: toolConfig.isEnabled,
      config: toolConfig.config as unknown as SslScanConfig,
    };
  }

  return { enabled: false, config: defaultConfig };
}

// ============ Config Schema ============

const configSchema = {
  type: 'object',
  properties: {
    maxWaitSeconds: {
      type: 'number',
      title: 'SSL Labs Max Wait (seconds)',
      description:
        'SSL Labs performs a full TLS handshake analysis on first scan — this takes 60–120s. Cached results return instantly within the cache window.',
      minimum: 60,
      maximum: 300,
      default: 120,
    },
    cacheTTLSeconds: {
      type: 'number',
      title: 'Cache Duration (seconds)',
      description: 'How long to cache scan results (86400 = 24 hours)',
      minimum: 3600,
      maximum: 86400,
      default: 86400,
    },
    rateLimitPerDay: {
      type: 'number',
      title: 'Daily Scan Limit',
      description: 'Maximum scans per 24 hours',
      minimum: 1,
      maximum: 50,
      default: 20,
    },
    email: {
      type: 'string',
      title: 'SSL Labs v4 Registered Email',
      description: 'Organisation email registered at https://api.ssllabs.com/api/v4/register — required for SSL Labs v4 API access. Without this, falls back to direct TLS check (no grade).',
      default: '',
    },
  },
};

const defaultConfig: SslScanConfig = {
  maxWaitSeconds: 120,
  cacheTTLSeconds: 86400,
  rateLimitPerDay: 20,
  email: '',
};

function validateConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  if (config.maxWaitSeconds !== undefined) {
    const v = config.maxWaitSeconds as number;
    if (typeof v !== 'number' || v < 60 || v > 300) {
      errors.push('maxWaitSeconds must be between 60 and 300');
    }
  }
  if (config.cacheTTLSeconds !== undefined) {
    const v = config.cacheTTLSeconds as number;
    if (typeof v !== 'number' || v < 3600 || v > 86400) {
      errors.push('cacheTTLSeconds must be between 3600 and 86400');
    }
  }
  if (config.rateLimitPerDay !== undefined) {
    const v = config.rateLimitPerDay as number;
    if (typeof v !== 'number' || v < 1 || v > 50) {
      errors.push('rateLimitPerDay must be between 1 and 50');
    }
  }
  return { valid: errors.length === 0, errors };
}

// ============ Tool Definition ============

export const sslScanTool: ToolDefinition = {
  name: 'ssl_scan',
  displayName: 'SSL Scan',
  description: 'Analyze SSL/TLS configuration using SSL Labs — grades TLS protocol, certificate validity, cipher strength, and known vulnerabilities.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'ssl_scan',
      description:
        'Analyze the SSL/TLS configuration of a website using SSL Labs. Returns a grade (A+ to F), TLS protocol version, certificate expiry date and issuer, cipher strength, forward secrecy status, and any known vulnerabilities (BEAST, Heartbleed, POODLE, FREAK, Logjam, DROWN). Use when users ask about SSL, TLS, certificate expiry, HTTPS configuration, or encryption strength.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Full URL of the website to scan (must include https://)',
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
        ? await getSslScanConfig(categoryIds[0])
        : await getSslScanConfig();

    const configOverride = options?.configOverride || {};
    const settings = { ...globalSettings, ...configOverride } as SslScanConfig;

    if (!enabled) {
      return JSON.stringify({
        success: false,
        error: 'SSL scanning is currently disabled',
        errorCode: 'TOOL_DISABLED',
      });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(args.url);
    } catch {
      return JSON.stringify({
        success: false,
        error: 'Invalid URL format. Please include https://',
        errorCode: 'INVALID_URL',
      });
    }

    const hostname = parsedUrl.hostname;

    // Rate limit check
    const { allowed, reason } = await checkRateLimit(hostname, settings);
    if (!allowed) {
      return JSON.stringify({
        success: false,
        error: reason,
        errorCode: 'RATE_LIMIT_EXCEEDED',
      });
    }

    // Cache check
    const cacheKey = hashQuery(`sslscan:${hostname}`);
    const cached = await getCachedQuery(`sslscan:${cacheKey}`);
    if (cached) {
      console.log('[SSLScan] Cache hit:', hostname);
      return cached;
    }

    // Run SSL Labs v4 scan with TLS direct fallback
    try {
      console.log('[SSLScan] Scanning:', hostname);
      let result: SslScanResult;
      if (!settings.email) {
        console.log('[SSLScan] No SSL Labs email configured — using direct TLS check');
        result = await tlsDirectCheck(args.url, hostname);
        console.log('[SSLScan] Direct TLS check complete:', hostname);
      } else {
        try {
          const rawData = await pollSslLabs(hostname, settings.maxWaitSeconds, settings.email);
          result = normalizeResult(args.url, rawData);
          console.log('[SSLScan] SSL Labs v4 success:', hostname);
        } catch (sslLabsErr) {
          console.log('[SSLScan] SSL Labs v4 failed, falling back to direct TLS check:', hostname, (sslLabsErr as Error).message);
          result = await tlsDirectCheck(args.url, hostname);
          console.log('[SSLScan] Direct TLS check complete:', hostname);
        }
      }

      const response = JSON.stringify({ success: true, data: result }, null, 2);
      await cacheQuery(`sslscan:${cacheKey}`, response, settings.cacheTTLSeconds);

      // Increment rate limit only after success
      await incrementRateLimit();

      return response;
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'SSL scan failed',
        errorCode: 'SCAN_ERROR',
      });
    }
  },
};

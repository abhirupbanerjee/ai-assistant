/**
 * Nuclei Scan Tool - ProjectDiscovery Nuclei Integration
 *
 * Runs template-based CVE and misconfiguration checks against a target URL
 * using the locally installed Nuclei binary. Zero external data transmission.
 *
 * Templates run by default:
 *   - http/misconfiguration  (exposed panels, insecure configs)
 *   - http/exposures         (sensitive file/data exposure)
 *   - ssl                    (SSL/TLS issues)
 *   - dns                    (DNS misconfigs)
 *
 * NOT a crawler — fires predefined checks only, does not discover app logic.
 *
 * Compliance annotations (lightweight):
 *   Each finding is tagged with relevant OWASP Top 10, PCI-DSS, and ISO 27001
 *   references based on the Nuclei template tags.
 */

import { spawn } from 'child_process';
import { getToolConfig } from '../db/compat/tool-config';
import { getEffectiveToolConfig } from '../db/compat/category-tool-config';
import { hashQuery, getCachedQuery, cacheQuery } from '../redis';
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';

// ============ Types ============

interface NucleiScanConfig {
  binaryPath: string;
  templateCategories: string[];
  severityFilter: string[];
  timeoutSeconds: number;
  cacheTTLSeconds: number;
  rateLimitPerDay: number;
  maxRatePerSecond: number;
}

interface NucleiFinding {
  templateId: string;
  name: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  description: string;
  url: string;
  matchedAt: string;
  reference?: string[];
  tags?: string[];
  complianceRefs?: string[];
}

interface NucleiScanResult {
  url: string;
  scannedAt: string;
  duration: string;
  templatesRun: string[];
  severityFilter: string[];
  findingsCount: number;
  findings: NucleiFinding[];
  bySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  summary: string;
  recommendations: string[];
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'clean';
}

// ============ Compliance Mapping ============

/**
 * Static mapping from Nuclei template tags to compliance framework references.
 * Tags are matched against finding.tags (partial match, lowercase).
 */
const COMPLIANCE_MAP: Record<string, string[]> = {
  ssl: ['OWASP A02:2021', 'PCI-DSS 4.2.1', 'ISO27001 A.8.24'],
  tls: ['OWASP A02:2021', 'PCI-DSS 4.2.1', 'ISO27001 A.8.24'],
  misconfig: ['OWASP A05:2021', 'PCI-DSS 2.2', 'ISO27001 A.8.9'],
  exposure: ['OWASP A05:2021', 'PCI-DSS 6.4.1', 'ISO27001 A.8.10'],
  cve: ['OWASP A06:2021', 'PCI-DSS 6.3.3', 'ISO27001 A.8.8'],
  dns: ['ISO27001 A.8.21'],
  rce: ['OWASP A03:2021', 'PCI-DSS 6.3.3', 'ISO27001 A.8.8'],
  sqli: ['OWASP A03:2021', 'PCI-DSS 6.2.4', 'ISO27001 A.8.8'],
  xss: ['OWASP A03:2021', 'PCI-DSS 6.2.4', 'ISO27001 A.8.8'],
  lfi: ['OWASP A01:2021', 'PCI-DSS 6.2.4', 'ISO27001 A.8.8'],
  rfi: ['OWASP A01:2021', 'PCI-DSS 6.2.4', 'ISO27001 A.8.8'],
  ssrf: ['OWASP A10:2021', 'PCI-DSS 6.2.4', 'ISO27001 A.8.8'],
  auth: ['OWASP A07:2021', 'PCI-DSS 8.2', 'ISO27001 A.5.17'],
  default: ['ISO27001 A.8.8'],
};

function getComplianceRefs(tags: string[]): string[] {
  const refs = new Set<string>();
  const lowerTags = tags.map(t => t.toLowerCase());

  for (const [key, controls] of Object.entries(COMPLIANCE_MAP)) {
    if (key === 'default') continue;
    if (lowerTags.some(tag => tag.includes(key))) {
      for (const c of controls) refs.add(c);
    }
  }

  // If no specific match, use generic reference
  if (refs.size === 0) {
    for (const c of COMPLIANCE_MAP.default) refs.add(c);
  }

  return Array.from(refs).sort();
}

// ============ Nuclei Runner ============

/**
 * Spawn Nuclei binary and collect JSONL output.
 * Nuclei outputs one JSON object per line for each finding.
 */
async function runNuclei(
  url: string,
  config: NucleiScanConfig
): Promise<NucleiFinding[]> {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      '-u', url,
      '-json',                                          // Output as JSON (one line per finding)
      '-silent',                                        // Suppress banner/progress noise
      '-no-color',                                      // Clean output for parsing
      '-timeout', String(config.timeoutSeconds),        // Per-request timeout
      '-rate-limit', String(config.maxRatePerSecond),   // Max requests/sec
    ];

    // Add template categories (e.g., -t http/misconfiguration -t ssl)
    for (const category of config.templateCategories) {
      args.push('-t', category);
    }

    // Add severity filter (e.g., -severity high,critical)
    if (config.severityFilter.length > 0) {
      args.push('-severity', config.severityFilter.join(','));
    }

    const findings: NucleiFinding[] = [];
    let stderr = '';
    const binaryPath = config.binaryPath || '/usr/local/bin/nuclei';

    const child = spawn(binaryPath, args, {
      timeout: (config.timeoutSeconds + 60) * 1000,   // Process timeout = scan timeout + 60s buffer
      env: {
        ...process.env,
        // Templates are bind-mounted at this path on the VM host
        HOME: '/home/azureuser',
        // Redirect Nuclei config/cache writes to writable tmp dirs
        // (container runs as nextjs user — /home/nextjs does not exist)
        XDG_CONFIG_HOME: '/tmp/nuclei-config',
        XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || '/tmp/cache',
      },
    });

    child.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          // Nuclei JSONL: each finding has template-id, info, matched-at
          if (parsed['template-id'] && parsed['matched-at']) {
            const tags: string[] = parsed.info?.tags || [];
            findings.push({
              templateId: parsed['template-id'],
              name: parsed.info?.name || parsed['template-id'],
              severity: (parsed.info?.severity || 'info') as NucleiFinding['severity'],
              description: parsed.info?.description || '',
              url: parsed['matched-at'],
              matchedAt: parsed['matched-at'],
              reference: parsed.info?.reference || [],
              tags,
              complianceRefs: getComplianceRefs(tags),
            });
          }
        } catch {
          // Non-JSON lines (stats, progress) — ignore silently
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      // Nuclei exits 0 even when findings present.
      // Exit code > 1 = fatal error (binary not found, bad args, etc.)
      if (code !== null && code > 1) {
        reject(new Error(`Nuclei exited with code ${code}: ${stderr.substring(0, 500)}`));
      } else {
        resolve(findings);
      }
    });

    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(
          `Nuclei binary not found at ${binaryPath}. Install: https://github.com/projectdiscovery/nuclei/releases`
        ));
      } else {
        reject(err);
      }
    });
  });
}

// ============ Result Formatting ============

function formatResults(
  url: string,
  findings: NucleiFinding[],
  config: NucleiScanConfig,
  durationMs: number
): NucleiScanResult {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  }

  // Determine overall risk level
  let riskLevel: NucleiScanResult['riskLevel'] = 'clean';
  if (bySeverity.critical > 0) riskLevel = 'critical';
  else if (bySeverity.high > 0) riskLevel = 'high';
  else if (bySeverity.medium > 0) riskLevel = 'medium';
  else if (bySeverity.low > 0) riskLevel = 'low';

  // Generate recommendations
  const recommendations: string[] = [];
  if (bySeverity.critical > 0) {
    recommendations.push(
      `🔴 ${bySeverity.critical} critical finding(s) — patch immediately before this system handles live data.`
    );
  }
  if (bySeverity.high > 0) {
    recommendations.push(
      `🟠 ${bySeverity.high} high severity finding(s) — schedule remediation within 7 days.`
    );
  }
  if (bySeverity.medium > 0) {
    recommendations.push(
      `🟡 ${bySeverity.medium} medium severity finding(s) — include in next sprint.`
    );
  }
  if (findings.length === 0) {
    recommendations.push(
      '✅ No known CVEs or misconfigurations detected across scanned templates. Continue regular scanning.'
    );
  }

  const duration = durationMs < 60000
    ? `${(durationMs / 1000).toFixed(1)}s`
    : `${(durationMs / 60000).toFixed(1)}m`;

  const summary = [
    `Nuclei scan of ${url} completed in ${duration}.`,
    `Ran ${config.templateCategories.length} template categor${config.templateCategories.length === 1 ? 'y' : 'ies'}`,
    `with severity filter [${config.severityFilter.join(', ')}].`,
    findings.length === 0
      ? 'No findings detected.'
      : `Found ${findings.length} issue(s): ${bySeverity.critical} critical, ${bySeverity.high} high, ${bySeverity.medium} medium, ${bySeverity.low} low, ${bySeverity.info} info.`,
  ].join(' ');

  return {
    url,
    scannedAt: new Date().toISOString(),
    duration,
    templatesRun: config.templateCategories,
    severityFilter: config.severityFilter,
    findingsCount: findings.length,
    findings,
    bySeverity,
    summary,
    recommendations,
    riskLevel,
  };
}

// ============ Rate Limiting ============

async function checkRateLimit(
  config: NucleiScanConfig
): Promise<{ allowed: boolean; reason?: string }> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `nucleiscan:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  const dailyUsage = dailyCount ? parseInt(dailyCount) : 0;

  if (dailyUsage >= config.rateLimitPerDay) {
    return {
      allowed: false,
      reason: `Daily scan limit reached (${config.rateLimitPerDay} scans/day). Nuclei runs on the server — limits protect VM resources.`,
    };
  }

  return { allowed: true };
}

async function incrementRateLimit(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const dailyKey = `nucleiscan:rate:daily:${today}`;
  const dailyCount = await getCachedQuery(dailyKey);
  await cacheQuery(dailyKey, String((dailyCount ? parseInt(dailyCount) : 0) + 1), 86400);
}

// ============ Config Helpers ============

async function getNucleiScanConfig(categoryId?: number): Promise<{
  enabled: boolean;
  config: NucleiScanConfig;
}> {
  if (categoryId) {
    const effective = await getEffectiveToolConfig('nuclei_scan', categoryId);
    return {
      enabled: effective.enabled,
      config: (effective.config as unknown as NucleiScanConfig) || defaultConfig,
    };
  }

  const toolConfig = await getToolConfig('nuclei_scan');
  if (toolConfig) {
    return {
      enabled: toolConfig.isEnabled,
      config: toolConfig.config as unknown as NucleiScanConfig,
    };
  }

  return { enabled: false, config: defaultConfig };
}

// ============ Config Schema & Defaults ============

const defaultConfig: NucleiScanConfig = {
  binaryPath: '/usr/local/bin/nuclei',
  templateCategories: [
    'http/misconfiguration',
    'http/exposures',
    'ssl',
    'dns',
  ],
  severityFilter: ['medium', 'high', 'critical'],
  timeoutSeconds: 30,
  cacheTTLSeconds: 21600,   // 6 hours
  rateLimitPerDay: 10,
  maxRatePerSecond: 10,
};

const configSchema = {
  type: 'object',
  properties: {
    binaryPath: {
      type: 'string',
      title: 'Nuclei Binary Path',
      description: 'Full path to nuclei binary on the server',
      default: '/usr/local/bin/nuclei',
    },
    templateCategories: {
      type: 'array',
      title: 'Template Categories',
      description: 'Nuclei template categories to run',
      default: ['http/misconfiguration', 'http/exposures', 'ssl', 'dns'],
    },
    severityFilter: {
      type: 'array',
      title: 'Severity Filter',
      description: 'Only report findings at or above these severities',
      default: ['medium', 'high', 'critical'],
    },
    timeoutSeconds: {
      type: 'number',
      title: 'Per-Request Timeout (seconds)',
      minimum: 10,
      maximum: 120,
      default: 30,
    },
    cacheTTLSeconds: {
      type: 'number',
      title: 'Cache Duration (seconds)',
      minimum: 3600,
      maximum: 86400,
      default: 21600,
    },
    rateLimitPerDay: {
      type: 'number',
      title: 'Daily Scan Limit',
      minimum: 1,
      maximum: 50,
      default: 10,
    },
    maxRatePerSecond: {
      type: 'number',
      title: 'Max Requests/Second',
      minimum: 1,
      maximum: 150,
      default: 10,
    },
  },
};

function validateConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (config.timeoutSeconds !== undefined) {
    const t = config.timeoutSeconds as number;
    if (typeof t !== 'number' || t < 10 || t > 120) {
      errors.push('timeoutSeconds must be between 10 and 120');
    }
  }
  if (config.rateLimitPerDay !== undefined) {
    const r = config.rateLimitPerDay as number;
    if (typeof r !== 'number' || r < 1 || r > 50) {
      errors.push('rateLimitPerDay must be between 1 and 50');
    }
  }
  if (config.maxRatePerSecond !== undefined) {
    const r = config.maxRatePerSecond as number;
    if (typeof r !== 'number' || r < 1 || r > 150) {
      errors.push('maxRatePerSecond must be between 1 and 150');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============ Tool Definition ============

export const nucleiScanTool: ToolDefinition = {
  name: 'nuclei_scan',
  displayName: 'Nuclei Scan',
  description: 'Template-based CVE and misconfiguration scanning using locally installed Nuclei (zero data transmission)',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'nuclei_scan',
      description:
        'Scan a URL for known CVEs, misconfigurations, exposed panels, SSL issues, and DNS problems using Nuclei templates. Each finding is annotated with OWASP Top 10, PCI-DSS, and ISO 27001 references. Use when users ask about vulnerability scanning, CVE checks, misconfiguration audits, or security hardening. NOTE: Nuclei checks known conditions — it does not crawl or test custom application logic.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Full URL to scan (must include https:// or http://)',
          },
          include_info: {
            type: 'boolean',
            description: 'Include informational findings (tech fingerprinting). Defaults to false to reduce noise.',
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
    args: { url: string; include_info?: boolean },
    options?: ToolExecutionOptions
  ): Promise<string> => {
    const categoryIds = (options as { categoryIds?: number[] })?.categoryIds || [];
    const { enabled, config: globalSettings } =
      categoryIds.length > 0
        ? await getNucleiScanConfig(categoryIds[0])
        : await getNucleiScanConfig();

    const configOverride = options?.configOverride || {};
    const settings: NucleiScanConfig = { ...globalSettings, ...configOverride };

    if (!enabled) {
      return JSON.stringify({
        success: false,
        error: 'Nuclei scanning is currently disabled',
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
        error: 'Invalid URL format. Include protocol: https://example.com',
        errorCode: 'INVALID_URL',
      });
    }

    // Only allow http/https — reject file://, ftp://, etc.
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return JSON.stringify({
        success: false,
        error: 'Only http/https URLs are allowed',
        errorCode: 'INVALID_URL',
      });
    }

    const targetUrl = parsedUrl.toString();

    // Rate limit check (Nuclei runs on VM — protect resources)
    const rateCheck = await checkRateLimit(settings);
    if (!rateCheck.allowed) {
      return JSON.stringify({
        success: false,
        error: rateCheck.reason,
        errorCode: 'RATE_LIMIT_EXCEEDED',
      });
    }

    // Check cache
    const includeInfo = args.include_info === true;
    const cacheKey = hashQuery(`nuclei:${targetUrl}:${settings.templateCategories.join(',')}:${includeInfo}`);
    const cached = await getCachedQuery(`nuclei:${cacheKey}`);
    if (cached) {
      console.log('[Nuclei] Cache hit:', targetUrl);
      return cached;
    }

    // Extend severity filter if info requested
    const effectiveSettings = { ...settings };
    if (includeInfo && !effectiveSettings.severityFilter.includes('info')) {
      effectiveSettings.severityFilter = [...effectiveSettings.severityFilter, 'info'];
    }

    // Run Nuclei
    console.log('[Nuclei] Starting scan:', targetUrl);
    const startTime = Date.now();

    let findings: NucleiFinding[];
    try {
      findings = await runNuclei(targetUrl, effectiveSettings);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Nuclei] Scan failed:', message);
      return JSON.stringify({
        success: false,
        error: message,
        errorCode: 'SCAN_FAILED',
        hint: message.includes('ENOENT')
          ? 'Nuclei binary not installed or wrong path in admin config. Install: https://github.com/projectdiscovery/nuclei/releases'
          : 'Check server logs for details.',
      });
    }

    const durationMs = Date.now() - startTime;
    await incrementRateLimit();

    const result = formatResults(targetUrl, findings, effectiveSettings, durationMs);
    const response = JSON.stringify({ success: true, data: result });

    // Cache result (6 hours — scans are expensive)
    await cacheQuery(`nuclei:${cacheKey}`, response, settings.cacheTTLSeconds);

    return response;
  },
};

/**
 * Code Analysis Tool - SonarCloud Integration
 *
 * Provides code quality analysis including bugs, vulnerabilities, code smells,
 * coverage, and technical debt using SonarCloud API.
 *
 * Supports multi-level configuration:
 * 1. Skill tool_config_override - Per-skill overrides
 * 2. Category category_tool_configs - Per-category tokens/repos
 * 3. Global tool_configs - Default admin configuration
 * 4. Environment variables - Fallback
 */

import { getToolConfig } from '../db/compat/tool-config';
import { getEffectiveToolConfig } from '../db/compat/category-tool-config';
import { hashQuery, getCachedQuery, cacheQuery } from '../redis';
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';

// ============ Types ============

export interface PreConfiguredRepo {
  name: string;
  projectKey: string;
  githubUrl?: string;
  apiToken?: string;      // Per-repo token override
  organization?: string;  // Per-repo org override
}

export interface CodeAnalysisConfig {
  apiToken: string;
  organization: string;
  enableDynamicLookup: boolean;
  preConfiguredRepos: PreConfiguredRepo[];
  cacheTTLSeconds: number;
  maxIssuesPerCategory: number;
}

export interface SonarMetric {
  metric: string;
  value: string;
  bestValue?: boolean;
}

export interface SonarIssue {
  key: string;
  rule: string;
  severity: 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MINOR' | 'INFO';
  component: string;
  line?: number;
  message: string;
  type: 'BUG' | 'VULNERABILITY' | 'CODE_SMELL' | 'SECURITY_HOTSPOT';
  status: string;
  creationDate: string;
}

export interface AnalysisSummary {
  bugs: number;
  vulnerabilities: number;
  securityHotspots: number;
  codeSmells: number;
  coverage: number;
  duplication: number;
  linesOfCode: number;
  technicalDebtMinutes: number;
}

export interface AnalysisRatings {
  reliability: string;
  security: string;
  maintainability: string;
}

export interface CategorizedIssues {
  critical: SonarIssue[];
  high: SonarIssue[];
  medium: SonarIssue[];
  low: SonarIssue[];
}

export interface NormalizedAnalysis {
  repository: {
    projectKey: string;
    displayName: string;
    lastAnalysisDate: string;
    resolvedFrom: 'preconfigured' | 'dynamic' | 'direct_key';
  };
  summary: AnalysisSummary;
  ratings: AnalysisRatings;
  issues: CategorizedIssues;
  recommendations: string[];
}

interface RepoResolution {
  source: 'preconfigured' | 'dynamic' | 'direct_key';
  projectKey: string;
  displayName: string;
  apiToken?: string;
  organization?: string;
}

// ============ SonarCloud Client ============

const SONARCLOUD_API_URL = 'https://sonarcloud.io/api';

/**
 * Make authenticated request to SonarCloud API
 */
async function sonarRequest<T>(
  endpoint: string,
  params: Record<string, string>,
  token: string
): Promise<T> {
  const url = new URL(`${SONARCLOUD_API_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 401) {
    throw new Error('Authentication failed. Check your SonarCloud token.');
  }

  if (response.status === 404) {
    throw new Error('Resource not found. Check project key and organization.');
  }

  if (response.status === 429) {
    throw new Error('Rate limit exceeded. Please try again later.');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      (errorData as { message?: string }).message || `SonarCloud API error: ${response.status}`
    );
  }

  return response.json();
}

/**
 * Get project information from SonarCloud
 */
async function getProject(
  projectKey: string,
  organization: string,
  token: string
): Promise<{ key: string; name: string; lastAnalysisDate?: string }> {
  interface ProjectsResponse {
    components: Array<{ key: string; name: string; lastAnalysisDate?: string }>;
  }

  const response = await sonarRequest<ProjectsResponse>(
    '/projects/search',
    { projects: projectKey, organization },
    token
  );

  if (!response.components || response.components.length === 0) {
    throw new Error(`Project not found: ${projectKey}`);
  }

  return response.components[0];
}

/**
 * Get metrics for a project
 */
async function getMetrics(
  projectKey: string,
  metricKeys: string[],
  token: string
): Promise<SonarMetric[]> {
  interface MeasuresResponse {
    component: {
      measures: SonarMetric[];
    };
  }

  const response = await sonarRequest<MeasuresResponse>(
    '/measures/component',
    { component: projectKey, metricKeys: metricKeys.join(',') },
    token
  );

  return response.component?.measures || [];
}

/**
 * Get issues for a project
 */
async function getIssues(
  projectKey: string,
  token: string,
  maxPerCategory: number
): Promise<SonarIssue[]> {
  interface IssuesResponse {
    issues: SonarIssue[];
  }

  const response = await sonarRequest<IssuesResponse>(
    '/issues/search',
    { componentKeys: projectKey, ps: '500' },
    token
  );

  return response.issues || [];
}

/**
 * Search for projects in SonarCloud organization
 */
async function searchProjects(
  organization: string,
  query: string,
  token: string
): Promise<Array<{ key: string; name: string }>> {
  interface SearchResponse {
    components: Array<{ key: string; name: string }>;
  }

  try {
    const response = await sonarRequest<SearchResponse>(
      '/projects/search',
      { organization, q: query, ps: '10' },
      token
    );
    return response.components || [];
  } catch {
    return [];
  }
}

// ============ Data Normalizers ============

function normalizeMetrics(metrics: SonarMetric[]): AnalysisSummary {
  const getMetricValue = (key: string): number => {
    const metric = metrics.find(m => m.metric === key);
    return metric ? parseFloat(metric.value) || 0 : 0;
  };

  return {
    bugs: getMetricValue('bugs'),
    vulnerabilities: getMetricValue('vulnerabilities'),
    securityHotspots: getMetricValue('security_hotspots'),
    codeSmells: getMetricValue('code_smells'),
    coverage: getMetricValue('coverage'),
    duplication: getMetricValue('duplicated_lines_density'),
    linesOfCode: getMetricValue('ncloc'),
    technicalDebtMinutes: getMetricValue('sqale_index'),
  };
}

function ratingToLabel(rating: string): string {
  const ratingMap: Record<string, string> = {
    '1': 'A', '1.0': 'A',
    '2': 'B', '2.0': 'B',
    '3': 'C', '3.0': 'C',
    '4': 'D', '4.0': 'D',
    '5': 'E', '5.0': 'E',
  };
  return ratingMap[rating] || rating;
}

function normalizeRatings(metrics: SonarMetric[]): AnalysisRatings {
  const getRating = (key: string): string => {
    const metric = metrics.find(m => m.metric === key);
    return metric ? ratingToLabel(metric.value) : 'N/A';
  };

  return {
    reliability: getRating('reliability_rating'),
    security: getRating('security_rating'),
    maintainability: getRating('sqale_rating'),
  };
}

function categorizeIssues(issues: SonarIssue[], maxPerCategory: number): CategorizedIssues {
  const categorized: CategorizedIssues = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };

  issues.forEach(issue => {
    if (issue.severity === 'BLOCKER' || issue.severity === 'CRITICAL') {
      categorized.critical.push(issue);
    } else if (issue.severity === 'MAJOR') {
      categorized.high.push(issue);
    } else if (issue.severity === 'MINOR') {
      categorized.medium.push(issue);
    } else {
      categorized.low.push(issue);
    }
  });

  // Truncate each category to maxPerCategory
  return {
    critical: categorized.critical.slice(0, maxPerCategory),
    high: categorized.high.slice(0, maxPerCategory),
    medium: categorized.medium.slice(0, maxPerCategory),
    low: categorized.low.slice(0, maxPerCategory),
  };
}

function generateRecommendations(
  summary: AnalysisSummary,
  issues: CategorizedIssues
): string[] {
  const recommendations: string[] = [];

  if (summary.coverage < 80) {
    recommendations.push(
      `Code coverage is ${summary.coverage.toFixed(1)}%. Consider increasing test coverage to at least 80%.`
    );
  }

  if (summary.bugs > 0) {
    recommendations.push(
      `Found ${summary.bugs} bug${summary.bugs > 1 ? 's' : ''}. Prioritize fixing bugs to improve reliability.`
    );
  }

  if (summary.vulnerabilities > 0) {
    recommendations.push(
      `Found ${summary.vulnerabilities} security ${summary.vulnerabilities > 1 ? 'vulnerabilities' : 'vulnerability'}. Address immediately.`
    );
  }

  if (summary.securityHotspots > 0) {
    recommendations.push(
      `Review ${summary.securityHotspots} security hotspot${summary.securityHotspots > 1 ? 's' : ''} for potential vulnerabilities.`
    );
  }

  if (summary.codeSmells > 50) {
    recommendations.push(
      `High number of code smells (${summary.codeSmells}). Consider refactoring to improve maintainability.`
    );
  }

  if (summary.duplication > 5) {
    recommendations.push(
      `Code duplication is ${summary.duplication.toFixed(1)}%. Look for opportunities to reduce duplication.`
    );
  }

  const debtHours = summary.technicalDebtMinutes / 60;
  if (debtHours > 40) {
    recommendations.push(
      `Technical debt is approximately ${Math.round(debtHours)} hours. Plan refactoring efforts to reduce debt.`
    );
  }

  if (issues.critical.length > 0) {
    recommendations.push(
      `Address ${issues.critical.length} critical issue${issues.critical.length > 1 ? 's' : ''} as highest priority.`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      'Code quality metrics look good! Continue maintaining current standards.'
    );
  }

  return recommendations;
}

// ============ Repository Resolution ============

/**
 * Resolve repository identifier to SonarCloud project key
 * Supports: pre-configured repo name, GitHub URL, or direct project key
 */
async function resolveRepository(
  identifier: string,
  config: CodeAnalysisConfig,
  defaultToken: string,
  defaultOrg: string
): Promise<RepoResolution | null> {
  const normalizedId = identifier.toLowerCase().trim();

  // 1. Check pre-configured repos first (by name, GitHub URL, or project key)
  for (const repo of config.preConfiguredRepos || []) {
    const nameMatch = repo.name.toLowerCase() === normalizedId;
    const keyMatch = repo.projectKey.toLowerCase() === normalizedId;
    const urlMatch = repo.githubUrl?.toLowerCase().replace(/\/$/, '') === normalizedId.replace(/\/$/, '');

    if (nameMatch || keyMatch || urlMatch) {
      return {
        source: 'preconfigured',
        projectKey: repo.projectKey,
        displayName: repo.name,
        apiToken: repo.apiToken,      // Per-repo token override
        organization: repo.organization, // Per-repo org override
      };
    }
  }

  // 2. If looks like a direct project key (contains underscore, no slashes/dots)
  if (identifier.includes('_') && !identifier.includes('/') && !identifier.includes('.')) {
    return {
      source: 'direct_key',
      projectKey: identifier,
      displayName: identifier,
    };
  }

  // 3. If dynamic lookup is enabled, try to find by GitHub URL
  if (config.enableDynamicLookup) {
    const githubMatch = identifier.match(
      /(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)/i
    );

    if (githubMatch) {
      const [, org, repo] = githubMatch;
      const cleanRepo = repo.replace(/\.git$/, '');

      // Common SonarCloud project key formats
      const possibleKeys = [
        `${org}_${cleanRepo}`,
        `${org.toLowerCase()}_${cleanRepo.toLowerCase()}`,
        cleanRepo.toLowerCase(),
      ];

      // Search for the project
      const token = defaultToken;
      const organization = defaultOrg;

      if (token && organization) {
        for (const key of possibleKeys) {
          const results = await searchProjects(organization, key, token);
          const found = results.find(p =>
            p.key.toLowerCase() === key.toLowerCase() ||
            p.key.toLowerCase().includes(cleanRepo.toLowerCase())
          );

          if (found) {
            return {
              source: 'dynamic',
              projectKey: found.key,
              displayName: found.name || identifier,
            };
          }
        }
      }
    }
  }

  return null;
}

// ============ Config Helpers ============

/**
 * Get code analysis configuration with category-level override support
 */
export async function getCodeAnalysisConfig(categoryId?: number): Promise<{
  enabled: boolean;
  config: CodeAnalysisConfig;
}> {
  // If category provided, get effective config (global + category merged)
  if (categoryId) {
    const effective = await getEffectiveToolConfig('code_analysis', categoryId);
    return {
      enabled: effective.enabled,
      config: (effective.config as unknown as CodeAnalysisConfig) || defaultConfig,
    };
  }

  // Otherwise get global config
  const toolConfig = await getToolConfig('code_analysis');
  if (toolConfig) {
    return {
      enabled: toolConfig.isEnabled,
      config: toolConfig.config as unknown as CodeAnalysisConfig,
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
    apiToken: {
      type: 'string',
      title: 'SonarCloud API Token',
      description: 'API token for SonarCloud. Generate from https://sonarcloud.io/account/security',
      format: 'password',
    },
    organization: {
      type: 'string',
      title: 'SonarCloud Organization',
      description: 'Your SonarCloud organization key (e.g., "my-org")',
    },
    enableDynamicLookup: {
      type: 'boolean',
      title: 'Enable Dynamic Lookup',
      description: 'Allow looking up any project in your organization by GitHub URL (not just pre-configured ones)',
      default: true,
    },
    preConfiguredRepos: {
      type: 'array',
      title: 'Pre-configured Repositories',
      description: 'Repositories with friendly names for quick access. Each can have its own token/org override.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Display Name' },
          projectKey: { type: 'string', title: 'SonarCloud Project Key' },
          githubUrl: { type: 'string', title: 'GitHub URL (optional)' },
          apiToken: { type: 'string', title: 'API Token Override (optional)', format: 'password' },
          organization: { type: 'string', title: 'Organization Override (optional)' },
        },
        required: ['name', 'projectKey'],
      },
      default: [],
    },
    cacheTTLSeconds: {
      type: 'number',
      title: 'Cache Duration (seconds)',
      description: 'How long to cache analysis results',
      minimum: 60,
      maximum: 86400,
      default: 1800,
    },
    maxIssuesPerCategory: {
      type: 'number',
      title: 'Max Issues Per Category',
      description: 'Maximum issues to return per severity category (to avoid overwhelming results)',
      minimum: 5,
      maximum: 100,
      default: 25,
    },
  },
  required: ['organization'],
};

const defaultConfig: CodeAnalysisConfig = {
  apiToken: '',
  organization: '',
  enableDynamicLookup: true,
  preConfiguredRepos: [],
  cacheTTLSeconds: 1800,
  maxIssuesPerCategory: 25,
};

/**
 * Validate code analysis configuration
 */
function validateConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // Validate cacheTTLSeconds
  if (config.cacheTTLSeconds !== undefined) {
    const cacheTTL = config.cacheTTLSeconds as number;
    if (typeof cacheTTL !== 'number' || cacheTTL < 60 || cacheTTL > 86400) {
      errors.push('cacheTTLSeconds must be a number between 60 and 86400');
    }
  }

  // Validate maxIssuesPerCategory
  if (config.maxIssuesPerCategory !== undefined) {
    const maxIssues = config.maxIssuesPerCategory as number;
    if (typeof maxIssues !== 'number' || maxIssues < 5 || maxIssues > 100) {
      errors.push('maxIssuesPerCategory must be a number between 5 and 100');
    }
  }

  // Validate preConfiguredRepos
  if (config.preConfiguredRepos && !Array.isArray(config.preConfiguredRepos)) {
    errors.push('preConfiguredRepos must be an array');
  }

  return { valid: errors.length === 0, errors };
}

// ============ Tool Definition ============

export const codeAnalysisTool: ToolDefinition = {
  name: 'code_analysis',
  displayName: 'Code Analysis',
  description: 'Analyze code quality, security vulnerabilities, bugs, and technical debt using SonarCloud.',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'code_analysis',
      description: 'Analyze a code repository using SonarCloud for code quality, security vulnerabilities, bugs, code smells, and technical debt. Supports pre-configured repositories, GitHub URLs, or SonarCloud project keys. Use when users ask about code quality, security issues, technical debt, or want a code review of a specific repository.',
      parameters: {
        type: 'object',
        properties: {
          identifier: {
            type: 'string',
            description: 'Repository identifier: a GitHub URL (e.g., https://github.com/org/repo), a SonarCloud project key (e.g., org_repo), or a pre-configured repository name.',
          },
          include_issues: {
            type: 'boolean',
            description: 'Whether to include detailed issue list in the analysis. Defaults to true.',
          },
        },
        required: ['identifier'],
      },
    },
  },

  validateConfig,
  defaultConfig: defaultConfig as unknown as Record<string, unknown>,
  configSchema,

  execute: async (
    args: {
      identifier: string;
      include_issues?: boolean;
    },
    options?: ToolExecutionOptions
  ): Promise<string> => {
    // Get config - check for category-level override
    const categoryIds = (options as { categoryIds?: number[] })?.categoryIds || [];
    const { enabled, config: globalSettings } = categoryIds.length > 0
      ? await getCodeAnalysisConfig(categoryIds[0])
      : await getCodeAnalysisConfig();

    // Merge skill-level config override
    const configOverride = options?.configOverride || {};
    const settings = { ...globalSettings, ...configOverride } as CodeAnalysisConfig;

    // Merge pre-configured repos from both global and override
    if (configOverride.preConfiguredRepos && Array.isArray(configOverride.preConfiguredRepos)) {
      settings.preConfiguredRepos = [
        ...(globalSettings.preConfiguredRepos || []),
        ...(configOverride.preConfiguredRepos as PreConfiguredRepo[]),
      ];
    }

    // Check if tool is enabled
    if (!enabled) {
      return JSON.stringify({
        success: false,
        error: 'Code analysis is currently disabled',
        errorCode: 'TOOL_DISABLED',
      });
    }

    // Get default token and org (config > env var)
    const defaultToken = settings.apiToken || process.env.SONARCLOUD_TOKEN || '';
    const defaultOrg = settings.organization || process.env.SONARCLOUD_ORGANIZATION || '';

    if (!defaultToken || !defaultOrg) {
      return JSON.stringify({
        success: false,
        error: 'SonarCloud not configured. Please set API token and organization in admin settings.',
        errorCode: 'NOT_CONFIGURED',
      });
    }

    // Resolve the repository identifier
    const resolution = await resolveRepository(
      args.identifier,
      settings,
      defaultToken,
      defaultOrg
    );

    if (!resolution) {
      return JSON.stringify({
        success: false,
        error: `Could not find repository: ${args.identifier}`,
        errorCode: 'REPO_NOT_FOUND',
        suggestion: settings.enableDynamicLookup
          ? 'Try using the exact SonarCloud project key or a full GitHub URL.'
          : 'Enable dynamic lookup in admin settings or add this repository to pre-configured list.',
      });
    }

    // Use repo-specific token/org if available, otherwise use defaults
    const token = resolution.apiToken || defaultToken;
    const organization = resolution.organization || defaultOrg;

    // Check cache
    const includeIssues = args.include_issues !== false;
    const cacheKey = hashQuery(`sonarcloud:${resolution.projectKey}:${includeIssues}`);
    const cached = await getCachedQuery(`sonarcloud:${cacheKey}`);
    if (cached) {
      console.log('[SonarCloud] Cache hit:', resolution.projectKey);
      return cached;
    }

    // Fetch analysis from SonarCloud
    console.log('[SonarCloud] Cache miss - fetching analysis:', resolution.projectKey);
    try {
      // Define metrics to fetch
      const metricKeys = [
        'bugs',
        'vulnerabilities',
        'security_hotspots',
        'code_smells',
        'coverage',
        'duplicated_lines_density',
        'ncloc',
        'sqale_index',
        'reliability_rating',
        'security_rating',
        'sqale_rating',
      ];

      // Fetch all data in parallel
      const [project, metrics, issues] = await Promise.all([
        getProject(resolution.projectKey, organization, token),
        getMetrics(resolution.projectKey, metricKeys, token),
        includeIssues
          ? getIssues(resolution.projectKey, token, settings.maxIssuesPerCategory)
          : Promise.resolve([]),
      ]);

      // Normalize data
      const summary = normalizeMetrics(metrics);
      const ratings = normalizeRatings(metrics);
      const categorizedIssues = categorizeIssues(issues, settings.maxIssuesPerCategory);
      const recommendations = generateRecommendations(summary, categorizedIssues);

      const analysis: NormalizedAnalysis = {
        repository: {
          projectKey: resolution.projectKey,
          displayName: resolution.displayName,
          lastAnalysisDate: project.lastAnalysisDate || 'N/A',
          resolvedFrom: resolution.source,
        },
        summary,
        ratings,
        issues: categorizedIssues,
        recommendations,
      };

      const response = {
        success: true,
        data: analysis,
      };

      const resultString = JSON.stringify(response, null, 2);

      // Cache the result
      await cacheQuery(`sonarcloud:${cacheKey}`, resultString, settings.cacheTTLSeconds);

      return resultString;
    } catch (error) {
      console.error('[SonarCloud] API error:', error);
      return JSON.stringify({
        success: false,
        error: 'Code analysis failed',
        errorCode: 'API_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
};

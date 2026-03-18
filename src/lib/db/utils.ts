/**
 * Pure utility functions and constants extracted from old sync DB modules.
 *
 * This file has NO imports from ./index (SQLite) — safe to use in Postgres-only mode.
 * Compat modules import utilities from here instead of the old sync files.
 */

import { randomBytes } from 'crypto';
import crypto from 'crypto';
import { getDefaultPresetId, getDefaultLLMModel, getModelPresetsFromConfig } from '../config-loader';

// ============================================================================
// Slug generators
// ============================================================================

/** Generate a URL-friendly slug from a name (agent bots) */
export function generateSlugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

/** Generate a URL-friendly slug from a name (categories) */
export function generateCategorySlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Generate a random 16-character slug for workspace URLs */
export function generateWorkspaceSlug(): string {
  const bytes = randomBytes(24);
  const slug = bytes
    .toString('base64')
    .replace(/[+/=]/g, '')
    .toLowerCase()
    .slice(0, 16);

  if (slug.length < 16) {
    return generateWorkspaceSlug();
  }

  return slug;
}

// ============================================================================
// LLM Provider utilities
// ============================================================================

export interface LLMProviderDefaults {
  id: string;
  name: string;
  apiKey: string | null;
  apiBase: string | null;
  enabled: boolean;
}

export const DEFAULT_PROVIDERS: LLMProviderDefaults[] = [
  { id: 'openai', name: 'OpenAI', apiKey: null, apiBase: null, enabled: true },
  { id: 'gemini', name: 'Google Gemini', apiKey: null, apiBase: null, enabled: true },
  { id: 'mistral', name: 'Mistral AI', apiKey: null, apiBase: null, enabled: true },
  { id: 'ollama', name: 'Ollama (Local)', apiKey: null, apiBase: null, enabled: true },
  { id: 'anthropic', name: 'Anthropic (Claude)', apiKey: null, apiBase: null, enabled: true },
  { id: 'deepseek', name: 'DeepSeek', apiKey: null, apiBase: null, enabled: true },
  { id: 'fireworks', name: 'Fireworks AI', apiKey: null, apiBase: null, enabled: true },
];

export function maskApiKey(apiKey: string | null): string {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return '••••••••';
  return '••••••••' + apiKey.slice(-4);
}

// ============================================================================
// Tool config defaults
// ============================================================================

export const TOOL_DEFAULTS: Record<string, { enabled: boolean; config: Record<string, unknown> }> = {
  web_search: {
    enabled: false,
    config: {
      apiKey: '',
      defaultTopic: 'general',
      defaultSearchDepth: 'advanced',
      maxResults: 10,
      includeDomains: [],
      excludeDomains: [],
      cacheTTLSeconds: 3600,
      includeAnswer: 'basic',
    },
  },
  data_viz: {
    enabled: true,
    config: {
      defaultChartType: 'bar',
      defaultColors: ['#3b82f6', '#ef4444', '#10b981', '#f59320', '#06b6d5'],
      enabledChartTypes: ['bar', 'line', 'pie', 'area'],
      showLegend: true,
      showTooltip: true,
      maxDataPoints: 1000,
    },
  },
  doc_gen: {
    enabled: true,
    config: {
      defaultFormat: 'pdf',
      enabledFormats: ['pdf', 'docx', 'md'],
      branding: {
        enabled: false,
        logoUrl: '',
        organizationName: '',
        primaryColor: '#003366',
        fontFamily: 'Calibri',
      },
      header: { enabled: true, content: '' },
      footer: { enabled: true, content: '', includePageNumber: true },
      expirationDays: 30,
      maxDocumentSizeMB: 50,
    },
  },
  data_source: {
    enabled: true,
    config: {
      cacheTTLSeconds: 3600,
      timeout: 30,
      defaultLimit: 100,
      maxLimit: 1000,
      defaultChartType: 'bar',
      enabledChartTypes: ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'],
    },
  },
  function_api: {
    enabled: true,
    config: {
      globalEnabled: true,
    },
  },
  youtube: {
    enabled: false,
    config: {
      apiKey: '',
      preferredLanguage: 'en',
      fallbackEnabled: true,
    },
  },
  chart_gen: {
    enabled: true,
    config: {
      maxDataRows: 500,
      defaultChartType: 'bar',
      enabledChartTypes: ['bar', 'line', 'pie', 'area', 'scatter', 'radar', 'table'],
    },
  },
  image_gen: {
    enabled: false,
    config: {
      activeProvider: 'gemini',
      providers: {
        openai: {
          enabled: true,
          model: 'dall-e-3',
          size: '1024x1024',
          quality: 'standard',
          style: 'natural',
        },
        gemini: {
          enabled: true,
          model: 'gemini-3-pro-image-preview',
          aspectRatio: '16:9',
        },
      },
      defaultStyle: 'infographic',
      infographicProvider: 'gemini',
      enhancePrompts: true,
      addSafetyPrefixes: true,
      imageProcessing: {
        maxDimension: 2048,
        format: 'webp',
        quality: 85,
        generateThumbnail: true,
        thumbnailSize: 400,
      },
    },
  },
  translation: {
    enabled: false,
    config: {
      activeProvider: 'openai',
      providers: {
        openai: { enabled: true, model: 'gpt-4.1-mini', temperature: 0.3 },
        gemini: { enabled: true, model: 'gemini-2.5-flash', temperature: 0.3 },
        mistral: { enabled: true, model: 'mistral-small-3.2', temperature: 0.3 },
      },
      languages: { en: true, hi: true, fr: true, es: true, pt: true },
      formalStyle: true,
    },
  },
  share_thread: {
    enabled: false,
    config: {
      defaultExpiryDays: 7,
      allowDownloadsByDefault: true,
      allowedRoles: ['admin', 'superuser', 'user'],
      maxSharesPerThread: 10,
      rateLimitPerHour: 20,
    },
  },
  send_email: {
    enabled: false,
    config: {
      sendgridApiKey: '',
      senderEmail: '',
      senderName: 'Policy Bot',
      rateLimitPerHour: 50,
    },
  },
  diagram_gen: {
    enabled: true,
    config: {
      temperature: 0.3,
      maxTokens: 1500,
      validateSyntax: true,
      maxRetries: 2,
      debugMode: false,
    },
  },
  compliance_checker: {
    enabled: false,
    config: {
      passThreshold: 80,
      warnThreshold: 50,
      enableHitl: true,
      useWeightedScoring: true,
      clarificationProvider: 'auto',
      clarificationModel: '',
      useLlmClarifications: true,
      clarificationTimeout: 5000,
      fallbackToTemplates: true,
      allowAcceptFlagged: true,
    },
  },
  podcast_gen: {
    enabled: false,
    config: {
      activeProvider: 'none',
      providers: {
        openai: {
          enabled: false,
          model: 'gpt-4o-mini-tts',
          voice: 'marin',
          speed: 1.0,
          instructions: '',
        },
        gemini: {
          enabled: false,
          model: 'gemini-2.5-flash-preview-tts',
          multiSpeaker: true,
          hostVoice: 'Aoede',
          expertVoice: 'Charon',
          hostAccent: '',
          expertAccent: '',
        },
      },
      defaultStyle: 'conversational',
      defaultLength: 'medium',
      outputFormat: 'mp3',
      expirationDays: 30,
    },
  },
  website_analysis: {
    enabled: false,
    config: {
      apiKey: '',
      defaultStrategy: 'mobile',
      cacheTTLSeconds: 3600,
      includeOpportunities: true,
      includeDiagnostics: true,
    },
  },
  code_analysis: {
    enabled: false,
    config: {
      apiToken: '',
      organization: '',
      enableDynamicLookup: true,
      preConfiguredRepos: [],
      cacheTTLSeconds: 1800,
      maxIssuesPerCategory: 25,
    },
  },
  ai_disclaimer: {
    enabled: false,
    config: {
      fullText: 'This is AI generated content',
      abbreviatedText: 'AI',
      fontSize: 9,
      color: '#666666',
      smallImageThreshold: 400,
      imageWatermark: {
        enabled: true,
        opacity: 0.7,
        position: 'bottomRight',
      },
    },
  },
};

function getTranslationToolDefaults(): { enabled: boolean; config: Record<string, unknown> } {
  const defaultModel = getDefaultLLMModel();
  const presets = getModelPresetsFromConfig();

  const findModelForProvider = (provider: string): string => {
    const providerModels = Object.entries(presets)
      .filter(([, preset]) => preset.provider === provider)
      .map(([id]) => id);

    if (provider === 'openai') {
      return providerModels.find(m => m.includes('mini')) || providerModels[0] || defaultModel;
    }
    if (provider === 'gemini') {
      return providerModels.find(m => m.includes('flash') && !m.includes('lite')) || providerModels[0] || defaultModel;
    }
    if (provider === 'mistral') {
      return providerModels.find(m => m.includes('small')) || providerModels[0] || defaultModel;
    }
    return providerModels[0] || defaultModel;
  };

  return {
    enabled: false,
    config: {
      activeProvider: 'openai',
      providers: {
        openai: { enabled: true, model: findModelForProvider('openai'), temperature: 0.3 },
        gemini: { enabled: true, model: findModelForProvider('gemini'), temperature: 0.3 },
        mistral: { enabled: true, model: findModelForProvider('mistral'), temperature: 0.3 },
      },
      languages: { en: true, hi: true, fr: true, es: true, pt: true },
      formalStyle: true,
    },
  };
}

export function getToolDefaultsForTool(toolName: string): { enabled: boolean; config: Record<string, unknown> } | undefined {
  if (toolName === 'translation') {
    return getTranslationToolDefaults();
  }
  return TOOL_DEFAULTS[toolName];
}

// ============================================================================
// Category prompt constants
// ============================================================================

/** @deprecated Use getMaxCombinedPromptLength() instead */
export const MAX_COMBINED_PROMPT_LENGTH = 8000;
/** @deprecated Use getMaxStarterPrompts() instead */
export const MAX_STARTER_PROMPTS = 6;
/** @deprecated Use getMaxStarterLabelLength() instead */
export const MAX_STARTER_LABEL_LENGTH = 30;
/** @deprecated Use getMaxStarterPromptLength() instead */
export const MAX_STARTER_PROMPT_LENGTH = 500;

// ============================================================================
// Task plan utilities
// ============================================================================

export type TaskStatus = 'pending' | 'in_progress' | 'complete' | 'failed' | 'skipped';

export interface TaskPlanStats {
  total: number;
  pending: number;
  in_progress: number;
  complete: number;
  failed: number;
  skipped: number;
  progress_percent: number;
}

export function calculateStats(tasks: { status: TaskStatus }[]): TaskPlanStats {
  const stats = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    in_progress: tasks.filter((t) => t.status === 'in_progress').length,
    complete: tasks.filter((t) => t.status === 'complete').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
    skipped: tasks.filter((t) => t.status === 'skipped').length,
    progress_percent: 0,
  };

  const finished = stats.complete + stats.failed + stats.skipped;
  stats.progress_percent = stats.total > 0 ? Math.round((finished / stats.total) * 100) : 0;

  return stats;
}

// ============================================================================
// Workspace message utilities
// ============================================================================

export function parseSources<T = unknown>(sourcesJson: string | null): T[] {
  if (!sourcesJson) return [];
  try {
    return JSON.parse(sourcesJson);
  } catch {
    return [];
  }
}

// ============================================================================
// Share / token utilities
// ============================================================================

export function generateShareToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export interface ThreadShareForValidation {
  revokedAt: Date | string | null;
  isExpired: boolean;
}

export function validateShareAccess(share: ThreadShareForValidation): string | null {
  if (share.revokedAt) {
    return 'This share has been revoked';
  }

  if (share.isExpired) {
    return 'This share has expired';
  }

  return null;
}

// ============================================================================
// Agent config validation
// ============================================================================

export interface AgentModelConfigForValidation {
  provider: string;
  model: string;
  temperature: number;
  max_tokens?: number;
}

export function validateAgentModelConfig(config: AgentModelConfigForValidation): boolean {
  if (!config.provider || !['openai', 'gemini', 'mistral'].includes(config.provider)) {
    return false;
  }
  if (!config.model || config.model.trim() === '') {
    return false;
  }
  if (typeof config.temperature !== 'number' || config.temperature < 0 || config.temperature > 2) {
    return false;
  }
  return true;
}

// ============================================================================
// Config defaults
// ============================================================================

export interface PWASettings {
  themeColor: string;
  backgroundColor: string;
  icon192Path: string;
  icon512Path: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_PWA_SETTINGS: PWASettings = {
  themeColor: '#2563eb',
  backgroundColor: '#ffffff',
  icon192Path: '/icons/icon-192x192.png',
  icon512Path: '/icons/icon-512x512.png',
};

export type OcrProvider = 'mistral' | 'azure-di' | 'pdf-parse';

export interface OcrProviderConfig {
  provider: OcrProvider;
  enabled: boolean;
}

export interface OcrSettings {
  providers: OcrProviderConfig[];
  mistralApiKey?: string;
  azureDiEndpoint?: string;
  azureDiKey?: string;
}

export const DEFAULT_OCR_SETTINGS: OcrSettings = {
  providers: [
    { provider: 'mistral', enabled: true },
    { provider: 'azure-di', enabled: true },
    { provider: 'pdf-parse', enabled: true },
  ],
};

export const BRANDING_ICONS = [
  { key: 'government', label: 'Government', lucideIcon: 'Landmark', png192: '/icons/bot/government-192.png', png512: '/icons/bot/government-512.png' },
  { key: 'operations', label: 'Operations', lucideIcon: 'Settings', png192: '/icons/bot/operations-192.png', png512: '/icons/bot/operations-512.png' },
  { key: 'finance', label: 'Finance', lucideIcon: 'DollarSign', png192: '/icons/bot/finance-192.png', png512: '/icons/bot/finance-512.png' },
  { key: 'kpi', label: 'KPI', lucideIcon: 'BarChart3', png192: '/icons/bot/kpi-192.png', png512: '/icons/bot/kpi-512.png' },
  { key: 'logs', label: 'Logs', lucideIcon: 'FileText', png192: '/icons/bot/logs-192.png', png512: '/icons/bot/logs-512.png' },
  { key: 'data', label: 'Data', lucideIcon: 'Database', png192: '/icons/bot/data-192.png', png512: '/icons/bot/data-512.png' },
  { key: 'monitoring', label: 'Monitoring', lucideIcon: 'Activity', png192: '/icons/bot/monitoring-192.png', png512: '/icons/bot/monitoring-512.png' },
  { key: 'architecture', label: 'Architecture', lucideIcon: 'Layers', png192: '/icons/bot/architecture-192.png', png512: '/icons/bot/architecture-512.png' },
  { key: 'internet', label: 'Internet', lucideIcon: 'Globe', png192: '/icons/bot/internet-192.png', png512: '/icons/bot/internet-512.png' },
  { key: 'systems', label: 'Systems', lucideIcon: 'Server', png192: '/icons/bot/systems-192.png', png512: '/icons/bot/systems-512.png' },
  { key: 'policy', label: 'Policy', lucideIcon: 'ScrollText', png192: '/icons/bot/policy-192.png', png512: '/icons/bot/policy-512.png' },
] as const;

export const DEFAULT_MODEL_ID = getDefaultPresetId();

export interface CredentialsAuthSettings {
  enabled: boolean;
  minPasswordLength: number;
}

export const DEFAULT_CREDENTIALS_AUTH_SETTINGS: CredentialsAuthSettings = {
  enabled: true,
  minPasswordLength: 8,
};

// ============================================================================
// Function API validation
// ============================================================================

export function validateToolsSchema(
  schema: unknown
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!Array.isArray(schema)) {
    errors.push('Schema must be an array of tool definitions');
    return { valid: false, errors };
  }

  for (let i = 0; i < schema.length; i++) {
    const tool = schema[i] as Record<string, unknown>;

    if (tool.type !== 'function') {
      errors.push(`Tool ${i}: type must be "function"`);
    }

    if (!tool.function || typeof tool.function !== 'object') {
      errors.push(`Tool ${i}: missing "function" object`);
      continue;
    }

    const func = tool.function as Record<string, unknown>;

    if (!func.name || typeof func.name !== 'string') {
      errors.push(`Tool ${i}: function must have a "name" string`);
    }

    if (!func.description || typeof func.description !== 'string') {
      errors.push(`Tool ${i}: function must have a "description" string`);
    }

    if (func.parameters && typeof func.parameters !== 'object') {
      errors.push(`Tool ${i}: "parameters" must be an object`);
    }
  }

  return { valid: errors.length === 0, errors };
}

import type { EndpointMapping } from '@/types/function-api';
export type { EndpointMapping };

export function validateEndpointMappings(
  schema: { function: { name: string } }[],
  mappings: Record<string, EndpointMapping>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const functionNames = schema.map(t => t.function.name);

  for (const name of functionNames) {
    if (!mappings[name]) {
      errors.push(`Missing endpoint mapping for function: ${name}`);
    }
  }

  for (const [name, mapping] of Object.entries(mappings)) {
    if (!functionNames.includes(name)) {
      errors.push(`Endpoint mapping for unknown function: ${name}`);
    }

    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(mapping.method)) {
      errors.push(`Invalid method for ${name}: ${mapping.method}`);
    }

    if (!mapping.path || !mapping.path.startsWith('/')) {
      errors.push(`Invalid path for ${name}: ${mapping.path}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Tool Configuration Database Operations
 *
 * CRUD operations for the tool_configs and tool_config_audit tables.
 * Supports the unified Tools system with audit trail.
 */

import { v4 as uuidv4 } from 'uuid';
import { execute, queryOne, queryAll, transaction } from './index';
import { getTavilySettings, type TavilySettings } from './config';
import { getDefaultLLMModel, getModelPresetsFromConfig } from '../config-loader';

// ============ Types ============

export interface ToolConfig {
  id: string;
  toolName: string;
  isEnabled: boolean;
  config: Record<string, unknown>;
  descriptionOverride: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ToolConfigAuditEntry {
  id: number;
  toolName: string;
  operation: 'create' | 'update' | 'delete';
  oldConfig: Record<string, unknown> | null;
  newConfig: Record<string, unknown> | null;
  changedBy: string;
  changedAt: string;
}

// Database row types
interface DbToolConfig {
  id: string;
  tool_name: string;
  is_enabled: number;
  config_json: string;
  description_override: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

interface DbToolConfigAudit {
  id: number;
  tool_name: string;
  operation: string;
  old_config: string | null;
  new_config: string | null;
  changed_by: string;
  changed_at: string;
}

// ============ Mappers ============

function mapDbToToolConfig(row: DbToolConfig): ToolConfig {
  return {
    id: row.id,
    toolName: row.tool_name,
    isEnabled: row.is_enabled === 1,
    config: JSON.parse(row.config_json),
    descriptionOverride: row.description_override,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function mapDbToAuditEntry(row: DbToolConfigAudit): ToolConfigAuditEntry {
  return {
    id: row.id,
    toolName: row.tool_name,
    operation: row.operation as 'create' | 'update' | 'delete',
    oldConfig: row.old_config ? JSON.parse(row.old_config) : null,
    newConfig: row.new_config ? JSON.parse(row.new_config) : null,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
  };
}

// ============ CRUD Operations ============

/**
 * Get a tool configuration by name
 */
export function getToolConfig(toolName: string): ToolConfig | undefined {
  const row = queryOne<DbToolConfig>(
    'SELECT * FROM tool_configs WHERE tool_name = ?',
    [toolName]
  );
  return row ? mapDbToToolConfig(row) : undefined;
}

/**
 * Get all tool configurations
 */
export function getAllToolConfigs(): ToolConfig[] {
  const rows = queryAll<DbToolConfig>('SELECT * FROM tool_configs ORDER BY tool_name');
  return rows.map(mapDbToToolConfig);
}

/**
 * Check if a tool is enabled
 */
export function isToolEnabled(toolName: string): boolean {
  const config = getToolConfig(toolName);
  return config?.isEnabled ?? false;
}

/**
 * Create a new tool configuration
 */
export function createToolConfig(
  toolName: string,
  config: Record<string, unknown>,
  isEnabled: boolean,
  updatedBy: string
): ToolConfig {
  const id = uuidv4();
  const configJson = JSON.stringify(config);

  return transaction(() => {
    execute(
      `INSERT INTO tool_configs (id, tool_name, is_enabled, config_json, updated_by)
       VALUES (?, ?, ?, ?, ?)`,
      [id, toolName, isEnabled ? 1 : 0, configJson, updatedBy]
    );

    // Record audit entry
    execute(
      `INSERT INTO tool_config_audit (tool_name, operation, old_config, new_config, changed_by)
       VALUES (?, 'create', NULL, ?, ?)`,
      [toolName, configJson, updatedBy]
    );

    return getToolConfig(toolName)!;
  });
}

/**
 * Update a tool configuration
 */
export function updateToolConfig(
  toolName: string,
  updates: {
    isEnabled?: boolean;
    config?: Record<string, unknown>;
    descriptionOverride?: string | null;
  },
  updatedBy: string
): ToolConfig | undefined {
  const existing = getToolConfig(toolName);
  if (!existing) return undefined;

  const newEnabled = updates.isEnabled ?? existing.isEnabled;
  const newConfig = updates.config ?? existing.config;
  const newConfigJson = JSON.stringify(newConfig);
  const oldConfigJson = JSON.stringify(existing.config);
  // Handle descriptionOverride: undefined means keep existing, null means clear it
  const newDescriptionOverride = updates.descriptionOverride !== undefined
    ? updates.descriptionOverride
    : existing.descriptionOverride;

  return transaction(() => {
    execute(
      `UPDATE tool_configs
       SET is_enabled = ?, config_json = ?, description_override = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
       WHERE tool_name = ?`,
      [newEnabled ? 1 : 0, newConfigJson, newDescriptionOverride, updatedBy, toolName]
    );

    // Record audit entry
    execute(
      `INSERT INTO tool_config_audit (tool_name, operation, old_config, new_config, changed_by)
       VALUES (?, 'update', ?, ?, ?)`,
      [toolName, oldConfigJson, newConfigJson, updatedBy]
    );

    return getToolConfig(toolName)!;
  });
}

/**
 * Delete a tool configuration
 */
export function deleteToolConfig(toolName: string, deletedBy: string): boolean {
  const existing = getToolConfig(toolName);
  if (!existing) return false;

  const oldConfigJson = JSON.stringify(existing.config);

  return transaction(() => {
    execute('DELETE FROM tool_configs WHERE tool_name = ?', [toolName]);

    // Record audit entry
    execute(
      `INSERT INTO tool_config_audit (tool_name, operation, old_config, new_config, changed_by)
       VALUES (?, 'delete', ?, NULL, ?)`,
      [toolName, oldConfigJson, deletedBy]
    );

    return true;
  });
}

/**
 * Get audit history for a tool
 */
export function getToolConfigAuditHistory(
  toolName: string,
  limit: number = 50
): ToolConfigAuditEntry[] {
  const rows = queryAll<DbToolConfigAudit>(
    `SELECT * FROM tool_config_audit
     WHERE tool_name = ?
     ORDER BY changed_at DESC
     LIMIT ?`,
    [toolName, limit]
  );
  return rows.map(mapDbToAuditEntry);
}

/**
 * Get all audit entries (for admin overview)
 */
export function getAllToolConfigAuditHistory(limit: number = 100): ToolConfigAuditEntry[] {
  const rows = queryAll<DbToolConfigAudit>(
    `SELECT * FROM tool_config_audit
     ORDER BY changed_at DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map(mapDbToAuditEntry);
}

// ============ Migration Helpers ============

/**
 * Migrate existing Tavily settings from the settings table to tool_configs
 * This is called on first load to seed the web_search tool config
 */
export function migrateTavilySettingsIfNeeded(): void {
  // Check if web_search already exists in tool_configs
  const existing = getToolConfig('web_search');
  if (existing) return;

  // Get existing Tavily settings from settings table
  const tavilySettings = getTavilySettings();

  // Create the tool config from existing settings
  createToolConfig(
    'web_search',
    {
      apiKey: tavilySettings.apiKey || '',
      defaultTopic: tavilySettings.defaultTopic,
      defaultSearchDepth: tavilySettings.defaultSearchDepth,
      maxResults: tavilySettings.maxResults,
      includeDomains: tavilySettings.includeDomains,
      excludeDomains: tavilySettings.excludeDomains,
      cacheTTLSeconds: tavilySettings.cacheTTLSeconds,
    },
    tavilySettings.enabled,
    'system-migration'
  );

  console.log('[Tools] Migrated Tavily settings to tool_configs table');
}

/**
 * Get web search settings (with backward compatibility)
 * Tries tool_configs first, falls back to settings table
 */
export function getWebSearchConfig(): {
  enabled: boolean;
  config: TavilySettings;
} {
  const toolConfig = getToolConfig('web_search');

  if (toolConfig) {
    const config = toolConfig.config as Record<string, unknown>;
    return {
      enabled: toolConfig.isEnabled,
      config: {
        apiKey: (config.apiKey as string) || undefined,
        enabled: toolConfig.isEnabled,
        defaultTopic: (config.defaultTopic as 'general' | 'news' | 'finance') || 'general',
        defaultSearchDepth: (config.defaultSearchDepth as 'basic' | 'advanced') || 'basic',
        maxResults: (config.maxResults as number) || 5,
        includeDomains: (config.includeDomains as string[]) || [],
        excludeDomains: (config.excludeDomains as string[]) || [],
        cacheTTLSeconds: (config.cacheTTLSeconds as number) || 3600,
      },
    };
  }

  // Fallback to settings table
  const tavilySettings = getTavilySettings();
  return {
    enabled: tavilySettings.enabled,
    config: tavilySettings,
  };
}

// ============ Tool Definitions Registry ============

/**
 * Get dynamic translation tool defaults based on config
 * Uses config-loader to derive appropriate models per provider
 */
function getTranslationToolDefaults(): { enabled: boolean; config: Record<string, unknown> } {
  const defaultModel = getDefaultLLMModel();
  const presets = getModelPresetsFromConfig();

  // Find best model for each provider from available presets
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
        openai: {
          enabled: true,
          model: findModelForProvider('openai'),
          temperature: 0.3,
        },
        gemini: {
          enabled: true,
          model: findModelForProvider('gemini'),
          temperature: 0.3,
        },
        mistral: {
          enabled: true,
          model: findModelForProvider('mistral'),
          temperature: 0.3,
        },
      },
      languages: {
        en: true,
        hi: true,
        fr: true,
        es: true,
        pt: true,
      },
      formalStyle: true,
    },
  };
}

/**
 * Get defaults for a specific tool (with dynamic values where needed)
 */
export function getToolDefaultsForTool(toolName: string): { enabled: boolean; config: Record<string, unknown> } | undefined {
  // Use dynamic defaults for tools that depend on config
  if (toolName === 'translation') {
    return getTranslationToolDefaults();
  }
  return TOOL_DEFAULTS[toolName];
}

/**
 * Default configurations for each tool type
 * Note: For translation tool, use getToolDefaultsForTool('translation') to get dynamic defaults
 */
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
      includeAnswer: 'basic',  // 'false' | 'basic' | 'advanced'
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
    enabled: false,  // Disabled until API key configured
    config: {
      apiKey: '',
      preferredLanguage: 'en',
      fallbackEnabled: true,  // Allow youtube-transcript npm fallback
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
    enabled: false, // Disabled until API keys configured
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
    enabled: false, // Disabled until at least one provider is configured
    config: {
      activeProvider: 'openai',
      providers: {
        openai: {
          enabled: true,
          model: 'gpt-4.1-mini',
          temperature: 0.3,
        },
        gemini: {
          enabled: true,
          model: 'gemini-2.5-flash',
          temperature: 0.3,
        },
        mistral: {
          enabled: true,
          model: 'mistral-small-3.2',
          temperature: 0.3,
        },
      },
      languages: {
        en: true,
        hi: true,
        fr: true,
        es: true,
        pt: true,
      },
      formalStyle: true,
    },
  },
  share_thread: {
    enabled: false, // Disabled by default until admin enables
    config: {
      defaultExpiryDays: 7,
      allowDownloadsByDefault: true,
      allowedRoles: ['admin', 'superuser', 'user'],
      maxSharesPerThread: 10,
      rateLimitPerHour: 20,
    },
  },
  send_email: {
    enabled: false, // Disabled until SendGrid configured
    config: {
      sendgridApiKey: '',
      senderEmail: '',
      senderName: 'Policy Bot',
      rateLimitPerHour: 50,
    },
  },
  diagram_gen: {
    enabled: true, // Enabled by default - uses system default LLM
    config: {
      temperature: 0.3,
      maxTokens: 1500,
      validateSyntax: true,
      maxRetries: 2,
      debugMode: false,
    },
  },
  compliance_checker: {
    enabled: false, // Disabled by default - opt-in feature
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
    enabled: false, // Disabled by default - requires TTS provider setup
    config: {
      activeProvider: 'none',
      providers: {
        openai: {
          enabled: false,
          model: 'gpt-4o-mini-tts',
          voice: 'marin',  // Best quality voice
          speed: 1.0,
          instructions: '',  // Voice style control
        },
        gemini: {
          enabled: false,
          model: 'gemini-2.5-flash-preview-tts',
          multiSpeaker: true,  // Multi-speaker mode enabled by default
          hostVoice: 'Aoede',  // Breezy - good for conversational host
          expertVoice: 'Charon',  // Informative - good for expert explanations
          hostAccent: '',  // Optional: e.g., "British English from London"
          expertAccent: '',  // Optional: e.g., "American English from New York"
        },
      },
      defaultStyle: 'conversational',
      defaultLength: 'medium',
      outputFormat: 'mp3',
      expirationDays: 30,
    },
  },
  website_analysis: {
    enabled: false, // Disabled by default - works without API key but recommended
    config: {
      apiKey: '',
      defaultStrategy: 'mobile',
      cacheTTLSeconds: 3600,
      includeOpportunities: true,
      includeDiagnostics: true,
    },
  },
  code_analysis: {
    enabled: false, // Disabled by default - requires SonarCloud token
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
    enabled: false, // Disabled by default - admin must explicitly enable
    config: {
      fullText: 'This is AI generated content',
      abbreviatedText: 'AI',
      fontSize: 9,
      color: '#666666',
      smallImageThreshold: 400, // Images smaller than this use abbreviated text
      imageWatermark: {
        enabled: true,
        opacity: 0.7,
        position: 'bottomRight',
      },
    },
  },
};

/**
 * Ensure all registered tools have configurations in the database
 * This is called during initialization to seed missing tool configs
 */
export function ensureToolConfigsExist(updatedBy: string = 'system'): void {
  for (const toolName of Object.keys(TOOL_DEFAULTS)) {
    const existing = getToolConfig(toolName);
    if (!existing) {
      // Use dynamic defaults where available
      const defaults = getToolDefaultsForTool(toolName) || TOOL_DEFAULTS[toolName];
      createToolConfig(toolName, defaults.config, defaults.enabled, updatedBy);
      console.log(`[Tools] Created default config for tool: ${toolName}`);
    }
  }
}

/**
 * Reset a tool to its default configuration
 */
export function resetToolToDefaults(toolName: string, updatedBy: string): ToolConfig | undefined {
  // Use dynamic defaults where available
  const defaults = getToolDefaultsForTool(toolName);
  if (!defaults) return undefined;

  return updateToolConfig(toolName, {
    isEnabled: defaults.enabled,
    config: defaults.config,
    descriptionOverride: null,  // Clear any description override on reset
  }, updatedBy);
}

/**
 * Get the description override for a tool (if any)
 * Used by getToolDefinitions() to apply admin-customized descriptions
 */
export function getDescriptionOverride(toolName: string): string | null {
  const config = getToolConfig(toolName);
  return config?.descriptionOverride ?? null;
}

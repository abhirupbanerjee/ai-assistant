/**
 * Configuration Database Operations
 *
 * Key-value settings store with fallback to JSON config files
 * Priority: SQLite > JSON config > Hardcoded defaults
 */

import { execute, queryOne } from './index';
import {
  loadConfig,
  loadSystemPrompt,
  getModelPresetsFromConfig,
  getDefaultPresetId,
  getSystemPromptFileHash,
  type ModelPresetConfig,
} from '../config-loader';
import {
  getActiveModels,
  getDefaultModel,
  isModelToolCapable as isEnabledModelToolCapable,
  hasEnabledModels,
  getToolCapableModelIds as getDbToolCapableModelIds,
  getEnabledModel,
} from './enabled-models';
import { getDefaultOutputTokens } from '../services/model-discovery';

// ============ Types ============

export interface RagSettings {
  topKChunks: number;
  maxContextChunks: number;
  similarityThreshold: number;
  chunkSize: number;
  chunkOverlap: number;
  queryExpansionEnabled: boolean;
  cacheEnabled: boolean;
  cacheTTLSeconds: number;
  chunkingStrategy: 'recursive' | 'semantic';  // Chunking algorithm (default: 'recursive')
  semanticBreakpointThreshold: number;         // Sensitivity for semantic chunking (0.3-0.8, default: 0.5)
}

export interface LlmSettings {
  model: string;
  temperature: number;
  maxTokens: number;
  promptOptimizationMaxTokens: number;  // Max tokens for prompt optimization LLM call (default: 2000)
}

export interface TavilySettings {
  apiKey?: string;  // Stored encrypted, falls back to TAVILY_API_KEY env var
  enabled: boolean;
  defaultTopic: 'general' | 'news' | 'finance';
  defaultSearchDepth: 'basic' | 'advanced';
  maxResults: number;  // Admin default (1-20)
  includeDomains: string[];
  excludeDomains: string[];
  cacheTTLSeconds: number;
  includeAnswer?: 'none' | 'basic' | 'advanced';  // 'none' = disabled, 'basic' = quick answer, 'advanced' = comprehensive
}

export interface UploadLimits {
  maxFilesPerInput: number;
  maxFilesPerThread: number;
  maxFileSizeMB: number;
  allowedTypes: string[];
}

export interface SystemPrompt {
  content: string;
  fileHash?: string;  // Hash of system-prompt.md when this was saved
}

export interface RetentionSettings {
  threadRetentionDays: number;
  storageAlertThreshold: number;
}

export type AcronymMappings = Record<string, string[]>;

export interface BrandingSettings {
  botName: string;
  botIcon: string;
  subtitle?: string;          // Custom subtitle for header (replaces hardcoded)
  welcomeTitle?: string;      // Global fallback for welcome screen
  welcomeMessage?: string;    // Global fallback for welcome screen
  accentColor?: string;       // Accent color for UI elements (default: #2563eb)
}

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

export interface EmbeddingSettings {
  model: string;           // e.g., 'text-embedding-3-large'
  dimensions: number;      // e.g., 3072
  fallbackModel?: string;  // Fallback model if primary fails (default: 'text-embedding-3-large')
}

export type RerankerProvider = 'bge-large' | 'cohere' | 'fireworks' | 'bge-base' | 'local';

export interface RerankerProviderConfig {
  provider: RerankerProvider;
  enabled: boolean;
}

export interface RerankerSettings {
  enabled: boolean;
  providers: RerankerProviderConfig[];  // Ordered by priority (index 0 = primary)
  cohereApiKey?: string;          // Cohere API key (stored, falls back to COHERE_API_KEY env var)
  topKForReranking: number;       // How many chunks to rerank (default: 50)
  minRerankerScore: number;       // Threshold 0-1 (default: 0.3)
  cacheTTLSeconds: number;        // Cache duration (default: 3600)
}

export const DEFAULT_RERANKER_SETTINGS: RerankerSettings = {
  enabled: true,
  providers: [
    { provider: 'bge-large', enabled: true },
    { provider: 'cohere', enabled: true },
    { provider: 'fireworks', enabled: true },
    { provider: 'bge-base', enabled: true },
    { provider: 'local', enabled: true },
  ],
  topKForReranking: 50,
  minRerankerScore: 0.3,
  cacheTTLSeconds: 3600,
};

export interface MemorySettings {
  enabled: boolean;               // Enable/disable memory system
  extractionThreshold: number;    // Minimum messages before extracting facts
  maxFactsPerCategory: number;    // Maximum facts stored per user+category
  autoExtractOnThreadEnd: boolean; // Auto-extract facts when thread ends
  extractionMaxTokens: number;    // Max tokens for fact extraction LLM call (default: 1000)
}

export interface SummarizationSettings {
  enabled: boolean;               // Enable/disable auto-summarization
  tokenThreshold: number;         // Trigger summarization when thread exceeds this
  keepRecentMessages: number;     // Number of recent messages to preserve unsummarized
  summaryMaxTokens: number;       // Maximum length of generated summary
  archiveOriginalMessages: boolean; // Keep original messages for audit/recovery
}

export interface SkillsSettings {
  enabled: boolean;               // Enable/disable skills system (uses legacy prompt if false)
  maxTotalTokens: number;         // Token budget warning threshold
  debugMode: boolean;             // Log skill activation details
}

export type OcrProvider = 'mistral' | 'azure-di' | 'pdf-parse';

export interface OcrProviderConfig {
  provider: OcrProvider;
  enabled: boolean;
}

export interface OcrSettings {
  providers: OcrProviderConfig[];  // Ordered by priority (index 0 = primary)
  // Mistral OCR credentials (falls back to LLM provider config, then env var)
  mistralApiKey?: string;
  // Azure Document Intelligence credentials (falls back to env vars)
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

export interface SuperuserSettings {
  maxCategoriesPerSuperuser: number;  // Max categories a superuser can create (default: 5)
}

export interface AgentBotsSettings {
  enabled: boolean;                    // Whether agent bots feature is enabled
  maxJobsPerMinute: number;            // Global rate limit per minute
  maxJobsPerDay: number;               // Global rate limit per day
  defaultRateLimitRpm: number;         // Default API key rate limit per minute
  defaultRateLimitRpd: number;         // Default API key rate limit per day
  maxOutputSizeMB: number;             // Max output file size in MB
  jobRetentionDays: number;            // How long to keep job records
}

/**
 * Credentials Authentication Settings
 * Controls optional username/password login (default: enabled)
 */
export interface CredentialsAuthSettings {
  enabled: boolean;           // Whether credentials login is enabled (default: true)
  minPasswordLength: number;  // Minimum password length (default: 8)
}

export const DEFAULT_CREDENTIALS_AUTH_SETTINGS: CredentialsAuthSettings = {
  enabled: true,
  minPasswordLength: 8,
};

/**
 * LLM Fallback Settings
 * Controls automatic fallback when selected LLM fails or lacks required capabilities
 */
export interface LlmFallbackSettings {
  universalFallback: string | null;    // Fallback model (must have vision + tools capability)
  maxRetryAttempts: number;            // 1-3, default: 2 (selected + fallback)
  healthCacheDuration: 'hourly' | 'daily' | 'disabled';  // How long to remember failed models
}

/**
 * LLM Routes Settings
 * Controls primary/fallback routing between LiteLLM proxy and direct providers
 */
export interface RoutesSettings {
  route1Enabled: boolean;                  // Route 1: LiteLLM proxy (OpenAI, Gemini, Mistral, DeepSeek)
  route2Enabled: boolean;                  // Route 2: Direct providers (Fireworks AI, Claude/Anthropic)
  route3Enabled: boolean;                  // Route 3: Local / Ollama direct (air-gapped capable)
  primaryRoute: 'route1' | 'route2' | 'route3';  // Which route is primary (others become fallback)
}

export const DEFAULT_ROUTES_SETTINGS: RoutesSettings = {
  route1Enabled: true,
  route2Enabled: false,
  route3Enabled: false,
  primaryRoute: 'route1',
};

export interface LimitsSettings {
  conversationHistoryMessages: number;  // Number of recent messages sent to LLM (default: 5)
  maxTotalToolCalls: number;            // Total tool calls per chat transaction (default: 50)
  maxPerToolCalls: number;              // Max calls for any single tool type (default: 10)
}

/**
 * Consolidated token limits settings
 * All token/prompt limits in one place for easier management
 */
export interface TokenLimitsSettings {
  // LLM response limits (moved from various settings)
  promptOptimizationMaxTokens: number;  // 100-8000: Max tokens for prompt optimization LLM calls
  skillsMaxTotalTokens: number;         // 500-20000: Combined budget for all active skill prompts
  memoryExtractionMaxTokens: number;    // 100-8000: Max tokens for fact extraction LLM calls
  summaryMaxTokens: number;             // 100-10000: Max tokens for auto-generated summaries

  // System/Category prompts (context limits)
  systemPromptMaxTokens: number;        // 500-4000: Max tokens for global system prompt
  categoryPromptMaxTokens: number;      // 250-2000: Max tokens for category addendum

  // Starter prompts (keep as chars - UI display limits)
  starterLabelMaxChars: number;         // 20-50: Max chars for starter button labels
  starterPromptMaxChars: number;        // 200-1000: Max chars for starter prompt text
  maxStartersPerCategory: number;       // 3-10: Max starter buttons per category
}

/**
 * Per-model token limits configuration
 * Allows admin to override default maxTokens for specific models
 */
export interface ModelTokenLimits {
  [modelId: string]: number | 'default';  // number = custom limit, 'default' = use preset value
}

// Available icon options for branding
// Each icon has Lucide component name and pre-rendered PNG paths for PWA
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

// ============ Available Models ============

export interface AvailableModel {
  id: string;
  name: string;
  description: string;
  provider: 'openai' | 'mistral' | 'gemini' | 'ollama';
  defaultMaxTokens: number;
}

/**
 * Get available models
 * Priority: Database (admin-configured) > LiteLLM YAML > Hardcoded presets
 *
 * When admin has configured models via Settings → LLM,
 * those take precedence over YAML/preset discovery.
 */
export function getAvailableModels(): AvailableModel[] {
  // Try database first (admin-configured models)
  try {
    if (hasEnabledModels()) {
      const dbModels = getActiveModels();
      if (dbModels.length > 0) {
        return dbModels.map(model => ({
          id: model.id,
          name: model.displayName,
          description: `${model.providerId} model${model.toolCapable ? ' with tool support' : ''}${model.visionCapable ? ' and vision' : ''}`,
          provider: model.providerId as 'openai' | 'mistral' | 'gemini' | 'ollama',
          defaultMaxTokens: model.maxInputTokens || 2000,
        }));
      }
    }
  } catch {
    // Fall through to YAML/preset discovery
  }

  // Fall back to YAML/preset discovery
  const configPresets = getModelPresetsFromConfig();
  return Object.entries(configPresets).map(([id, config]) => ({
    id,
    name: config.name,
    description: config.description,
    provider: config.provider as 'openai' | 'mistral' | 'gemini' | 'ollama',
    defaultMaxTokens: config.maxTokens,
  }));
}

/**
 * Check if a model supports tool/function calling
 * Priority: Database > YAML > Hardcoded list
 */
export function isToolCapableModelFromDb(modelId: string): boolean {
  // Try database first
  try {
    if (hasEnabledModels()) {
      return isEnabledModelToolCapable(modelId);
    }
  } catch {
    // Fall through
  }

  // Fall back to config-loader
  const { isToolCapableModel } = require('../config-loader');
  return isToolCapableModel(modelId);
}

/**
 * Get all tool-capable model IDs
 * Priority: Database > YAML > Hardcoded list
 */
export function getToolCapableModels(): Set<string> {
  // Try database first
  try {
    if (hasEnabledModels()) {
      return getDbToolCapableModelIds();
    }
  } catch {
    // Fall through
  }

  // Fall back to config-loader
  const configLoader = require('../config-loader');
  return configLoader.getToolCapableModels();
}

// Default model ID (loaded from config)
export const DEFAULT_MODEL_ID = getDefaultPresetId();

// Setting keys
export type SettingKey =
  | 'rag-settings'
  | 'llm-settings'
  | 'tavily-settings'
  | 'upload-limits'
  | 'system-prompt'
  | 'acronym-mappings'
  | 'retention-settings'
  | 'branding-settings'
  | 'embedding-settings'
  | 'reranker-settings'
  | 'memory-settings'
  | 'summarization-settings'
  | 'skills-settings'
  | 'ocr-settings'
  | 'limits-settings'
  | 'model-token-limits'
  | 'token-limits-settings'
  | 'pwa-settings'
  | 'superuser-settings'
  | 'workspaces-settings'
  | 'agent_budget_max_llm_calls'
  | 'agent_budget_max_tokens'
  | 'agent_budget_max_web_searches'
  | 'agent_confidence_threshold'
  | 'agent_budget_max_duration_minutes'
  | 'agent_task_timeout_minutes'
  | 'agent_model_planner'
  | 'agent_model_executor'
  | 'agent_model_checker'
  | 'agent_model_summarizer'
  | 'agent_summarizer_system_prompt'
  | 'agent_planner_system_prompt'
  | 'agent_executor_system_prompt'
  | 'agent_checker_system_prompt'
  | 'agent_autonomous_enabled'
  // HITL plan approval
  | 'agent_hitl_enabled'
  | 'agent_hitl_min_tasks'
  | 'agent_hitl_timeout_seconds'
  // Streaming configuration
  | 'streaming_keepalive_interval'
  | 'streaming_max_duration'
  | 'streaming_tool_timeout'
  // Agent Bots
  | 'agent-bots-settings'
  // LLM Fallback
  | 'llm-fallback-settings'
  // Credentials Authentication
  | 'credentials-auth-settings'
  // Backup Schedule
  | 'backup-schedule'
  // LLM Routes
  | 'routes-settings'
  // Speech (STT + TTS)
  | 'speech-settings';

// ============ Speech Settings Types ============

export type SttProvider = 'openai' | 'fireworks' | 'mistral' | 'gemini';
export type TtsProvider = 'openai' | 'gemini';

/** Which STT providers are reachable on each route */
export const ROUTE_STT_PROVIDERS: Record<string, SttProvider[]> = {
  route1: ['openai', 'gemini', 'mistral'],
  route2: ['fireworks'],
};

export interface SttRouteConfig {
  default: SttProvider;
  fallback: SttProvider | 'none';
}

export interface SttProviderConfig {
  enabled: boolean;
  model: string;
}

export interface TtsProviderConfig {
  enabled: boolean;
}

export interface SpeechSettings {
  stt: {
    defaultRoute: 'route1' | 'route2';
    routes: {
      route1: SttRouteConfig;
      route2: SttRouteConfig;
    };
    providers: Record<SttProvider, SttProviderConfig>;
    recording: {
      minDurationSeconds: number;
      maxDurationSeconds: number;
    };
  };
  tts: {
    primaryProvider: TtsProvider;
    fallbackProvider: TtsProvider | 'none';
    providers: Record<TtsProvider, TtsProviderConfig>;
  };
}

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  stt: {
    defaultRoute: 'route1',
    routes: {
      route1: { default: 'openai', fallback: 'gemini' },
      route2: { default: 'fireworks', fallback: 'none' },
    },
    providers: {
      openai:    { enabled: true,  model: 'whisper-1' },
      fireworks: { enabled: false, model: 'whisper-v3' },
      mistral:   { enabled: false, model: 'voxtral-mini-transcribe-v2' },
      gemini:    { enabled: false, model: 'gemini-2.5-flash' },
    },
    recording: { minDurationSeconds: 3, maxDurationSeconds: 120 },
  },
  tts: {
    primaryProvider: 'openai',
    fallbackProvider: 'none',
    providers: {
      openai: { enabled: true },
      gemini: { enabled: false },
    },
  },
};

// ============ Generic Operations ============

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
  updated_by: string | null;
}

/**
 * Get a setting by key
 */
export function getSetting<T>(key: SettingKey): T | undefined;
export function getSetting<T>(key: SettingKey, defaultValue: T): T;
export function getSetting<T>(key: SettingKey, defaultValue?: T): T | undefined {
  const row = queryOne<SettingRow>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  );
  if (!row) return defaultValue;

  try {
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Set a setting value
 */
export function setSetting<T>(key: SettingKey, value: T, updatedBy?: string): void {
  execute(`
    INSERT INTO settings (key, value, updated_by, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = CURRENT_TIMESTAMP
  `, [key, JSON.stringify(value), updatedBy || null]);
}

/**
 * Delete a setting (reset to config default)
 */
export function deleteSetting(key: SettingKey): void {
  execute('DELETE FROM settings WHERE key = ?', [key]);
}

/**
 * Get setting metadata (without parsing value)
 */
export function getSettingMetadata(key: SettingKey): {
  updatedAt: string;
  updatedBy: string | null;
} | undefined {
  const row = queryOne<SettingRow>(
    'SELECT updated_at, updated_by FROM settings WHERE key = ?',
    [key]
  );
  if (!row) return undefined;

  return {
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

// ============ Typed Getters ============

/**
 * Get RAG settings
 * Priority: SQLite > JSON config > hardcoded defaults
 */
export function getRagSettings(): RagSettings {
  const dbSettings = getSetting<Partial<RagSettings>>('rag-settings');

  // Fall back to JSON config for base values
  const config = loadConfig();
  const defaults = config.rag;

  // Merge with defaults to ensure new fields have values (backward compatibility)
  return {
    ...defaults,
    // Provide defaults for new chunking fields if not in config
    chunkingStrategy: 'recursive',
    semanticBreakpointThreshold: 0.5,
    // Override with database settings if present
    ...dbSettings,
  };
}

/**
 * Get LLM settings
 * Priority: SQLite > JSON config > hardcoded defaults
 */
export function getLlmSettings(): LlmSettings {
  const dbSettings = getSetting<LlmSettings>('llm-settings');
  if (dbSettings) return dbSettings;

  // Fall back to JSON config
  const config = loadConfig();
  return config.llm;
}

/**
 * Get Tavily settings
 * Priority: SQLite > JSON config > hardcoded defaults
 */
export function getTavilySettings(): TavilySettings {
  const dbSettings = getSetting<TavilySettings>('tavily-settings');
  if (dbSettings) return dbSettings;

  // Fall back to JSON config
  const config = loadConfig();
  return config.tavily;
}

/**
 * Get upload limits
 * Priority: SQLite > JSON config > hardcoded defaults
 */
export function getUploadLimits(): UploadLimits {
  const dbSettings = getSetting<UploadLimits>('upload-limits');
  if (dbSettings) return dbSettings;

  // Fall back to JSON config
  const config = loadConfig();
  return config.upload;
}

/**
 * Get system prompt
 * Priority: SQLite > JSON config (system-prompt.md) > hardcoded defaults
 *
 * Auto-syncs with file: If system-prompt.md has changed since the SQLite
 * value was saved (detected via hash), the SQLite entry is cleared and
 * the new file content is used. This ensures builds with updated prompts
 * automatically take effect.
 */
export function getSystemPrompt(): string {
  const setting = getSetting<SystemPrompt>('system-prompt');

  if (setting?.content) {
    // Check if the config file has changed since this prompt was saved
    const currentFileHash = getSystemPromptFileHash();

    if (setting.fileHash && setting.fileHash !== currentFileHash) {
      // File has changed - clear SQLite to use new file version
      console.log('[Config] System prompt file changed (hash mismatch), syncing to new version');
      deleteSetting('system-prompt');
      return loadSystemPrompt();
    }

    return setting.content;
  }

  // Fall back to JSON config (loads from system-prompt.md)
  return loadSystemPrompt();
}

/**
 * Get acronym mappings
 * Priority: SQLite > JSON config > empty
 */
export function getAcronymMappings(): AcronymMappings {
  const dbSettings = getSetting<AcronymMappings>('acronym-mappings');
  if (dbSettings) return dbSettings;

  // Fall back to JSON config (convert string values to string[] for compatibility)
  const config = loadConfig();
  const mappings: AcronymMappings = {};
  for (const [key, value] of Object.entries(config.acronyms)) {
    mappings[key] = [value];
  }
  return mappings;
}

/**
 * Get retention settings
 * Priority: SQLite > JSON config > hardcoded defaults
 */
export function getRetentionSettings(): RetentionSettings {
  const dbSettings = getSetting<RetentionSettings>('retention-settings');
  if (dbSettings) return dbSettings;

  // Fall back to JSON config
  const config = loadConfig();
  return config.retention;
}

/**
 * Get branding settings
 * Priority: SQLite > JSON config > hardcoded defaults
 */
export function getBrandingSettings(): BrandingSettings {
  const dbSettings = getSetting<BrandingSettings>('branding-settings');
  if (dbSettings) return dbSettings;

  // Fall back to JSON config
  const config = loadConfig();
  return config.branding;
}

/** Default fallback embedding model (OpenAI Large - most reliable) */
export const DEFAULT_FALLBACK_EMBEDDING_MODEL = 'text-embedding-3-large';

/**
 * Get embedding settings
 * Priority: SQLite > JSON config > hardcoded defaults
 */
export function getEmbeddingSettings(): EmbeddingSettings {
  const dbSettings = getSetting<EmbeddingSettings>('embedding-settings');
  if (dbSettings) {
    // Ensure fallbackModel has a default
    return {
      ...dbSettings,
      fallbackModel: dbSettings.fallbackModel || DEFAULT_FALLBACK_EMBEDDING_MODEL,
    };
  }

  // Fall back to JSON config
  const config = loadConfig();
  return {
    ...config.embedding,
    fallbackModel: config.embedding?.fallbackModel || DEFAULT_FALLBACK_EMBEDDING_MODEL,
  };
}

/**
 * Get reranker settings
 * Priority: SQLite > JSON config > hardcoded defaults
 * Handles backward compatibility for old 'provider' field
 */
export function getRerankerSettings(): RerankerSettings {
  const dbSettings = getSetting<RerankerSettings & { provider?: string }>('reranker-settings');
  if (dbSettings) {
    // Handle backward compatibility: migrate old 'provider' field to 'providers' array
    if (!dbSettings.providers && (dbSettings as { provider?: string }).provider) {
      const oldProvider = (dbSettings as { provider?: string }).provider;
      // Map old provider names to new ones
      const providerMap: Record<string, RerankerProvider> = {
        'jina': 'bge-large',  // Jina is replaced by BGE
        'cohere': 'cohere',
        'local': 'local',
      };
      const mappedProvider = providerMap[oldProvider!] || 'bge-large';

      // Return with migrated providers array
      return {
        ...DEFAULT_RERANKER_SETTINGS,
        ...dbSettings,
        providers: [
          { provider: mappedProvider, enabled: true },
          ...DEFAULT_RERANKER_SETTINGS.providers.filter(p => p.provider !== mappedProvider),
        ],
      };
    }
    return dbSettings;
  }

  // Fall back to hardcoded defaults (config.reranker may have old format)
  return DEFAULT_RERANKER_SETTINGS;
}

/**
 * Get memory settings
 * Priority: SQLite > JSON config > hardcoded defaults
 */
export function getMemorySettings(): MemorySettings {
  const hardcoded: MemorySettings = {
    enabled: false,
    extractionThreshold: 5,
    maxFactsPerCategory: 20,
    autoExtractOnThreadEnd: true,
    extractionMaxTokens: 1000,
  };
  const config = loadConfig();
  const base = config.memory ? { ...hardcoded, ...config.memory } : hardcoded;
  const dbSettings = getSetting<Partial<MemorySettings>>('memory-settings');
  if (!dbSettings) return base;
  // Merge with base so that new fields (like extractionMaxTokens) always have a value
  return { ...base, ...dbSettings };
}

/**
 * Get summarization settings
 * Priority: SQLite > JSON config > hardcoded defaults
 */
export function getSummarizationSettings(): SummarizationSettings {
  const dbSettings = getSetting<SummarizationSettings>('summarization-settings');
  if (dbSettings) return dbSettings;

  // Fall back to JSON config
  const config = loadConfig();
  return config.summarization || {
    enabled: false,
    tokenThreshold: 100000,
    keepRecentMessages: 10,
    summaryMaxTokens: 2000,
    archiveOriginalMessages: true,
  };
}

/**
 * Get skills settings
 * Priority: SQLite > hardcoded defaults
 */
export function getSkillsSettings(): SkillsSettings {
  const dbSettings = getSetting<SkillsSettings>('skills-settings');
  if (dbSettings) return dbSettings;

  return {
    enabled: false,
    maxTotalTokens: 3000,
    debugMode: false,
  };
}

/**
 * Get OCR/document processing settings
 * Controls which OCR providers are enabled and their priority order
 * Priority: SQLite > hardcoded defaults
 */
export function getOcrSettings(): OcrSettings {
  const dbSettings = getSetting<OcrSettings>('ocr-settings');
  if (dbSettings) return dbSettings;
  return DEFAULT_OCR_SETTINGS;
}

/**
 * Get limits settings
 * Priority: SQLite > JSON config > hardcoded defaults
 */
export function getLimitsSettings(): LimitsSettings {
  const dbSettings = getSetting<LimitsSettings>('limits-settings');
  if (dbSettings) return dbSettings;

  // Fall back to JSON config
  const config = loadConfig();
  return {
    conversationHistoryMessages: config.limits?.conversationHistoryMessages ?? 5,
    maxTotalToolCalls: 50,
    maxPerToolCalls: 10,
  };
}

/**
 * Get consolidated token limits settings
 * Priority: SQLite > legacy settings locations > hardcoded defaults
 *
 * This consolidates all token/prompt limits in one place.
 * Falls back to reading from legacy locations for backward compatibility.
 */
export function getTokenLimitsSettings(): TokenLimitsSettings {
  const dbSettings = getSetting<TokenLimitsSettings>('token-limits-settings');
  if (dbSettings) return dbSettings;

  // Fall back to legacy locations for backward compatibility
  const llmSettings = getLlmSettings();
  const skillsSettings = getSkillsSettings();
  const memorySettings = getMemorySettings();
  const summarizationSettings = getSummarizationSettings();

  return {
    // From legacy settings
    promptOptimizationMaxTokens: llmSettings.promptOptimizationMaxTokens || 2000,
    skillsMaxTotalTokens: skillsSettings.maxTotalTokens || 3000,
    memoryExtractionMaxTokens: memorySettings.extractionMaxTokens || 1000,
    summaryMaxTokens: summarizationSettings.summaryMaxTokens || 2000,

    // New settings with defaults (previously hardcoded as chars, now tokens)
    systemPromptMaxTokens: 2000,      // ~8000 chars / 4
    categoryPromptMaxTokens: 500,     // Portion of combined limit

    // Starter prompt limits (keep as chars)
    starterLabelMaxChars: 30,
    starterPromptMaxChars: 500,
    maxStartersPerCategory: 6,
  };
}

/**
 * Get model token limits
 * Returns the admin-configured per-model token limits
 */
export function getModelTokenLimits(): ModelTokenLimits {
  const dbSettings = getSetting<ModelTokenLimits>('model-token-limits');
  return dbSettings || {};
}

/**
 * Get the effective max tokens for a specific model
 * Priority: enabled_models.max_output_tokens > Provider default > Fallback
 *
 * Note: max_output_tokens is set during model discovery and can be edited
 * in the enabled models table (Settings → LLM)
 */
export function getEffectiveMaxTokens(model: string): number {
  // Check enabled_models.max_output_tokens (set during discovery)
  const enabledModel = getEnabledModel(model);
  if (enabledModel?.maxOutputTokens) {
    return enabledModel.maxOutputTokens;
  }

  // Fall back to provider-based default
  if (enabledModel?.providerId) {
    return getDefaultOutputTokens(enabledModel.providerId);
  }

  // Ultimate fallback
  return 16000;
}

/**
 * Get PWA settings
 * Priority: SQLite > hardcoded defaults
 */
export function getPWASettings(): PWASettings {
  const dbSettings = getSetting<PWASettings>('pwa-settings');
  if (dbSettings) return dbSettings;
  return DEFAULT_PWA_SETTINGS;
}

/**
 * Get superuser settings
 * Priority: SQLite > hardcoded defaults
 */
export function getSuperuserSettings(): SuperuserSettings {
  const dbSettings = getSetting<SuperuserSettings>('superuser-settings');
  if (dbSettings) return dbSettings;
  return {
    maxCategoriesPerSuperuser: 5,
  };
}

/**
 * Get agent bots settings
 * Priority: SQLite > hardcoded defaults
 */
export function getAgentBotsSettings(): AgentBotsSettings {
  const dbSettings = getSetting<AgentBotsSettings>('agent-bots-settings');
  if (dbSettings) return dbSettings;
  return {
    enabled: true,
    maxJobsPerMinute: 100,
    maxJobsPerDay: 10000,
    defaultRateLimitRpm: 60,
    defaultRateLimitRpd: 1000,
    maxOutputSizeMB: 50,
    jobRetentionDays: 30,
  };
}

/**
 * Update agent bots settings
 */
export function updateAgentBotsSettings(
  settings: Partial<AgentBotsSettings>,
  updatedBy?: string
): AgentBotsSettings {
  const current = getAgentBotsSettings();
  const updated = { ...current, ...settings };
  setSetting('agent-bots-settings', updated, updatedBy);
  return updated;
}

/**
 * Get LLM fallback settings
 * Priority: SQLite > auto-detect first capable model > hardcoded defaults
 */
export function getLlmFallbackSettings(): LlmFallbackSettings {
  const dbSettings = getSetting<LlmFallbackSettings>('llm-fallback-settings');
  if (dbSettings) return dbSettings;

  // Default: find first model with both vision + tools capability
  try {
    const activeModels = getActiveModels();
    const universalModel = activeModels.find(m => m.visionCapable && m.toolCapable);

    return {
      universalFallback: universalModel?.id || null,
      maxRetryAttempts: 2,
      healthCacheDuration: 'hourly',
    };
  } catch {
    // Fallback if getActiveModels fails
    return {
      universalFallback: null,
      maxRetryAttempts: 2,
      healthCacheDuration: 'hourly',
    };
  }
}

/**
 * Update LLM fallback settings
 */
export function setLlmFallbackSettings(
  settings: Partial<LlmFallbackSettings>,
  updatedBy?: string
): LlmFallbackSettings {
  const current = getLlmFallbackSettings();
  const updated = { ...current, ...settings };
  setSetting('llm-fallback-settings', updated, updatedBy);
  return updated;
}

// ============ Typed Setters ============

/**
 * Update RAG settings
 */
export function setRagSettings(settings: Partial<RagSettings>, updatedBy?: string): RagSettings {
  const current = getRagSettings();
  const updated = { ...current, ...settings };
  setSetting('rag-settings', updated, updatedBy);
  return updated;
}

/**
 * Update LLM settings
 */
export function setLlmSettings(settings: Partial<LlmSettings>, updatedBy?: string): LlmSettings {
  const current = getLlmSettings();
  const updated = { ...current, ...settings };
  setSetting('llm-settings', updated, updatedBy);
  return updated;
}

/**
 * Update Tavily settings
 */
export function setTavilySettings(settings: Partial<TavilySettings>, updatedBy?: string): TavilySettings {
  const current = getTavilySettings();
  const updated = { ...current, ...settings };
  setSetting('tavily-settings', updated, updatedBy);
  return updated;
}

/**
 * Update upload limits
 */
export function setUploadLimits(limits: Partial<UploadLimits>, updatedBy?: string): UploadLimits {
  const current = getUploadLimits();
  const updated = { ...current, ...limits };
  setSetting('upload-limits', updated, updatedBy);
  return updated;
}

/**
 * Update system prompt
 * Stores the current file hash so we can detect when the file changes
 */
export function setSystemPrompt(content: string, updatedBy?: string): void {
  const fileHash = getSystemPromptFileHash();
  setSetting('system-prompt', { content, fileHash }, updatedBy);
}

/**
 * Update acronym mappings
 */
export function setAcronymMappings(mappings: AcronymMappings, updatedBy?: string): void {
  setSetting('acronym-mappings', mappings, updatedBy);
}

/**
 * Update retention settings
 */
export function setRetentionSettings(settings: Partial<RetentionSettings>, updatedBy?: string): RetentionSettings {
  const current = getRetentionSettings();
  const updated = { ...current, ...settings };
  setSetting('retention-settings', updated, updatedBy);
  return updated;
}

/**
 * Update branding settings
 */
export function setBrandingSettings(settings: Partial<BrandingSettings>, updatedBy?: string): BrandingSettings {
  const current = getBrandingSettings();
  const updated = { ...current, ...settings };
  setSetting('branding-settings', updated, updatedBy);
  return updated;
}

/**
 * Update embedding settings
 */
export function setEmbeddingSettings(settings: Partial<EmbeddingSettings>, updatedBy?: string): EmbeddingSettings {
  const current = getEmbeddingSettings();
  const updated = { ...current, ...settings };
  setSetting('embedding-settings', updated, updatedBy);
  return updated;
}

/**
 * Update reranker settings
 */
export function setRerankerSettings(settings: Partial<RerankerSettings>, updatedBy?: string): RerankerSettings {
  const current = getRerankerSettings();
  const updated = { ...current, ...settings };
  setSetting('reranker-settings', updated, updatedBy);
  return updated;
}

/**
 * Update memory settings
 */
export function setMemorySettings(settings: Partial<MemorySettings>, updatedBy?: string): MemorySettings {
  const current = getMemorySettings();
  const updated = { ...current, ...settings };
  setSetting('memory-settings', updated, updatedBy);
  return updated;
}

/**
 * Update summarization settings
 */
export function setSummarizationSettings(settings: Partial<SummarizationSettings>, updatedBy?: string): SummarizationSettings {
  const current = getSummarizationSettings();
  const updated = { ...current, ...settings };
  setSetting('summarization-settings', updated, updatedBy);
  return updated;
}

/**
 * Update skills settings
 */
export function setSkillsSettings(settings: Partial<SkillsSettings>, updatedBy?: string): SkillsSettings {
  const current = getSkillsSettings();
  const updated = { ...current, ...settings };
  setSetting('skills-settings', updated, updatedBy);
  return updated;
}

/**
 * Update OCR/document processing settings
 * Merges with existing settings to preserve credentials not being updated
 */
export function setOcrSettings(settings: Partial<OcrSettings>, updatedBy?: string): OcrSettings {
  const current = getOcrSettings();
  const updated: OcrSettings = {
    ...current,
    ...settings,
    // Ensure providers is always set (required field)
    providers: settings.providers || current.providers,
  };
  setSetting('ocr-settings', updated, updatedBy);
  return updated;
}

/**
 * Update limits settings
 */
export function setLimitsSettings(settings: Partial<LimitsSettings>, updatedBy?: string): LimitsSettings {
  const current = getLimitsSettings();
  const updated = { ...current, ...settings };
  setSetting('limits-settings', updated, updatedBy);
  return updated;
}

/**
 * Update consolidated token limits settings
 * Also syncs to legacy settings locations for backward compatibility
 */
export function setTokenLimitsSettings(settings: Partial<TokenLimitsSettings>, updatedBy?: string): TokenLimitsSettings {
  const current = getTokenLimitsSettings();
  const updated = { ...current, ...settings };
  setSetting('token-limits-settings', updated, updatedBy);

  // Sync to legacy settings for backward compatibility
  if (settings.promptOptimizationMaxTokens !== undefined) {
    setLlmSettings({ promptOptimizationMaxTokens: settings.promptOptimizationMaxTokens }, updatedBy);
  }
  if (settings.skillsMaxTotalTokens !== undefined) {
    setSkillsSettings({ maxTotalTokens: settings.skillsMaxTotalTokens }, updatedBy);
  }
  if (settings.memoryExtractionMaxTokens !== undefined) {
    setMemorySettings({ extractionMaxTokens: settings.memoryExtractionMaxTokens }, updatedBy);
  }
  if (settings.summaryMaxTokens !== undefined) {
    setSummarizationSettings({ summaryMaxTokens: settings.summaryMaxTokens }, updatedBy);
  }

  return updated;
}

/**
 * Update a single model's token limit
 */
export function setModelTokenLimit(model: string, limit: number | 'default', updatedBy?: string): ModelTokenLimits {
  const current = getModelTokenLimits();

  if (limit === 'default') {
    // Remove the override to use preset default
    delete current[model];
  } else {
    current[model] = limit;
  }

  setSetting('model-token-limits', current, updatedBy);
  return current;
}

/**
 * Update all model token limits at once
 */
export function setModelTokenLimits(limits: ModelTokenLimits, updatedBy?: string): ModelTokenLimits {
  setSetting('model-token-limits', limits, updatedBy);
  return limits;
}

/**
 * Update PWA settings
 */
export function setPWASettings(settings: Partial<PWASettings>, updatedBy?: string): PWASettings {
  const current = getPWASettings();
  const updated = { ...current, ...settings, updatedAt: new Date().toISOString(), updatedBy };
  setSetting('pwa-settings', updated, updatedBy);
  return updated;
}

/**
 * Update superuser settings
 */
export function setSuperuserSettings(settings: Partial<SuperuserSettings>, updatedBy?: string): SuperuserSettings {
  const current = getSuperuserSettings();
  const updated = { ...current, ...settings };
  setSetting('superuser-settings', updated, updatedBy);
  return updated;
}

/**
 * Get credentials auth settings
 */
export function getCredentialsAuthSettings(): CredentialsAuthSettings {
  const dbSettings = getSetting<Partial<CredentialsAuthSettings>>('credentials-auth-settings');
  return {
    ...DEFAULT_CREDENTIALS_AUTH_SETTINGS,
    ...dbSettings,
  };
}

/**
 * Update credentials auth settings
 */
export function setCredentialsAuthSettings(
  settings: Partial<CredentialsAuthSettings>,
  updatedBy?: string
): CredentialsAuthSettings {
  const current = getCredentialsAuthSettings();
  const updated = { ...current, ...settings };
  setSetting('credentials-auth-settings', updated, updatedBy);
  return updated;
}

// ============ Default System Prompt ============

/**
 * Get default system prompt from config file
 * This is used when no custom prompt is set in SQLite
 */
export function getDefaultSystemPrompt(): string {
  return loadSystemPrompt();
}

// ============ Bulk Operations ============

/**
 * Get all settings as a combined object
 */
export function getAllSettings(): {
  rag: RagSettings;
  llm: LlmSettings;
  tavily: TavilySettings;
  uploadLimits: UploadLimits;
  systemPrompt: string;
  acronymMappings: AcronymMappings;
  retention: RetentionSettings;
  branding: BrandingSettings;
  embedding: EmbeddingSettings;
  reranker: RerankerSettings;
  memory: MemorySettings;
  summarization: SummarizationSettings;
  skills: SkillsSettings;
  ocr: OcrSettings;
} {
  return {
    rag: getRagSettings(),
    llm: getLlmSettings(),
    tavily: getTavilySettings(),
    uploadLimits: getUploadLimits(),
    systemPrompt: getSystemPrompt(),
    acronymMappings: getAcronymMappings(),
    retention: getRetentionSettings(),
    branding: getBrandingSettings(),
    embedding: getEmbeddingSettings(),
    reranker: getRerankerSettings(),
    memory: getMemorySettings(),
    summarization: getSummarizationSettings(),
    skills: getSkillsSettings(),
    ocr: getOcrSettings(),
  };
}

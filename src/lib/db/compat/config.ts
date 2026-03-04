/**
 * Configuration Database Operations - Async Compatibility Layer
 *
 * Uses Kysely query builder for PostgreSQL.
 * Default values are sourced from ../config (which reads config-loader / hardcoded defaults).
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../kysely';

// Import runtime functions and constants used as fallback defaults
import {
  getRagSettings as getDefaultRagSettings,
  getTavilySettings as getDefaultTavilySettings,
  getUploadLimits as getDefaultUploadLimits,
  getDefaultSystemPrompt as getDefaultSystemPromptSync,
  getAcronymMappings as getDefaultAcronymMappings,
  getRetentionSettings as getDefaultRetentionSettings,
  getBrandingSettings as getDefaultBrandingSettings,
  getEmbeddingSettings as getDefaultEmbeddingSettings,
  DEFAULT_RERANKER_SETTINGS,
  getMemorySettings as getDefaultMemorySettings,
  getSummarizationSettings as getDefaultSummarizationSettings,
  getSkillsSettings as getDefaultSkillsSettings,
  DEFAULT_OCR_SETTINGS,
  getLimitsSettings as getDefaultLimitsSettings,
  getAvailableModels as getDefaultAvailableModels,
  getEffectiveMaxTokens as getEffectiveMaxTokensSync,
  DEFAULT_PWA_SETTINGS as DEFAULT_PWA_SETTINGS_VAL,
  getAgentBotsSettings as getDefaultAgentBotsSettings,
  DEFAULT_CREDENTIALS_AUTH_SETTINGS as DEFAULT_CREDENTIALS_AUTH_SETTINGS_VAL,
  getLlmFallbackSettings as getDefaultLlmFallbackSettings,
} from '../config';

import type {
  RagSettings,
  LlmSettings,
  TavilySettings,
  UploadLimits,
  SystemPrompt,
  RetentionSettings,
  AcronymMappings,
  BrandingSettings,
  EmbeddingSettings,
  RerankerSettings,
  RerankerProvider,
  MemorySettings,
  SummarizationSettings,
  SkillsSettings,
  OcrSettings,
  LimitsSettings,
  TokenLimitsSettings,
  ModelTokenLimits,
  AvailableModel,
  SettingKey,
  PWASettings,
  SuperuserSettings,
  AgentBotsSettings,
  CredentialsAuthSettings,
  LlmFallbackSettings,
  RerankerProviderConfig,
} from '../config';

import type { ToolConfig } from '../tool-config';

// Re-export all types
export type {
  RagSettings,
  LlmSettings,
  TavilySettings,
  UploadLimits,
  SystemPrompt,
  RetentionSettings,
  AcronymMappings,
  BrandingSettings,
  PWASettings,
  EmbeddingSettings,
  RerankerSettings,
  MemorySettings,
  SummarizationSettings,
  SkillsSettings,
  OcrProvider,
  OcrProviderConfig,
  OcrSettings,
  RerankerProvider,
  RerankerProviderConfig,
  SuperuserSettings,
  LimitsSettings,
  TokenLimitsSettings,
  ModelTokenLimits,
  AvailableModel,
  SettingKey,
  AgentBotsSettings,
  CredentialsAuthSettings,
  LlmFallbackSettings,
} from '../config';

// Re-export constants
export {
  DEFAULT_PWA_SETTINGS,
  DEFAULT_OCR_SETTINGS,
  BRANDING_ICONS,
  DEFAULT_MODEL_ID,
  DEFAULT_CREDENTIALS_AUTH_SETTINGS,
} from '../config';

// Re-export ToolConfig type
export type { ToolConfig } from '../tool-config';

// ============ Core Operations ============

export async function getSetting<T>(key: SettingKey): Promise<T | undefined>;
export async function getSetting<T>(key: SettingKey, defaultValue: T): Promise<T>;
export async function getSetting<T>(key: SettingKey, defaultValue?: T): Promise<T | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('settings')
    .select('value')
    .where('key', '=', key)
    .executeTakeFirst();

  if (!row) return defaultValue;

  try {
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}

export async function setSetting<T>(key: SettingKey, value: T, updatedBy?: string): Promise<void> {
  const db = await getDb();
  await db
    .insertInto('settings')
    .values({
      key,
      value: JSON.stringify(value),
      updated_by: updatedBy || null,
    })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet({
        value: JSON.stringify(value),
        updated_by: updatedBy || null,
        updated_at: new Date().toISOString(),
      })
    )
    .execute();
}

export async function deleteSetting(key: SettingKey): Promise<void> {
  const db = await getDb();
  await db.deleteFrom('settings').where('key', '=', key).execute();
}

export async function getSettingMetadata(
  key: SettingKey
): Promise<{ updatedAt: string; updatedBy: string | null } | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('settings')
    .select(['updated_at', 'updated_by'])
    .where('key', '=', key)
    .executeTakeFirst();

  if (!row) return undefined;
  return {
    updatedAt: row.updated_at as string,
    updatedBy: row.updated_by,
  };
}

// ============ Typed Getters ============
// Read from the Postgres settings table; if not found, use config-loader defaults.

export async function getRagSettings(): Promise<RagSettings> {
  const pg = await getSetting<Partial<RagSettings>>('rag-settings');
  if (!pg) return getDefaultRagSettings();
  // Merge with config defaults (same logic as sync module)
  const { loadConfig } = await import('../../config-loader');
  const config = loadConfig();
  return { ...config.rag, chunkingStrategy: 'recursive', semanticBreakpointThreshold: 0.5, ...pg };
}

export async function getLlmSettings(): Promise<LlmSettings> {
  const stored = await getSetting<Partial<LlmSettings>>('llm-settings');
  // Fall back to config-loader defaults
  const { loadConfig } = await import('../../config-loader');
  const defaults = loadConfig().llm;
  if (!stored) return defaults;
  return { ...defaults, ...stored };
}

export async function getTavilySettings(): Promise<TavilySettings> {
  const stored = await getSetting<Partial<TavilySettings>>('tavily-settings');
  if (!stored) return getDefaultTavilySettings();
  return { ...getDefaultTavilySettings(), ...stored };
}

export async function getUploadLimits(): Promise<UploadLimits> {
  const stored = await getSetting<Partial<UploadLimits>>('upload-limits');
  if (!stored) return getDefaultUploadLimits();
  return { ...getDefaultUploadLimits(), ...stored };
}

export async function getSystemPrompt(): Promise<string> {
  const setting = await getSetting<SystemPrompt>('system-prompt');
  if (!setting?.content) return getDefaultSystemPromptSync();
  const { getSystemPromptFileHash, loadSystemPrompt } = await import('../../config-loader');
  const currentHash = getSystemPromptFileHash();
  if (setting.fileHash && setting.fileHash !== currentHash) {
    await deleteSetting('system-prompt');
    return loadSystemPrompt();
  }
  return setting.content;
}

export async function getAcronymMappings(): Promise<AcronymMappings> {
  return await getSetting<AcronymMappings>('acronym-mappings') ?? getDefaultAcronymMappings();
}

export async function getRetentionSettings(): Promise<RetentionSettings> {
  const stored = await getSetting<Partial<RetentionSettings>>('retention-settings');
  if (!stored) return getDefaultRetentionSettings();
  return { ...getDefaultRetentionSettings(), ...stored };
}

export async function getBrandingSettings(): Promise<BrandingSettings> {
  const stored = await getSetting<Partial<BrandingSettings>>('branding-settings');
  if (!stored) return getDefaultBrandingSettings();
  return { ...getDefaultBrandingSettings(), ...stored };
}

export async function getEmbeddingSettings(): Promise<EmbeddingSettings> {
  const pg = await getSetting<EmbeddingSettings>('embedding-settings');
  if (pg) return { ...pg, fallbackModel: pg.fallbackModel || 'text-embedding-3-large' };
  return getDefaultEmbeddingSettings();
}

export async function getRerankerSettings(): Promise<RerankerSettings> {
  const pg = await getSetting<RerankerSettings & { provider?: string }>('reranker-settings');
  if (!pg) return DEFAULT_RERANKER_SETTINGS;
  // Backward compat: migrate old 'provider' field to 'providers' array
  if (!pg.providers && (pg as { provider?: string }).provider) {
    const oldProvider = (pg as { provider?: string }).provider!;
    const providerMap: Record<string, RerankerProvider> = { jina: 'bge-large', cohere: 'cohere', local: 'local' };
    const mapped = providerMap[oldProvider] || 'bge-large';
    return {
      ...DEFAULT_RERANKER_SETTINGS,
      ...pg,
      providers: [{ provider: mapped, enabled: true }, ...DEFAULT_RERANKER_SETTINGS.providers.filter(p => p.provider !== mapped)],
    };
  }
  return pg;
}

export async function getMemorySettings(): Promise<MemorySettings> {
  const stored = await getSetting<Partial<MemorySettings>>('memory-settings');
  if (!stored) return getDefaultMemorySettings();
  return { ...getDefaultMemorySettings(), ...stored };
}

export async function getSummarizationSettings(): Promise<SummarizationSettings> {
  const stored = await getSetting<Partial<SummarizationSettings>>('summarization-settings');
  if (!stored) return getDefaultSummarizationSettings();
  return { ...getDefaultSummarizationSettings(), ...stored };
}

export async function getSkillsSettings(): Promise<SkillsSettings> {
  const stored = await getSetting<Partial<SkillsSettings>>('skills-settings');
  if (!stored) return getDefaultSkillsSettings();
  return { ...getDefaultSkillsSettings(), ...stored };
}

export async function getOcrSettings(): Promise<OcrSettings> {
  const stored = await getSetting<Partial<OcrSettings>>('ocr-settings');
  if (!stored) return DEFAULT_OCR_SETTINGS;
  return { ...DEFAULT_OCR_SETTINGS, ...stored };
}

export async function getLimitsSettings(): Promise<LimitsSettings> {
  const stored = await getSetting<Partial<LimitsSettings>>('limits-settings');
  if (!stored) return getDefaultLimitsSettings();
  return { ...getDefaultLimitsSettings(), ...stored };
}

export async function getTokenLimitsSettings(): Promise<TokenLimitsSettings> {
  const pg = await getSetting<Partial<TokenLimitsSettings>>('token-limits-settings');
  // Legacy fallback across individual settings (used when token-limits-settings not set,
  // or to fill in any missing fields in a stored but incomplete value)
  const [llm, skills, memory, sum] = await Promise.all([
    getLlmSettings(),
    getSkillsSettings(),
    getMemorySettings(),
    getSummarizationSettings(),
  ]);
  const legacyDefaults: TokenLimitsSettings = {
    promptOptimizationMaxTokens: llm.promptOptimizationMaxTokens || 2000,
    skillsMaxTotalTokens: skills.maxTotalTokens || 3000,
    memoryExtractionMaxTokens: (memory as { extractionMaxTokens?: number }).extractionMaxTokens || 1000,
    summaryMaxTokens: sum.summaryMaxTokens || 2000,
    systemPromptMaxTokens: 2000,
    categoryPromptMaxTokens: 500,
    starterLabelMaxChars: 30,
    starterPromptMaxChars: 500,
    maxStartersPerCategory: 6,
  };
  if (!pg) return legacyDefaults;
  return { ...legacyDefaults, ...pg };
}

export async function getModelTokenLimits(): Promise<ModelTokenLimits> {
  return await getSetting<ModelTokenLimits>('model-token-limits') ?? {};
}

export async function getEffectiveMaxTokens(model: string): Promise<number> {
  return getEffectiveMaxTokensSync(model);
}

export async function getPWASettings(): Promise<PWASettings> {
  return await getSetting<PWASettings>('pwa-settings') ?? DEFAULT_PWA_SETTINGS_VAL;
}

export async function getSuperuserSettings(): Promise<SuperuserSettings> {
  return await getSetting<SuperuserSettings>('superuser-settings') ?? { maxCategoriesPerSuperuser: 5 };
}

// These query the enabled_models table (already compat), not the settings table
export async function getAvailableModels(): Promise<AvailableModel[]> {
  // Query enabled_models via compat layer
  const { hasEnabledModels, getActiveModels } = await import('./enabled-models');
  try {
    if (await hasEnabledModels()) {
      const dbModels = await getActiveModels();
      if (dbModels.length > 0) {
        return dbModels.map(model => ({
          id: model.id,
          name: model.displayName,
          description: `${model.providerId} model${model.toolCapable ? ' with tool support' : ''}${model.visionCapable ? ' and vision' : ''}`,
          provider: model.providerId as AvailableModel['provider'],
          defaultMaxTokens: model.maxInputTokens || 2000,
        }));
      }
    }
  } catch {
    // Fall through to YAML/preset discovery
  }
  // No models configured yet — fall back to YAML presets
  return getDefaultAvailableModels();
}

export async function isToolCapableModelFromDb(modelId: string): Promise<boolean> {
  const { getToolCapableModelIds } = await import('./enabled-models');
  const ids = await getToolCapableModelIds();
  return ids.has(modelId);
}

export async function getToolCapableModels(): Promise<Set<string>> {
  const { getToolCapableModelIds } = await import('./enabled-models');
  return getToolCapableModelIds();
}

export async function getDefaultSystemPrompt(): Promise<string> {
  return getDefaultSystemPromptSync();
}

// ============ Typed Setters ============
// Read-merge-write using async getSetting/setSetting (which target Postgres).

export async function setRagSettings(
  settings: Partial<RagSettings>,
  updatedBy?: string
): Promise<RagSettings> {
  const current = await getRagSettings();
  const merged = { ...current, ...settings };
  await setSetting('rag-settings', merged, updatedBy);
  return merged;
}

export async function setLlmSettings(
  settings: Partial<LlmSettings>,
  updatedBy?: string
): Promise<LlmSettings> {
  const current = await getLlmSettings();
  const merged = { ...current, ...settings };
  await setSetting('llm-settings', merged, updatedBy);
  return merged;
}

export async function setTavilySettings(
  settings: Partial<TavilySettings>,
  updatedBy?: string
): Promise<TavilySettings> {
  const current = await getTavilySettings();
  const merged = { ...current, ...settings };
  await setSetting('tavily-settings', merged, updatedBy);
  return merged;
}

export async function setUploadLimits(
  limits: Partial<UploadLimits>,
  updatedBy?: string
): Promise<UploadLimits> {
  const current = await getUploadLimits();
  const merged = { ...current, ...limits };
  await setSetting('upload-limits', merged, updatedBy);
  return merged;
}

export async function setSystemPrompt(content: string, updatedBy?: string): Promise<void> {
  const { getSystemPromptFileHash } = await import('../../config-loader');
  await setSetting<SystemPrompt>('system-prompt', { content, fileHash: getSystemPromptFileHash() }, updatedBy);
}

export async function setAcronymMappings(
  mappings: AcronymMappings,
  updatedBy?: string
): Promise<void> {
  await setSetting('acronym-mappings', mappings, updatedBy);
}

export async function setRetentionSettings(
  settings: Partial<RetentionSettings>,
  updatedBy?: string
): Promise<RetentionSettings> {
  const current = await getRetentionSettings();
  const merged = { ...current, ...settings };
  await setSetting('retention-settings', merged, updatedBy);
  return merged;
}

export async function setBrandingSettings(
  settings: Partial<BrandingSettings>,
  updatedBy?: string
): Promise<BrandingSettings> {
  const current = await getBrandingSettings();
  const merged = { ...current, ...settings };
  await setSetting('branding-settings', merged, updatedBy);
  return merged;
}

export async function setEmbeddingSettings(
  settings: Partial<EmbeddingSettings>,
  updatedBy?: string
): Promise<EmbeddingSettings> {
  const current = await getEmbeddingSettings();
  const merged = { ...current, ...settings };
  await setSetting('embedding-settings', merged, updatedBy);
  return merged;
}

export async function setRerankerSettings(
  settings: Partial<RerankerSettings>,
  updatedBy?: string
): Promise<RerankerSettings> {
  const current = await getRerankerSettings();
  const merged = { ...current, ...settings };
  await setSetting('reranker-settings', merged, updatedBy);
  return merged;
}

export async function setMemorySettings(
  settings: Partial<MemorySettings>,
  updatedBy?: string
): Promise<MemorySettings> {
  const current = await getMemorySettings();
  const merged = { ...current, ...settings };
  await setSetting('memory-settings', merged, updatedBy);
  return merged;
}

export async function setSummarizationSettings(
  settings: Partial<SummarizationSettings>,
  updatedBy?: string
): Promise<SummarizationSettings> {
  const current = await getSummarizationSettings();
  const merged = { ...current, ...settings };
  await setSetting('summarization-settings', merged, updatedBy);
  return merged;
}

export async function setSkillsSettings(
  settings: Partial<SkillsSettings>,
  updatedBy?: string
): Promise<SkillsSettings> {
  const current = await getSkillsSettings();
  const merged = { ...current, ...settings };
  await setSetting('skills-settings', merged, updatedBy);
  return merged;
}

export async function setOcrSettings(
  settings: Partial<OcrSettings>,
  updatedBy?: string
): Promise<OcrSettings> {
  const current = await getOcrSettings();
  const merged = { ...current, ...settings };
  await setSetting('ocr-settings', merged, updatedBy);
  return merged;
}

export async function setLimitsSettings(
  settings: Partial<LimitsSettings>,
  updatedBy?: string
): Promise<LimitsSettings> {
  const current = await getLimitsSettings();
  const merged = { ...current, ...settings };
  await setSetting('limits-settings', merged, updatedBy);
  return merged;
}

export async function setTokenLimitsSettings(
  settings: Partial<TokenLimitsSettings>,
  updatedBy?: string
): Promise<TokenLimitsSettings> {
  const current = await getTokenLimitsSettings();
  const merged = { ...current, ...settings };
  await setSetting('token-limits-settings', merged, updatedBy);
  return merged;
}

export async function setModelTokenLimit(
  model: string,
  limit: number | 'default',
  updatedBy?: string
): Promise<ModelTokenLimits> {
  const current = await getModelTokenLimits();
  const updated = { ...current, [model]: limit };
  await setSetting('model-token-limits', updated, updatedBy);
  return updated;
}

export async function setModelTokenLimits(
  limits: ModelTokenLimits,
  updatedBy?: string
): Promise<ModelTokenLimits> {
  await setSetting('model-token-limits', limits, updatedBy);
  return limits;
}

export async function setPWASettings(
  settings: Partial<PWASettings>,
  updatedBy?: string
): Promise<PWASettings> {
  const current = await getPWASettings();
  const merged = { ...current, ...settings };
  await setSetting('pwa-settings', merged, updatedBy);
  return merged;
}

export async function setSuperuserSettings(
  settings: Partial<SuperuserSettings>,
  updatedBy?: string
): Promise<SuperuserSettings> {
  const current = await getSuperuserSettings();
  const merged = { ...current, ...settings };
  await setSetting('superuser-settings', merged, updatedBy);
  return merged;
}

// ============ Agent Bots Settings ============

export async function getAgentBotsSettings(): Promise<AgentBotsSettings> {
  return await getSetting<AgentBotsSettings>('agent-bots-settings') ?? getDefaultAgentBotsSettings();
}

export async function updateAgentBotsSettings(
  settings: Partial<AgentBotsSettings>,
  updatedBy?: string
): Promise<AgentBotsSettings> {
  const current = await getAgentBotsSettings();
  const merged = { ...current, ...settings };
  await setSetting('agent-bots-settings', merged, updatedBy);
  return merged;
}

// ============ Credentials Auth Settings ============

export async function getCredentialsAuthSettings(): Promise<CredentialsAuthSettings> {
  return await getSetting<CredentialsAuthSettings>('credentials-auth-settings') ?? DEFAULT_CREDENTIALS_AUTH_SETTINGS_VAL;
}

export async function setCredentialsAuthSettings(
  settings: Partial<CredentialsAuthSettings>,
  updatedBy?: string
): Promise<CredentialsAuthSettings> {
  const current = await getCredentialsAuthSettings();
  const merged = { ...current, ...settings };
  await setSetting('credentials-auth-settings', merged, updatedBy);
  return merged;
}

// ============ LLM Fallback Settings ============

export async function getLlmFallbackSettings(): Promise<LlmFallbackSettings> {
  return await getSetting<LlmFallbackSettings>('llm-fallback-settings') ?? getDefaultLlmFallbackSettings();
}

export async function setLlmFallbackSettings(
  settings: Partial<LlmFallbackSettings>,
  updatedBy?: string
): Promise<LlmFallbackSettings> {
  const current = await getLlmFallbackSettings();
  const merged = { ...current, ...settings };
  await setSetting('llm-fallback-settings', merged, updatedBy);
  return merged;
}

// ============ Bulk Operations ============

export async function getAllSettings(): Promise<{
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
}> {
  const [rag, llm, tavily, uploadLimits, systemPrompt, acronymMappings, retention, branding, embedding, reranker, memory, summarization, skills, ocr] =
    await Promise.all([
      getRagSettings(),
      getLlmSettings(),
      getTavilySettings(),
      getUploadLimits(),
      getSystemPrompt(),
      getAcronymMappings(),
      getRetentionSettings(),
      getBrandingSettings(),
      getEmbeddingSettings(),
      getRerankerSettings(),
      getMemorySettings(),
      getSummarizationSettings(),
      getSkillsSettings(),
      getOcrSettings(),
    ]);
  return { rag, llm, tavily, uploadLimits, systemPrompt, acronymMappings, retention, branding, embedding, reranker, memory, summarization, skills, ocr };
}

// ============ Tool Config (async version) ============

/**
 * Get tool configuration by name (async version).
 * Reads from the tool_configs table in PostgreSQL.
 */
export async function getToolConfigAsync(toolName: string): Promise<ToolConfig | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('tool_configs')
    .select(['id', 'tool_name', 'is_enabled', 'config_json', 'description_override', 'created_at', 'updated_at', 'updated_by'])
    .where('tool_name', '=', toolName)
    .executeTakeFirst();

  if (!row) return undefined;

  return {
    id: row.id as string,
    toolName: row.tool_name as string,
    isEnabled: (row.is_enabled as number) === 1,
    config: JSON.parse(row.config_json as string),
    descriptionOverride: row.description_override as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    updatedBy: row.updated_by as string,
  };
}

/**
 * Upsert tool configuration in PostgreSQL (INSERT or UPDATE on conflict).
 */
export async function upsertToolConfigAsync(
  toolName: string,
  updates: {
    isEnabled: boolean;
    config: Record<string, unknown>;
    descriptionOverride?: string | null;
  },
  updatedBy: string
): Promise<void> {
  const db = await getDb();
  const id = uuidv4();
  const configJson = JSON.stringify(updates.config);
  const now = new Date().toISOString();
  await db
    .insertInto('tool_configs')
    .values({
      id,
      tool_name: toolName,
      is_enabled: updates.isEnabled ? 1 : 0,
      config_json: configJson,
      description_override: updates.descriptionOverride ?? null,
      updated_by: updatedBy,
    })
    .onConflict((oc) =>
      oc.column('tool_name').doUpdateSet({
        is_enabled: updates.isEnabled ? 1 : 0,
        config_json: configJson,
        description_override: updates.descriptionOverride ?? null,
        updated_at: now,
        updated_by: updatedBy,
      })
    )
    .execute();
}

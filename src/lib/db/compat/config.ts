/**
 * Configuration Database Operations - Async Compatibility Layer
 *
 * Provides async wrappers for config settings operations.
 * Most config functions are simple key-value operations, so for simplicity
 * we delegate to the sync module for SQLite and provide PostgreSQL support.
 */

import { getDb, getDatabaseProvider } from '../kysely';
import * as sync from '../config';

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
  SuperuserSettings,
  LimitsSettings,
  TokenLimitsSettings,
  ModelTokenLimits,
  AvailableModel,
  SettingKey,
} from '../config';

// Re-export constants
export {
  DEFAULT_PWA_SETTINGS,
  DEFAULT_OCR_SETTINGS,
  BRANDING_ICONS,
  DEFAULT_MODEL_ID,
} from '../config';

import type { SettingKey } from '../config';

// ============ Core Operations ============

export async function getSetting<T>(key: SettingKey): Promise<T | undefined>;
export async function getSetting<T>(key: SettingKey, defaultValue: T): Promise<T>;
export async function getSetting<T>(key: SettingKey, defaultValue?: T): Promise<T | undefined> {
  if (getDatabaseProvider() === 'sqlite') {
    return defaultValue !== undefined
      ? sync.getSetting(key, defaultValue)
      : sync.getSetting(key);
  }

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
  if (getDatabaseProvider() === 'sqlite') {
    return sync.setSetting(key, value, updatedBy);
  }

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
      })
    )
    .execute();
}

export async function deleteSetting(key: SettingKey): Promise<void> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.deleteSetting(key);
  }

  const db = await getDb();
  await db.deleteFrom('settings').where('key', '=', key).execute();
}

export async function getSettingMetadata(
  key: SettingKey
): Promise<{ updatedAt: string; updatedBy: string | null } | undefined> {
  if (getDatabaseProvider() === 'sqlite') {
    return sync.getSettingMetadata(key);
  }

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

// ============ Typed Getters (delegate to sync for simplicity) ============
// These functions involve complex business logic (merging defaults, loading from config files)
// For simplicity, we delegate to the sync module which handles all the fallback logic

export async function getRagSettings(): Promise<sync.RagSettings> {
  // Sync function handles fallback logic (SQLite > JSON > defaults)
  return sync.getRagSettings();
}

export async function getLlmSettings(): Promise<sync.LlmSettings> {
  return sync.getLlmSettings();
}

export async function getTavilySettings(): Promise<sync.TavilySettings> {
  return sync.getTavilySettings();
}

export async function getUploadLimits(): Promise<sync.UploadLimits> {
  return sync.getUploadLimits();
}

export async function getSystemPrompt(): Promise<string> {
  return sync.getSystemPrompt();
}

export async function getAcronymMappings(): Promise<sync.AcronymMappings> {
  return sync.getAcronymMappings();
}

export async function getRetentionSettings(): Promise<sync.RetentionSettings> {
  return sync.getRetentionSettings();
}

export async function getBrandingSettings(): Promise<sync.BrandingSettings> {
  return sync.getBrandingSettings();
}

export async function getEmbeddingSettings(): Promise<sync.EmbeddingSettings> {
  return sync.getEmbeddingSettings();
}

export async function getRerankerSettings(): Promise<sync.RerankerSettings> {
  return sync.getRerankerSettings();
}

export async function getMemorySettings(): Promise<sync.MemorySettings> {
  return sync.getMemorySettings();
}

export async function getSummarizationSettings(): Promise<sync.SummarizationSettings> {
  return sync.getSummarizationSettings();
}

export async function getSkillsSettings(): Promise<sync.SkillsSettings> {
  return sync.getSkillsSettings();
}

export async function getOcrSettings(): Promise<sync.OcrSettings> {
  return sync.getOcrSettings();
}

export async function getLimitsSettings(): Promise<sync.LimitsSettings> {
  return sync.getLimitsSettings();
}

export async function getTokenLimitsSettings(): Promise<sync.TokenLimitsSettings> {
  return sync.getTokenLimitsSettings();
}

export async function getModelTokenLimits(): Promise<sync.ModelTokenLimits> {
  return sync.getModelTokenLimits();
}

export async function getEffectiveMaxTokens(model: string): Promise<number> {
  return sync.getEffectiveMaxTokens(model);
}

export async function getPWASettings(): Promise<sync.PWASettings> {
  return sync.getPWASettings();
}

export async function getSuperuserSettings(): Promise<sync.SuperuserSettings> {
  return sync.getSuperuserSettings();
}

export async function getAvailableModels(): Promise<sync.AvailableModel[]> {
  return sync.getAvailableModels();
}

export async function isToolCapableModelFromDb(modelId: string): Promise<boolean> {
  return sync.isToolCapableModelFromDb(modelId);
}

export async function getToolCapableModels(): Promise<Set<string>> {
  return sync.getToolCapableModels();
}

export async function getDefaultSystemPrompt(): Promise<string> {
  return sync.getDefaultSystemPrompt();
}

// ============ Typed Setters ============

export async function setRagSettings(
  settings: Partial<sync.RagSettings>,
  updatedBy?: string
): Promise<sync.RagSettings> {
  return sync.setRagSettings(settings, updatedBy);
}

export async function setLlmSettings(
  settings: Partial<sync.LlmSettings>,
  updatedBy?: string
): Promise<sync.LlmSettings> {
  return sync.setLlmSettings(settings, updatedBy);
}

export async function setTavilySettings(
  settings: Partial<sync.TavilySettings>,
  updatedBy?: string
): Promise<sync.TavilySettings> {
  return sync.setTavilySettings(settings, updatedBy);
}

export async function setUploadLimits(
  limits: Partial<sync.UploadLimits>,
  updatedBy?: string
): Promise<sync.UploadLimits> {
  return sync.setUploadLimits(limits, updatedBy);
}

export async function setSystemPrompt(content: string, updatedBy?: string): Promise<void> {
  return sync.setSystemPrompt(content, updatedBy);
}

export async function setAcronymMappings(
  mappings: sync.AcronymMappings,
  updatedBy?: string
): Promise<void> {
  return sync.setAcronymMappings(mappings, updatedBy);
}

export async function setRetentionSettings(
  settings: Partial<sync.RetentionSettings>,
  updatedBy?: string
): Promise<sync.RetentionSettings> {
  return sync.setRetentionSettings(settings, updatedBy);
}

export async function setBrandingSettings(
  settings: Partial<sync.BrandingSettings>,
  updatedBy?: string
): Promise<sync.BrandingSettings> {
  return sync.setBrandingSettings(settings, updatedBy);
}

export async function setEmbeddingSettings(
  settings: Partial<sync.EmbeddingSettings>,
  updatedBy?: string
): Promise<sync.EmbeddingSettings> {
  return sync.setEmbeddingSettings(settings, updatedBy);
}

export async function setRerankerSettings(
  settings: Partial<sync.RerankerSettings>,
  updatedBy?: string
): Promise<sync.RerankerSettings> {
  return sync.setRerankerSettings(settings, updatedBy);
}

export async function setMemorySettings(
  settings: Partial<sync.MemorySettings>,
  updatedBy?: string
): Promise<sync.MemorySettings> {
  return sync.setMemorySettings(settings, updatedBy);
}

export async function setSummarizationSettings(
  settings: Partial<sync.SummarizationSettings>,
  updatedBy?: string
): Promise<sync.SummarizationSettings> {
  return sync.setSummarizationSettings(settings, updatedBy);
}

export async function setSkillsSettings(
  settings: Partial<sync.SkillsSettings>,
  updatedBy?: string
): Promise<sync.SkillsSettings> {
  return sync.setSkillsSettings(settings, updatedBy);
}

export async function setOcrSettings(
  settings: Partial<sync.OcrSettings>,
  updatedBy?: string
): Promise<sync.OcrSettings> {
  return sync.setOcrSettings(settings, updatedBy);
}

export async function setLimitsSettings(
  settings: Partial<sync.LimitsSettings>,
  updatedBy?: string
): Promise<sync.LimitsSettings> {
  return sync.setLimitsSettings(settings, updatedBy);
}

export async function setTokenLimitsSettings(
  settings: Partial<sync.TokenLimitsSettings>,
  updatedBy?: string
): Promise<sync.TokenLimitsSettings> {
  return sync.setTokenLimitsSettings(settings, updatedBy);
}

export async function setModelTokenLimit(
  model: string,
  limit: number | 'default',
  updatedBy?: string
): Promise<sync.ModelTokenLimits> {
  return sync.setModelTokenLimit(model, limit, updatedBy);
}

export async function setModelTokenLimits(
  limits: sync.ModelTokenLimits,
  updatedBy?: string
): Promise<sync.ModelTokenLimits> {
  return sync.setModelTokenLimits(limits, updatedBy);
}

export async function setPWASettings(
  settings: Partial<sync.PWASettings>,
  updatedBy?: string
): Promise<sync.PWASettings> {
  return sync.setPWASettings(settings, updatedBy);
}

export async function setSuperuserSettings(
  settings: Partial<sync.SuperuserSettings>,
  updatedBy?: string
): Promise<sync.SuperuserSettings> {
  return sync.setSuperuserSettings(settings, updatedBy);
}

// ============ Bulk Operations ============

export async function getAllSettings(): Promise<{
  rag: sync.RagSettings;
  llm: sync.LlmSettings;
  tavily: sync.TavilySettings;
  uploadLimits: sync.UploadLimits;
  systemPrompt: string;
  acronymMappings: sync.AcronymMappings;
  retention: sync.RetentionSettings;
  branding: sync.BrandingSettings;
  embedding: sync.EmbeddingSettings;
  reranker: sync.RerankerSettings;
  memory: sync.MemorySettings;
  summarization: sync.SummarizationSettings;
  skills: sync.SkillsSettings;
  ocr: sync.OcrSettings;
}> {
  return sync.getAllSettings();
}

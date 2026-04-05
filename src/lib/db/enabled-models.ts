/**
 * Enabled Models Database Operations
 *
 * CRUD operations for managing which LLM models are enabled in Policy Bot
 */

import { execute, queryOne, queryAll } from './index';
import { getProvider } from './llm-providers';

// ============ Types ============

export interface EnabledModel {
  id: string;              // Model ID e.g., 'gpt-4.1-mini'
  providerId: string;
  displayName: string;
  toolCapable: boolean;
  visionCapable: boolean;
  parallelToolCapable: boolean;
  thinkingCapable: boolean;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;  // Max tokens for LLM output
  isDefault: boolean;
  enabled: boolean;        // false = disabled/hidden
  providerEnabled?: boolean; // Whether the provider is enabled (for UI display)
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface EnabledModelRow {
  id: string;
  provider_id: string;
  display_name: string;
  tool_capable: number;
  vision_capable: number;
  parallel_tool_capable: number;
  thinking_capable: number;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  is_default: number;
  enabled: number;
  provider_enabled?: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateEnabledModelInput {
  id: string;
  providerId: string;
  displayName: string;
  toolCapable?: boolean;
  visionCapable?: boolean;
  parallelToolCapable?: boolean;
  thinkingCapable?: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  isDefault?: boolean;
  enabled?: boolean;
  sortOrder?: number;
}

export interface UpdateEnabledModelInput {
  displayName?: string;
  toolCapable?: boolean;
  visionCapable?: boolean;
  parallelToolCapable?: boolean;
  thinkingCapable?: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  isDefault?: boolean;
  enabled?: boolean;
  sortOrder?: number;
}

// ============ Row Mapper ============

function mapRowToModel(row: EnabledModelRow): EnabledModel {
  return {
    id: row.id,
    providerId: row.provider_id,
    displayName: row.display_name,
    toolCapable: row.tool_capable === 1,
    visionCapable: row.vision_capable === 1,
    parallelToolCapable: row.parallel_tool_capable === 1,
    thinkingCapable: row.thinking_capable === 1,
    maxInputTokens: row.max_input_tokens,
    maxOutputTokens: row.max_output_tokens,
    isDefault: row.is_default === 1,
    enabled: row.enabled === 1,
    providerEnabled: row.provider_enabled !== undefined ? row.provider_enabled === 1 : undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============ CRUD Operations ============

/**
 * Get all enabled models (including disabled ones)
 */
export function getAllEnabledModels(): EnabledModel[] {
  const rows = queryAll<EnabledModelRow>(`
    SELECT m.id, m.provider_id, m.display_name, m.tool_capable, m.vision_capable,
           m.max_input_tokens, m.max_output_tokens, m.is_default, m.enabled, m.sort_order, m.created_at, m.updated_at,
           p.enabled as provider_enabled
    FROM enabled_models m
    LEFT JOIN llm_providers p ON m.provider_id = p.id
    ORDER BY m.sort_order, m.display_name
  `);
  return rows.map(mapRowToModel);
}

/**
 * Get only active (enabled=1) models from enabled providers
 * Models are only active if BOTH the model AND its provider are enabled
 */
export function getActiveModels(): EnabledModel[] {
  const rows = queryAll<EnabledModelRow>(`
    SELECT m.id, m.provider_id, m.display_name, m.tool_capable, m.vision_capable,
           m.max_input_tokens, m.max_output_tokens, m.is_default, m.enabled, m.sort_order, m.created_at, m.updated_at
    FROM enabled_models m
    INNER JOIN llm_providers p ON m.provider_id = p.id
    WHERE m.enabled = 1 AND p.enabled = 1
    ORDER BY m.sort_order, m.display_name
  `);
  return rows.map(mapRowToModel);
}

/**
 * Get models by provider
 */
export function getModelsByProvider(providerId: string): EnabledModel[] {
  const rows = queryAll<EnabledModelRow>(`
    SELECT id, provider_id, display_name, tool_capable, vision_capable,
           max_input_tokens, max_output_tokens, is_default, enabled, sort_order, created_at, updated_at
    FROM enabled_models
    WHERE provider_id = ?
    ORDER BY sort_order, display_name
  `, [providerId]);
  return rows.map(mapRowToModel);
}

/**
 * Get a single model by ID
 */
export function getEnabledModel(id: string): EnabledModel | null {
  const row = queryOne<EnabledModelRow>(`
    SELECT id, provider_id, display_name, tool_capable, vision_capable,
           max_input_tokens, max_output_tokens, is_default, enabled, sort_order, created_at, updated_at
    FROM enabled_models
    WHERE id = ?
  `, [id]);
  return row ? mapRowToModel(row) : null;
}

/**
 * Get the default model (must be from an enabled provider)
 */
export function getDefaultModel(): EnabledModel | null {
  const row = queryOne<EnabledModelRow>(`
    SELECT m.id, m.provider_id, m.display_name, m.tool_capable, m.vision_capable,
           m.max_input_tokens, m.max_output_tokens, m.is_default, m.enabled, m.sort_order, m.created_at, m.updated_at
    FROM enabled_models m
    INNER JOIN llm_providers p ON m.provider_id = p.id
    WHERE m.is_default = 1 AND m.enabled = 1 AND p.enabled = 1
  `);
  return row ? mapRowToModel(row) : null;
}

/**
 * Create a new enabled model
 */
export function createEnabledModel(input: CreateEnabledModelInput): EnabledModel {
  // Validate provider exists
  const provider = getProvider(input.providerId);
  if (!provider) {
    throw new Error(`Provider not found: ${input.providerId}`);
  }

  // Get max sort order
  const maxOrder = queryOne<{ max_order: number }>(
    'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM enabled_models'
  );
  const sortOrder = input.sortOrder ?? (maxOrder?.max_order ?? 0) + 1;

  execute(`
    INSERT INTO enabled_models (
      id, provider_id, display_name, tool_capable, vision_capable,
      max_input_tokens, max_output_tokens, is_default, enabled, sort_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.id,
    input.providerId,
    input.displayName,
    input.toolCapable ? 1 : 0,
    input.visionCapable ? 1 : 0,
    input.maxInputTokens || null,
    input.maxOutputTokens || null,
    input.isDefault ? 1 : 0,
    input.enabled !== false ? 1 : 0,
    sortOrder,
  ]);

  return getEnabledModel(input.id)!;
}

/**
 * Create multiple enabled models in a batch
 */
export function createEnabledModelsBatch(inputs: CreateEnabledModelInput[]): EnabledModel[] {
  const results: EnabledModel[] = [];

  for (const input of inputs) {
    // Skip if model already exists
    if (getEnabledModel(input.id)) {
      continue;
    }
    results.push(createEnabledModel(input));
  }

  return results;
}

/**
 * Update an existing model
 */
export function updateEnabledModel(id: string, input: UpdateEnabledModelInput): EnabledModel | null {
  const existing = getEnabledModel(id);
  if (!existing) return null;

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (input.displayName !== undefined) {
    updates.push('display_name = ?');
    params.push(input.displayName);
  }
  if (input.toolCapable !== undefined) {
    updates.push('tool_capable = ?');
    params.push(input.toolCapable ? 1 : 0);
  }
  if (input.visionCapable !== undefined) {
    updates.push('vision_capable = ?');
    params.push(input.visionCapable ? 1 : 0);
  }
  if (input.parallelToolCapable !== undefined) {
    updates.push('parallel_tool_capable = ?');
    params.push(input.parallelToolCapable ? 1 : 0);
  }
  if (input.thinkingCapable !== undefined) {
    updates.push('thinking_capable = ?');
    params.push(input.thinkingCapable ? 1 : 0);
  }
  if (input.maxInputTokens !== undefined) {
    updates.push('max_input_tokens = ?');
    params.push(input.maxInputTokens || null);
  }
  if (input.maxOutputTokens !== undefined) {
    updates.push('max_output_tokens = ?');
    params.push(input.maxOutputTokens || null);
  }
  if (input.isDefault !== undefined) {
    updates.push('is_default = ?');
    params.push(input.isDefault ? 1 : 0);
    // Note: The trigger ensures_single_default_model will clear other defaults
  }
  if (input.enabled !== undefined) {
    updates.push('enabled = ?');
    params.push(input.enabled ? 1 : 0);
  }
  if (input.sortOrder !== undefined) {
    updates.push('sort_order = ?');
    params.push(input.sortOrder);
  }

  if (updates.length === 0) return existing;

  params.push(id);
  execute(`
    UPDATE enabled_models
    SET ${updates.join(', ')}
    WHERE id = ?
  `, params);

  return getEnabledModel(id);
}

/**
 * Delete/remove an enabled model
 */
export function deleteEnabledModel(id: string): boolean {
  const existing = getEnabledModel(id);
  if (!existing) return false;

  execute('DELETE FROM enabled_models WHERE id = ?', [id]);
  return true;
}

/**
 * Delete multiple models by IDs
 */
export function deleteEnabledModelsBatch(ids: string[]): number {
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => '?').join(', ');
  const result = execute(
    `DELETE FROM enabled_models WHERE id IN (${placeholders})`,
    ids
  );
  return result.changes;
}

/**
 * Set a model as the default
 * Clears default from other models automatically via trigger
 */
export function setDefaultModel(id: string): EnabledModel | null {
  return updateEnabledModel(id, { isDefault: true });
}

/**
 * Disable a model (hide from dropdown but keep config)
 */
export function disableModel(id: string): EnabledModel | null {
  return updateEnabledModel(id, { enabled: false });
}

/**
 * Enable a model (show in dropdown)
 */
export function enableModel(id: string): EnabledModel | null {
  return updateEnabledModel(id, { enabled: true });
}

/**
 * Check if a model supports tool/function calling
 */
export function isModelToolCapable(id: string): boolean {
  const model = getEnabledModel(id);
  return model?.toolCapable ?? false;
}

/**
 * Check if a model supports vision/images
 */
export function isModelVisionCapable(id: string): boolean {
  const model = getEnabledModel(id);
  return model?.visionCapable ?? false;
}

/**
 * Get all tool-capable model IDs (from enabled providers only)
 */
export function getToolCapableModelIds(): Set<string> {
  const rows = queryAll<{ id: string }>(`
    SELECT m.id FROM enabled_models m
    INNER JOIN llm_providers p ON m.provider_id = p.id
    WHERE m.tool_capable = 1 AND m.enabled = 1 AND p.enabled = 1
  `);
  return new Set(rows.map(r => r.id));
}

/**
 * Update sort order for models (drag-and-drop reorder)
 */
export function updateModelSortOrder(modelIds: string[]): void {
  for (let i = 0; i < modelIds.length; i++) {
    execute(
      'UPDATE enabled_models SET sort_order = ? WHERE id = ?',
      [i, modelIds[i]]
    );
  }
}

// ============ Migration / Seeding ============

/**
 * Check if any models exist in the database
 */
export function hasEnabledModels(): boolean {
  const count = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM enabled_models'
  );
  return (count?.count ?? 0) > 0;
}

/**
 * Seed models from LiteLLM config (for migration)
 * This is called during app initialization to migrate from YAML to DB
 */
export function seedModelsFromConfig(models: CreateEnabledModelInput[]): void {
  if (hasEnabledModels()) {
    console.log('[Enabled Models] Models already exist, skipping seed');
    return;
  }

  console.log(`[Enabled Models] Seeding ${models.length} models from config...`);

  for (const model of models) {
    try {
      createEnabledModel(model);
    } catch (error) {
      console.warn(`[Enabled Models] Failed to seed model ${model.id}:`, error);
    }
  }

  console.log('[Enabled Models] Seed complete');
}

// ============ Deprecated Models Detection ============

/**
 * Find models that are enabled but not in the provided list of available models
 * Used to detect deprecated/removed models from providers
 */
export function findDeprecatedModels(availableModelIds: string[]): EnabledModel[] {
  const enabledModels = getAllEnabledModels();
  const availableSet = new Set(availableModelIds);

  return enabledModels.filter(m => !availableSet.has(m.id));
}

// ============ Model Capability Refresh ============

/**
 * Refresh a single model's capabilities using current detection patterns
 * Updates toolCapable, visionCapable, and maxInputTokens from model-discovery
 */
export function refreshModelCapabilities(modelId: string): EnabledModel | null {
  const model = getEnabledModel(modelId);
  if (!model) return null;

  // Import capability detection from model-discovery (lazy to avoid circular deps)
  const { isToolCapable, isVisionCapable, getContextWindow } = require('../services/model-discovery');

  const newTokens = getContextWindow(modelId);

  return updateEnabledModel(modelId, {
    toolCapable: isToolCapable(modelId),
    visionCapable: isVisionCapable(modelId),
    maxInputTokens: newTokens ?? model.maxInputTokens,
  });
}

/**
 * Refresh capabilities for all enabled models
 * Returns count of updated models and the refreshed model list
 */
export function refreshAllModelCapabilities(): { updated: number; models: EnabledModel[] } {
  const models = getAllEnabledModels();
  const refreshed: EnabledModel[] = [];

  for (const model of models) {
    const updated = refreshModelCapabilities(model.id);
    if (updated) refreshed.push(updated);
  }

  return { updated: refreshed.length, models: refreshed };
}

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
  maxInputTokens: number | null;
  isDefault: boolean;
  enabled: boolean;        // false = disabled/hidden
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
  max_input_tokens: number | null;
  is_default: number;
  enabled: number;
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
  maxInputTokens?: number;
  isDefault?: boolean;
  enabled?: boolean;
  sortOrder?: number;
}

export interface UpdateEnabledModelInput {
  displayName?: string;
  toolCapable?: boolean;
  visionCapable?: boolean;
  maxInputTokens?: number;
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
    maxInputTokens: row.max_input_tokens,
    isDefault: row.is_default === 1,
    enabled: row.enabled === 1,
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
    SELECT id, provider_id, display_name, tool_capable, vision_capable,
           max_input_tokens, is_default, enabled, sort_order, created_at, updated_at
    FROM enabled_models
    ORDER BY sort_order, display_name
  `);
  return rows.map(mapRowToModel);
}

/**
 * Get only active (enabled=1) models
 */
export function getActiveModels(): EnabledModel[] {
  const rows = queryAll<EnabledModelRow>(`
    SELECT id, provider_id, display_name, tool_capable, vision_capable,
           max_input_tokens, is_default, enabled, sort_order, created_at, updated_at
    FROM enabled_models
    WHERE enabled = 1
    ORDER BY sort_order, display_name
  `);
  return rows.map(mapRowToModel);
}

/**
 * Get models by provider
 */
export function getModelsByProvider(providerId: string): EnabledModel[] {
  const rows = queryAll<EnabledModelRow>(`
    SELECT id, provider_id, display_name, tool_capable, vision_capable,
           max_input_tokens, is_default, enabled, sort_order, created_at, updated_at
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
           max_input_tokens, is_default, enabled, sort_order, created_at, updated_at
    FROM enabled_models
    WHERE id = ?
  `, [id]);
  return row ? mapRowToModel(row) : null;
}

/**
 * Get the default model
 */
export function getDefaultModel(): EnabledModel | null {
  const row = queryOne<EnabledModelRow>(`
    SELECT id, provider_id, display_name, tool_capable, vision_capable,
           max_input_tokens, is_default, enabled, sort_order, created_at, updated_at
    FROM enabled_models
    WHERE is_default = 1 AND enabled = 1
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
      max_input_tokens, is_default, enabled, sort_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.id,
    input.providerId,
    input.displayName,
    input.toolCapable ? 1 : 0,
    input.visionCapable ? 1 : 0,
    input.maxInputTokens || null,
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
  if (input.maxInputTokens !== undefined) {
    updates.push('max_input_tokens = ?');
    params.push(input.maxInputTokens || null);
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
 * Get all tool-capable model IDs
 */
export function getToolCapableModelIds(): Set<string> {
  const rows = queryAll<{ id: string }>(
    'SELECT id FROM enabled_models WHERE tool_capable = 1 AND enabled = 1'
  );
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

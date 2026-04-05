/**
 * Enabled Models Database Operations - Async Compatibility Layer
 *
 * Provides async wrappers that work with both SQLite and PostgreSQL.
 * - SQLite: Delegates to existing sync functions
 * - PostgreSQL: Uses Kysely query builder
 */

import { getDb } from '../kysely';
import { getProvider } from './llm-providers';

// Re-export types from sync module
export type {
  EnabledModel,
  CreateEnabledModelInput,
  UpdateEnabledModelInput,
} from '../enabled-models';

import type {
  EnabledModel,
  CreateEnabledModelInput,
  UpdateEnabledModelInput,
} from '../enabled-models';

// ============ Row Mapper ============

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
export async function getAllEnabledModels(): Promise<EnabledModel[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('enabled_models as m')
    .leftJoin('llm_providers as p', 'm.provider_id', 'p.id')
    .select([
      'm.id',
      'm.provider_id',
      'm.display_name',
      'm.tool_capable',
      'm.vision_capable',
      'm.parallel_tool_capable',
      'm.thinking_capable',
      'm.max_input_tokens',
      'm.max_output_tokens',
      'm.is_default',
      'm.enabled',
      'm.sort_order',
      'm.created_at',
      'm.updated_at',
      'p.enabled as provider_enabled',
    ])
    .orderBy('m.sort_order')
    .orderBy('m.display_name')
    .execute();

  return rows.map((row) => mapRowToModel(row as unknown as EnabledModelRow));
}

/**
 * Get only active (enabled=1) models from enabled providers
 * Models are only active if BOTH the model AND its provider are enabled
 */
export async function getActiveModels(): Promise<EnabledModel[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('enabled_models as m')
    .innerJoin('llm_providers as p', 'm.provider_id', 'p.id')
    .select([
      'm.id',
      'm.provider_id',
      'm.display_name',
      'm.tool_capable',
      'm.vision_capable',
      'm.parallel_tool_capable',
      'm.thinking_capable',
      'm.max_input_tokens',
      'm.max_output_tokens',
      'm.is_default',
      'm.enabled',
      'm.sort_order',
      'm.created_at',
      'm.updated_at',
    ])
    .where('m.enabled', '=', 1)
    .where('p.enabled', '=', 1)
    .orderBy('m.sort_order')
    .orderBy('m.display_name')
    .execute();

  return rows.map((row) => mapRowToModel(row as unknown as EnabledModelRow));
}

/**
 * Get models by provider
 */
export async function getModelsByProvider(providerId: string): Promise<EnabledModel[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('enabled_models')
    .selectAll()
    .where('provider_id', '=', providerId)
    .orderBy('sort_order')
    .orderBy('display_name')
    .execute();

  return rows.map((row) => mapRowToModel(row as unknown as EnabledModelRow));
}

/**
 * Get a single model by ID
 */
export async function getEnabledModel(id: string): Promise<EnabledModel | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('enabled_models')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? mapRowToModel(row as unknown as EnabledModelRow) : null;
}

/**
 * Get the default model (must be from an enabled provider)
 */
export async function getDefaultModel(): Promise<EnabledModel | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('enabled_models as m')
    .innerJoin('llm_providers as p', 'm.provider_id', 'p.id')
    .select([
      'm.id',
      'm.provider_id',
      'm.display_name',
      'm.tool_capable',
      'm.vision_capable',
      'm.parallel_tool_capable',
      'm.thinking_capable',
      'm.max_input_tokens',
      'm.max_output_tokens',
      'm.is_default',
      'm.enabled',
      'm.sort_order',
      'm.created_at',
      'm.updated_at',
    ])
    .where('m.is_default', '=', 1)
    .where('m.enabled', '=', 1)
    .where('p.enabled', '=', 1)
    .executeTakeFirst();

  return row ? mapRowToModel(row as unknown as EnabledModelRow) : null;
}

/**
 * Create a new enabled model
 */
export async function createEnabledModel(input: CreateEnabledModelInput): Promise<EnabledModel> {
  // Validate provider exists
  const provider = await getProvider(input.providerId);
  if (!provider) {
    throw new Error(`Provider not found: ${input.providerId}`);
  }

  const db = await getDb();

  // Get max sort order
  const maxOrder = await db
    .selectFrom('enabled_models')
    .select(db.fn.max<number>('sort_order').as('max_order'))
    .executeTakeFirst();
  const sortOrder = input.sortOrder ?? ((maxOrder?.max_order ?? 0) + 1);

  await db
    .insertInto('enabled_models')
    .values({
      id: input.id,
      provider_id: input.providerId,
      display_name: input.displayName,
      tool_capable: input.toolCapable ? 1 : 0,
      vision_capable: input.visionCapable ? 1 : 0,
      parallel_tool_capable: input.parallelToolCapable ? 1 : 0,
      thinking_capable: input.thinkingCapable ? 1 : 0,
      max_input_tokens: input.maxInputTokens || null,
      max_output_tokens: input.maxOutputTokens || null,
      is_default: input.isDefault ? 1 : 0,
      enabled: input.enabled !== false ? 1 : 0,
      sort_order: sortOrder,
    })
    .execute();

  return (await getEnabledModel(input.id))!;
}

/**
 * Create multiple enabled models in a batch
 */
export async function createEnabledModelsBatch(inputs: CreateEnabledModelInput[]): Promise<EnabledModel[]> {
  const results: EnabledModel[] = [];

  for (const input of inputs) {
    // Skip if model already exists
    if (await getEnabledModel(input.id)) {
      continue;
    }
    results.push(await createEnabledModel(input));
  }

  return results;
}

/**
 * Update an existing model
 */
export async function updateEnabledModel(id: string, input: UpdateEnabledModelInput): Promise<EnabledModel | null> {
  const existing = await getEnabledModel(id);
  if (!existing) return null;

  const updateObj: Record<string, unknown> = {};

  if (input.displayName !== undefined) {
    updateObj.display_name = input.displayName;
  }
  if (input.toolCapable !== undefined) {
    updateObj.tool_capable = input.toolCapable ? 1 : 0;
  }
  if (input.visionCapable !== undefined) {
    updateObj.vision_capable = input.visionCapable ? 1 : 0;
  }
  if (input.parallelToolCapable !== undefined) {
    updateObj.parallel_tool_capable = input.parallelToolCapable ? 1 : 0;
  }
  if (input.thinkingCapable !== undefined) {
    updateObj.thinking_capable = input.thinkingCapable ? 1 : 0;
  }
  if (input.maxInputTokens !== undefined) {
    updateObj.max_input_tokens = input.maxInputTokens || null;
  }
  if (input.maxOutputTokens !== undefined) {
    updateObj.max_output_tokens = input.maxOutputTokens || null;
  }
  if (input.isDefault !== undefined) {
    updateObj.is_default = input.isDefault ? 1 : 0;
    // Note: Need to clear other defaults if setting a new default
    if (input.isDefault) {
      const db = await getDb();
      await db
        .updateTable('enabled_models')
        .set({ is_default: 0 })
        .where('id', '!=', id)
        .execute();
    }
  }
  if (input.enabled !== undefined) {
    updateObj.enabled = input.enabled ? 1 : 0;
  }
  if (input.sortOrder !== undefined) {
    updateObj.sort_order = input.sortOrder;
  }

  if (Object.keys(updateObj).length === 0) return existing;

  const db = await getDb();
  await db
    .updateTable('enabled_models')
    .set(updateObj)
    .where('id', '=', id)
    .execute();

  return getEnabledModel(id);
}

/**
 * Delete/remove an enabled model
 */
export async function deleteEnabledModel(id: string): Promise<boolean> {
  const existing = await getEnabledModel(id);
  if (!existing) return false;

  const db = await getDb();
  await db
    .deleteFrom('enabled_models')
    .where('id', '=', id)
    .execute();

  return true;
}

/**
 * Delete multiple models by IDs
 */
export async function deleteEnabledModelsBatch(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  const db = await getDb();
  const result = await db
    .deleteFrom('enabled_models')
    .where('id', 'in', ids)
    .executeTakeFirst();

  return Number(result.numDeletedRows || 0);
}

/**
 * Set a model as the default
 * Clears default from other models
 */
export async function setDefaultModel(id: string): Promise<EnabledModel | null> {
  return updateEnabledModel(id, { isDefault: true });
}

/**
 * Disable a model (hide from dropdown but keep config)
 */
export async function disableModel(id: string): Promise<EnabledModel | null> {
  return updateEnabledModel(id, { enabled: false });
}

/**
 * Enable a model (show in dropdown)
 */
export async function enableModel(id: string): Promise<EnabledModel | null> {
  return updateEnabledModel(id, { enabled: true });
}

/**
 * Check if a model supports tool/function calling
 */
export async function isModelToolCapable(id: string): Promise<boolean> {
  const model = await getEnabledModel(id);
  return model?.toolCapable ?? false;
}

/**
 * Check if a model supports vision/images
 */
export async function isModelVisionCapable(id: string): Promise<boolean> {
  const model = await getEnabledModel(id);
  return model?.visionCapable ?? false;
}

/**
 * Check if a model supports parallel tool execution
 */
export async function isModelParallelToolCapable(id: string): Promise<boolean> {
  const model = await getEnabledModel(id);
  return model?.parallelToolCapable ?? false;
}

/**
 * Check if a model supports thinking/reasoning content
 */
export async function isModelThinkingCapable(id: string): Promise<boolean> {
  const model = await getEnabledModel(id);
  return model?.thinkingCapable ?? false;
}

/**
 * Get all tool-capable model IDs (from enabled providers only)
 */
export async function getToolCapableModelIds(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db
    .selectFrom('enabled_models as m')
    .innerJoin('llm_providers as p', 'm.provider_id', 'p.id')
    .select('m.id')
    .where('m.tool_capable', '=', 1)
    .where('m.enabled', '=', 1)
    .where('p.enabled', '=', 1)
    .execute();

  return new Set(rows.map((r) => r.id));
}

/**
 * Update sort order for models (drag-and-drop reorder)
 */
export async function updateModelSortOrder(modelIds: string[]): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < modelIds.length; i++) {
    await db
      .updateTable('enabled_models')
      .set({ sort_order: i })
      .where('id', '=', modelIds[i])
      .execute();
  }
}

// ============ Migration / Seeding ============

/**
 * Check if any models exist in the database
 */
export async function hasEnabledModels(): Promise<boolean> {
  const db = await getDb();
  const count = await db
    .selectFrom('enabled_models')
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirst();

  return (count?.count ?? 0) > 0;
}

/**
 * Seed models from LiteLLM config (for migration)
 * This is called during app initialization to migrate from YAML to DB
 */
export async function seedModelsFromConfig(models: CreateEnabledModelInput[]): Promise<void> {
  if (await hasEnabledModels()) {
    console.log('[Enabled Models] Models already exist, skipping seed (PostgreSQL)');
    return;
  }

  console.log(`[Enabled Models] Seeding ${models.length} models from config... (PostgreSQL)`);

  for (const model of models) {
    try {
      await createEnabledModel(model);
    } catch (error) {
      console.warn(`[Enabled Models] Failed to seed model ${model.id}:`, error);
    }
  }

  console.log('[Enabled Models] Seed complete (PostgreSQL)');
}

// ============ Deprecated Models Detection ============

/**
 * Find models that are enabled but not in the provided list of available models
 * Used to detect deprecated/removed models from providers
 */
export async function findDeprecatedModels(availableModelIds: string[]): Promise<EnabledModel[]> {
  const enabledModels = await getAllEnabledModels();
  const availableSet = new Set(availableModelIds);

  return enabledModels.filter((m) => !availableSet.has(m.id));
}

// ============ Model Capability Refresh ============

/**
 * Refresh a single model's capabilities using current detection patterns
 * Updates toolCapable, visionCapable, and maxInputTokens from model-discovery
 */
export async function refreshModelCapabilities(modelId: string): Promise<EnabledModel | null> {
  const model = await getEnabledModel(modelId);
  if (!model) return null;

  // Import capability detection from model-discovery (dynamic to avoid circular deps)
  const { isToolCapable, isVisionCapable, isParallelToolCapable, isThinkingCapable, getContextWindow } = await import('../../services/model-discovery');

  const newTokens = getContextWindow(modelId);

  return updateEnabledModel(modelId, {
    toolCapable: isToolCapable(modelId),
    visionCapable: isVisionCapable(modelId),
    parallelToolCapable: isParallelToolCapable(modelId),
    thinkingCapable: isThinkingCapable(modelId),
    maxInputTokens: newTokens ?? model.maxInputTokens ?? undefined,
  });
}

/**
 * Refresh capabilities for all enabled models
 * Returns count of updated models and the refreshed model list
 */
export async function refreshAllModelCapabilities(): Promise<{ updated: number; models: EnabledModel[] }> {
  const models = await getAllEnabledModels();
  const refreshed: EnabledModel[] = [];

  for (const model of models) {
    const updated = await refreshModelCapabilities(model.id);
    if (updated) refreshed.push(updated);
  }

  return { updated: refreshed.length, models: refreshed };
}

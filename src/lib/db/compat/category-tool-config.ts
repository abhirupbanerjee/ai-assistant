/**
 * Category-Level Tool Configuration - Async Compatibility Layer
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb } from '../kysely';
import { getToolConfig, type ToolConfig } from './tool-config';
import { v4 as uuidv4 } from 'uuid';

// Re-export types from sync module
export type { CategoryToolConfig, BrandingConfig } from '../category-tool-config';

import type { CategoryToolConfig, BrandingConfig } from '../category-tool-config';

// ============ Helper Functions ============

interface DbCategoryToolConfig {
  id: string;
  category_id: number;
  tool_name: string;
  is_enabled: number | null;
  branding_json: string | null;
  config_json: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

function mapDbToCategoryToolConfig(row: DbCategoryToolConfig): CategoryToolConfig {
  return {
    id: row.id,
    categoryId: row.category_id,
    toolName: row.tool_name,
    isEnabled: row.is_enabled === null ? null : row.is_enabled === 1,
    branding: row.branding_json ? JSON.parse(row.branding_json) : null,
    config: row.config_json ? JSON.parse(row.config_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

// ============ CRUD Operations ============

/**
 * Get category tool config by category and tool name
 */
export async function getCategoryToolConfig(
  categoryId: number,
  toolName: string
): Promise<CategoryToolConfig | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('category_tool_configs')
    .selectAll()
    .where('category_id', '=', categoryId)
    .where('tool_name', '=', toolName)
    .executeTakeFirst();

  return row ? mapDbToCategoryToolConfig(row as unknown as DbCategoryToolConfig) : undefined;
}

/**
 * Get all category tool configs for a category
 */
export async function getCategoryToolConfigs(categoryId: number): Promise<CategoryToolConfig[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('category_tool_configs')
    .selectAll()
    .where('category_id', '=', categoryId)
    .orderBy('tool_name')
    .execute();

  return rows.map((row) => mapDbToCategoryToolConfig(row as unknown as DbCategoryToolConfig));
}

/**
 * Get all category tool configs for a specific tool across all categories
 */
export async function getToolCategoryConfigs(toolName: string): Promise<CategoryToolConfig[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('category_tool_configs')
    .selectAll()
    .where('tool_name', '=', toolName)
    .orderBy('category_id')
    .execute();

  return rows.map((row) => mapDbToCategoryToolConfig(row as unknown as DbCategoryToolConfig));
}

/**
 * Create or update category tool config
 */
export async function upsertCategoryToolConfig(
  categoryId: number,
  toolName: string,
  updates: {
    isEnabled?: boolean | null;
    branding?: BrandingConfig | null;
    config?: Record<string, unknown> | null;
  },
  updatedBy: string
): Promise<CategoryToolConfig> {
  const existing = await getCategoryToolConfig(categoryId, toolName);

  if (existing) {
    // Update existing
    const newEnabled = updates.isEnabled !== undefined ? updates.isEnabled : existing.isEnabled;
    const newBranding = updates.branding !== undefined ? updates.branding : existing.branding;
    const newConfig = updates.config !== undefined ? updates.config : existing.config;

    const db = await getDb();
    await db
      .updateTable('category_tool_configs')
      .set({
        is_enabled: newEnabled === null ? null : newEnabled ? 1 : 0,
        branding_json: newBranding ? JSON.stringify(newBranding) : null,
        config_json: newConfig ? JSON.stringify(newConfig) : null,
        updated_by: updatedBy,
      })
      .where('category_id', '=', categoryId)
      .where('tool_name', '=', toolName)
      .execute();

    return (await getCategoryToolConfig(categoryId, toolName))!;
  } else {
    // Create new
    const id = uuidv4();
    const isEnabled = updates.isEnabled ?? null;
    const branding = updates.branding ?? null;
    const config = updates.config ?? null;

    const db = await getDb();
    await db
      .insertInto('category_tool_configs')
      .values({
        id,
        category_id: categoryId,
        tool_name: toolName,
        is_enabled: isEnabled === null ? null : isEnabled ? 1 : 0,
        branding_json: branding ? JSON.stringify(branding) : null,
        config_json: config ? JSON.stringify(config) : null,
        updated_by: updatedBy,
      })
      .execute();

    return (await getCategoryToolConfig(categoryId, toolName))!;
  }
}

/**
 * Delete category tool config (resets to inherit from global)
 */
export async function deleteCategoryToolConfig(
  categoryId: number,
  toolName: string
): Promise<boolean> {
  const existing = await getCategoryToolConfig(categoryId, toolName);
  if (!existing) return false;

  const db = await getDb();
  await db
    .deleteFrom('category_tool_configs')
    .where('category_id', '=', categoryId)
    .where('tool_name', '=', toolName)
    .execute();

  return true;
}

/**
 * Delete all category tool configs for a category
 */
export async function deleteAllCategoryToolConfigs(categoryId: number): Promise<number> {
  const db = await getDb();
  const result = await db
    .deleteFrom('category_tool_configs')
    .where('category_id', '=', categoryId)
    .executeTakeFirst();

  return Number(result.numDeletedRows);
}

// ============ Effective Config Resolution ============

/**
 * Get the effective tool configuration for a category
 * Merges global config with category overrides
 */
export async function getEffectiveToolConfig(
  toolName: string,
  categoryId: number
): Promise<{
  enabled: boolean;
  branding: BrandingConfig | null;
  config: Record<string, unknown> | null;
  globalConfig: ToolConfig | undefined;
  categoryOverride: CategoryToolConfig | undefined;
}> {
  // Use async compat version of getToolConfig
  const globalConfig = await getToolConfig(toolName);
  const categoryOverride = await getCategoryToolConfig(categoryId, toolName);

  // Resolve enabled status: category override takes precedence
  let enabled = globalConfig?.isEnabled ?? false;
  if (categoryOverride?.isEnabled !== null && categoryOverride?.isEnabled !== undefined) {
    enabled = categoryOverride.isEnabled;
  }

  // Resolve branding: category override takes precedence
  let branding: BrandingConfig | null = null;
  if (globalConfig?.config?.branding) {
    branding = globalConfig.config.branding as BrandingConfig;
  }
  if (categoryOverride?.branding) {
    branding = categoryOverride.branding;
  }

  // Resolve config: deep merge global + category override
  let config: Record<string, unknown> | null = null;
  if (globalConfig?.config) {
    config = { ...globalConfig.config };
  }
  if (categoryOverride?.config) {
    config = { ...(config || {}), ...categoryOverride.config };
  }

  return {
    enabled,
    branding,
    config,
    globalConfig,
    categoryOverride,
  };
}

/**
 * Check if a tool is enabled for a specific category
 */
export async function isToolEnabledForCategory(
  toolName: string,
  categoryId: number
): Promise<boolean> {
  const { enabled } = await getEffectiveToolConfig(toolName, categoryId);
  return enabled;
}

/**
 * Get branding config for a specific category
 */
export async function getBrandingForCategory(
  toolName: string,
  categoryId: number
): Promise<BrandingConfig | null> {
  const { branding } = await getEffectiveToolConfig(toolName, categoryId);
  return branding;
}

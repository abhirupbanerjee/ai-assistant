/**
 * Category-Level Tool Configuration Database Operations
 *
 * CRUD operations for the category_tool_configs table.
 * Allows superusers to override tool settings per category.
 */

import { v4 as uuidv4 } from 'uuid';
import { execute, queryOne, queryAll } from './index';
import { getToolConfig, type ToolConfig } from './tool-config';

// ============ Types ============

export interface CategoryToolConfig {
  id: string;
  categoryId: number;
  toolName: string;
  isEnabled: boolean | null; // null = inherit from global
  branding: BrandingConfig | null;
  config: Record<string, unknown> | null; // Tool-specific config overrides (e.g., templates for task_planner)
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface PlaybookBrandingConfig {
  tagline: string;
  heroSubtitle: string;
  heroDate: string;
  footerEntity: string;
  footerAgency: string;
  footerDate: string;
}

export interface BrandingConfig {
  enabled: boolean;
  logoUrl: string;
  organizationName: string;
  primaryColor: string;
  fontFamily: string;
  header: { enabled: boolean; content: string };
  footer: { enabled: boolean; content: string; includePageNumber: boolean };
  playbook: PlaybookBrandingConfig;
}

// Database row type
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

// ============ Mappers ============

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
export function getCategoryToolConfig(
  categoryId: number,
  toolName: string
): CategoryToolConfig | undefined {
  const row = queryOne<DbCategoryToolConfig>(
    'SELECT * FROM category_tool_configs WHERE category_id = ? AND tool_name = ?',
    [categoryId, toolName]
  );
  return row ? mapDbToCategoryToolConfig(row) : undefined;
}

/**
 * Get all category tool configs for a category
 */
export function getCategoryToolConfigs(categoryId: number): CategoryToolConfig[] {
  const rows = queryAll<DbCategoryToolConfig>(
    'SELECT * FROM category_tool_configs WHERE category_id = ? ORDER BY tool_name',
    [categoryId]
  );
  return rows.map(mapDbToCategoryToolConfig);
}

/**
 * Get all category tool configs for a specific tool across all categories
 */
export function getToolCategoryConfigs(toolName: string): CategoryToolConfig[] {
  const rows = queryAll<DbCategoryToolConfig>(
    'SELECT * FROM category_tool_configs WHERE tool_name = ? ORDER BY category_id',
    [toolName]
  );
  return rows.map(mapDbToCategoryToolConfig);
}

/**
 * Create or update category tool config
 */
export function upsertCategoryToolConfig(
  categoryId: number,
  toolName: string,
  updates: {
    isEnabled?: boolean | null;
    branding?: BrandingConfig | null;
    config?: Record<string, unknown> | null;
  },
  updatedBy: string
): CategoryToolConfig {
  const existing = getCategoryToolConfig(categoryId, toolName);

  if (existing) {
    // Update existing
    const newEnabled = updates.isEnabled !== undefined ? updates.isEnabled : existing.isEnabled;
    const newBranding = updates.branding !== undefined ? updates.branding : existing.branding;
    const newConfig = updates.config !== undefined ? updates.config : existing.config;

    execute(
      `UPDATE category_tool_configs
       SET is_enabled = ?, branding_json = ?, config_json = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
       WHERE category_id = ? AND tool_name = ?`,
      [
        newEnabled === null ? null : newEnabled ? 1 : 0,
        newBranding ? JSON.stringify(newBranding) : null,
        newConfig ? JSON.stringify(newConfig) : null,
        updatedBy,
        categoryId,
        toolName,
      ]
    );

    return getCategoryToolConfig(categoryId, toolName)!;
  } else {
    // Create new
    const id = uuidv4();
    const isEnabled = updates.isEnabled ?? null;
    const branding = updates.branding ?? null;
    const config = updates.config ?? null;

    execute(
      `INSERT INTO category_tool_configs (id, category_id, tool_name, is_enabled, branding_json, config_json, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        categoryId,
        toolName,
        isEnabled === null ? null : isEnabled ? 1 : 0,
        branding ? JSON.stringify(branding) : null,
        config ? JSON.stringify(config) : null,
        updatedBy,
      ]
    );

    return getCategoryToolConfig(categoryId, toolName)!;
  }
}

/**
 * Delete category tool config (resets to inherit from global)
 */
export function deleteCategoryToolConfig(
  categoryId: number,
  toolName: string
): boolean {
  const existing = getCategoryToolConfig(categoryId, toolName);
  if (!existing) return false;

  execute(
    'DELETE FROM category_tool_configs WHERE category_id = ? AND tool_name = ?',
    [categoryId, toolName]
  );

  return true;
}

/**
 * Delete all category tool configs for a category
 */
export function deleteAllCategoryToolConfigs(categoryId: number): number {
  const result = execute(
    'DELETE FROM category_tool_configs WHERE category_id = ?',
    [categoryId]
  );
  return result.changes;
}

// ============ Effective Config Resolution ============

/**
 * Get the effective tool configuration for a category
 * Merges global config with category overrides
 */
export function getEffectiveToolConfig(
  toolName: string,
  categoryId: number
): {
  enabled: boolean;
  branding: BrandingConfig | null;
  config: Record<string, unknown> | null;
  globalConfig: ToolConfig | undefined;
  categoryOverride: CategoryToolConfig | undefined;
} {
  const globalConfig = getToolConfig(toolName);
  const categoryOverride = getCategoryToolConfig(categoryId, toolName);

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
export function isToolEnabledForCategory(toolName: string, categoryId: number): boolean {
  const { enabled } = getEffectiveToolConfig(toolName, categoryId);
  return enabled;
}

/**
 * Get branding config for a specific category
 */
export function getBrandingForCategory(
  toolName: string,
  categoryId: number
): BrandingConfig | null {
  const { branding } = getEffectiveToolConfig(toolName, categoryId);
  return branding;
}

/**
 * Tool Configuration Database Operations
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb, transaction } from '../kysely';
import { v4 as uuidv4 } from 'uuid';

// Re-export types and constants from sync module
export type { ToolConfig, ToolConfigAuditEntry } from '../tool-config';
export { TOOL_DEFAULTS, getToolDefaultsForTool } from '../utils';

import type { ToolConfig, ToolConfigAuditEntry } from '../tool-config';

// ============ Helper Functions ============

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
export async function getToolConfig(toolName: string): Promise<ToolConfig | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('tool_configs')
    .selectAll()
    .where('tool_name', '=', toolName)
    .executeTakeFirst();

  return row ? mapDbToToolConfig(row as unknown as DbToolConfig) : undefined;
}

/**
 * Get all tool configurations
 */
export async function getAllToolConfigs(): Promise<ToolConfig[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('tool_configs')
    .selectAll()
    .orderBy('tool_name')
    .execute();

  return rows.map((row) => mapDbToToolConfig(row as unknown as DbToolConfig));
}

/**
 * Check if a tool is enabled
 */
export async function isToolEnabled(toolName: string): Promise<boolean> {
  const config = await getToolConfig(toolName);
  return config?.isEnabled ?? false;
}

/**
 * Create a new tool configuration
 */
export async function createToolConfig(
  toolName: string,
  config: Record<string, unknown>,
  isEnabled: boolean,
  updatedBy: string
): Promise<ToolConfig> {
  const id = uuidv4();
  const configJson = JSON.stringify(config);

  return transaction(async (trx) => {
    await trx
      .insertInto('tool_configs')
      .values({
        id,
        tool_name: toolName,
        is_enabled: isEnabled ? 1 : 0,
        config_json: configJson,
        updated_by: updatedBy,
      })
      .execute();

    // Record audit entry
    await trx
      .insertInto('tool_config_audit')
      .values({
        tool_name: toolName,
        operation: 'create',
        old_config: null,
        new_config: configJson,
        changed_by: updatedBy,
      })
      .execute();

    const row = await trx
      .selectFrom('tool_configs')
      .selectAll()
      .where('tool_name', '=', toolName)
      .executeTakeFirstOrThrow();

    return mapDbToToolConfig(row as unknown as DbToolConfig);
  });
}

/**
 * Update a tool configuration
 */
export async function updateToolConfig(
  toolName: string,
  updates: {
    isEnabled?: boolean;
    config?: Record<string, unknown>;
    descriptionOverride?: string | null;
  },
  updatedBy: string
): Promise<ToolConfig | undefined> {
  const existing = await getToolConfig(toolName);
  if (!existing) return undefined;

  const newEnabled = updates.isEnabled ?? existing.isEnabled;
  const newConfig = updates.config ?? existing.config;
  const newConfigJson = JSON.stringify(newConfig);
  const oldConfigJson = JSON.stringify(existing.config);
  // Handle descriptionOverride: undefined means keep existing, null means clear it
  const newDescriptionOverride = updates.descriptionOverride !== undefined
    ? updates.descriptionOverride
    : existing.descriptionOverride;

  return transaction(async (trx) => {
    await trx
      .updateTable('tool_configs')
      .set({
        is_enabled: newEnabled ? 1 : 0,
        config_json: newConfigJson,
        description_override: newDescriptionOverride,
        updated_by: updatedBy,
      })
      .where('tool_name', '=', toolName)
      .execute();

    // Record audit entry
    await trx
      .insertInto('tool_config_audit')
      .values({
        tool_name: toolName,
        operation: 'update',
        old_config: oldConfigJson,
        new_config: newConfigJson,
        changed_by: updatedBy,
      })
      .execute();

    const row = await trx
      .selectFrom('tool_configs')
      .selectAll()
      .where('tool_name', '=', toolName)
      .executeTakeFirstOrThrow();

    return mapDbToToolConfig(row as unknown as DbToolConfig);
  });
}

/**
 * Delete a tool configuration
 */
export async function deleteToolConfig(toolName: string, deletedBy: string): Promise<boolean> {
  const existing = await getToolConfig(toolName);
  if (!existing) return false;

  const oldConfigJson = JSON.stringify(existing.config);

  return transaction(async (trx) => {
    await trx
      .deleteFrom('tool_configs')
      .where('tool_name', '=', toolName)
      .execute();

    // Record audit entry
    await trx
      .insertInto('tool_config_audit')
      .values({
        tool_name: toolName,
        operation: 'delete',
        old_config: oldConfigJson,
        new_config: null,
        changed_by: deletedBy,
      })
      .execute();

    return true;
  });
}

/**
 * Get audit history for a tool
 */
export async function getToolConfigAuditHistory(
  toolName: string,
  limit: number = 50
): Promise<ToolConfigAuditEntry[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('tool_config_audit')
    .selectAll()
    .where('tool_name', '=', toolName)
    .orderBy('changed_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map((row) => mapDbToAuditEntry(row as unknown as DbToolConfigAudit));
}

/**
 * Get all audit entries (for admin overview)
 */
export async function getAllToolConfigAuditHistory(limit: number = 100): Promise<ToolConfigAuditEntry[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('tool_config_audit')
    .selectAll()
    .orderBy('changed_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map((row) => mapDbToAuditEntry(row as unknown as DbToolConfigAudit));
}

// ============ Migration Helpers ============

/**
 * Migrate existing Tavily settings from the settings table to tool_configs
 * This is called on first load to seed the web_search tool config
 */
export async function migrateTavilySettingsIfNeeded(): Promise<void> {
  // Check if web_search already exists in tool_configs
  const existing = await getToolConfig('web_search');
  if (existing) return;

  // For PostgreSQL, we import settings from config which will use SQLite in hybrid mode
  // This is acceptable during Phase 1 as settings remain in SQLite
  const { getTavilySettings } = await import('../config');
  const tavilySettings = getTavilySettings();

  // Create the tool config from existing settings
  await createToolConfig(
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

  console.log('[Tools] Migrated Tavily settings to tool_configs table (PostgreSQL)');
}

/**
 * Get web search settings (with backward compatibility)
 * Tries tool_configs first, falls back to settings table
 */
export async function getWebSearchConfig(): Promise<{
  enabled: boolean;
  config: import('../config').TavilySettings;
}> {
  const toolConfig = await getToolConfig('web_search');

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

  // Fallback to settings table (Phase 1: settings still in SQLite)
  const { getTavilySettings } = await import('../config');
  const tavilySettings = getTavilySettings();
  return {
    enabled: tavilySettings.enabled,
    config: tavilySettings,
  };
}

/**
 * Ensure all registered tools have configurations in the database
 * This is called during initialization to seed missing tool configs
 */
export async function ensureToolConfigsExist(updatedBy: string = 'system'): Promise<void> {
  const { TOOL_DEFAULTS, getToolDefaultsForTool } = await import('../utils');

  for (const toolName of Object.keys(TOOL_DEFAULTS)) {
    const existing = await getToolConfig(toolName);
    if (!existing) {
      // Use dynamic defaults where available
      const defaults = getToolDefaultsForTool(toolName) || TOOL_DEFAULTS[toolName];
      await createToolConfig(toolName, defaults.config, defaults.enabled, updatedBy);
      console.log(`[Tools] Created default config for tool: ${toolName} (PostgreSQL)`);
    }
  }
}

/**
 * Reset a tool to its default configuration
 */
export async function resetToolToDefaults(toolName: string, updatedBy: string): Promise<ToolConfig | undefined> {
  const { getToolDefaultsForTool } = await import('../utils');
  // Use dynamic defaults where available
  const defaults = getToolDefaultsForTool(toolName);
  if (!defaults) return undefined;

  return updateToolConfig(toolName, {
    isEnabled: defaults.enabled,
    config: defaults.config,
    descriptionOverride: null, // Clear any description override on reset
  }, updatedBy);
}

/**
 * Get the description override for a tool (if any)
 * Used by getToolDefinitions() to apply admin-customized descriptions
 */
export async function getDescriptionOverride(toolName: string): Promise<string | null> {
  const config = await getToolConfig(toolName);
  return config?.descriptionOverride ?? null;
}

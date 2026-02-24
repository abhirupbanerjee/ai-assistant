/**
 * Agent Bot Database Operations
 *
 * CRUD operations for agent bots - API-accessible bots
 * that can be called by external systems with defined inputs/outputs.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase, queryAll, queryOne, execute, transaction } from './index';
import type {
  AgentBot,
  AgentBotWithRelations,
  AgentBotRow,
  AgentBotVersionSummary,
  CreatorRole,
  CreateAgentBotInput,
  UpdateAgentBotInput,
} from '@/types/agent-bot';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a URL-safe slug from a name
 */
export function generateSlugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

/**
 * Ensure slug is unique by appending a number if needed
 */
function ensureUniqueSlug(baseSlug: string, excludeId?: string): string {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = queryOne<{ id: string }>(
      excludeId
        ? 'SELECT id FROM agent_bots WHERE slug = ? AND id != ?'
        : 'SELECT id FROM agent_bots WHERE slug = ?',
      excludeId ? [slug, excludeId] : [slug]
    );

    if (!existing) break;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

/**
 * Convert database row to AgentBot object
 */
function rowToAgentBot(row: AgentBotRow): AgentBot {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    is_active: row.is_active === 1,
    created_by: row.created_by,
    created_by_role: row.created_by_role as CreatorRole,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ============================================================================
// Agent Bot CRUD
// ============================================================================

/**
 * Get agent bot by ID
 */
export function getAgentBotById(id: string): AgentBot | null {
  const row = queryOne<AgentBotRow>(
    'SELECT * FROM agent_bots WHERE id = ?',
    [id]
  );
  return row ? rowToAgentBot(row) : null;
}

/**
 * Get agent bot by slug (used for public API access)
 */
export function getAgentBotBySlug(slug: string): AgentBot | null {
  const row = queryOne<AgentBotRow>(
    'SELECT * FROM agent_bots WHERE slug = ?',
    [slug]
  );
  return row ? rowToAgentBot(row) : null;
}

/**
 * Get agent bot with versions and stats
 */
export function getAgentBotWithRelations(id: string): AgentBotWithRelations | null {
  const bot = getAgentBotById(id);
  if (!bot) return null;

  // Get version summaries
  const versionRows = queryAll<{
    id: string;
    version_number: number;
    version_label: string | null;
    is_default: number;
    is_active: number;
    created_at: string;
  }>(
    `SELECT id, version_number, version_label, is_default, is_active, created_at
     FROM agent_bot_versions
     WHERE agent_bot_id = ?
     ORDER BY version_number DESC`,
    [id]
  );

  const versions: AgentBotVersionSummary[] = versionRows.map((v) => ({
    id: v.id,
    version_number: v.version_number,
    version_label: v.version_label,
    is_default: v.is_default === 1,
    is_active: v.is_active === 1,
    created_at: v.created_at,
  }));

  // Get default version ID
  const defaultVersion = versions.find((v) => v.is_default);

  // Get API key count
  const keyCount = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM agent_bot_api_keys WHERE agent_bot_id = ? AND is_active = 1',
    [id]
  );

  // Get total jobs count
  const jobCount = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM agent_bot_jobs WHERE agent_bot_id = ?',
    [id]
  );

  return {
    ...bot,
    versions,
    default_version_id: defaultVersion?.id || null,
    api_key_count: keyCount?.count || 0,
    total_jobs: jobCount?.count || 0,
  };
}

/**
 * List all agent bots
 */
export function listAgentBots(): AgentBotWithRelations[] {
  const rows = queryAll<AgentBotRow>(
    'SELECT * FROM agent_bots ORDER BY created_at DESC'
  );

  return rows.map((row) => {
    const bot = rowToAgentBot(row);

    // Get version count and default
    const versionInfo = queryOne<{
      version_count: number;
      default_version_id: string | null;
    }>(
      `SELECT
        COUNT(*) as version_count,
        (SELECT id FROM agent_bot_versions WHERE agent_bot_id = ? AND is_default = 1 LIMIT 1) as default_version_id
       FROM agent_bot_versions WHERE agent_bot_id = ?`,
      [bot.id, bot.id]
    );

    // Get version summaries
    const versionRows = queryAll<{
      id: string;
      version_number: number;
      version_label: string | null;
      is_default: number;
      is_active: number;
      created_at: string;
    }>(
      `SELECT id, version_number, version_label, is_default, is_active, created_at
       FROM agent_bot_versions
       WHERE agent_bot_id = ?
       ORDER BY version_number DESC`,
      [bot.id]
    );

    const versions: AgentBotVersionSummary[] = versionRows.map((v) => ({
      id: v.id,
      version_number: v.version_number,
      version_label: v.version_label,
      is_default: v.is_default === 1,
      is_active: v.is_active === 1,
      created_at: v.created_at,
    }));

    // Get API key count
    const keyCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM agent_bot_api_keys WHERE agent_bot_id = ? AND is_active = 1',
      [bot.id]
    );

    // Get total jobs count
    const jobCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM agent_bot_jobs WHERE agent_bot_id = ?',
      [bot.id]
    );

    return {
      ...bot,
      versions,
      default_version_id: versionInfo?.default_version_id || null,
      api_key_count: keyCount?.count || 0,
      total_jobs: jobCount?.count || 0,
    };
  });
}

/**
 * List agent bots created by a specific user (for superuser scope)
 */
export function listAgentBotsByCreator(createdBy: string): AgentBotWithRelations[] {
  const rows = queryAll<AgentBotRow>(
    'SELECT * FROM agent_bots WHERE created_by = ? ORDER BY created_at DESC',
    [createdBy]
  );

  return rows.map((row) => {
    const bot = rowToAgentBot(row);

    const versionRows = queryAll<{
      id: string;
      version_number: number;
      version_label: string | null;
      is_default: number;
      is_active: number;
      created_at: string;
    }>(
      `SELECT id, version_number, version_label, is_default, is_active, created_at
       FROM agent_bot_versions
       WHERE agent_bot_id = ?
       ORDER BY version_number DESC`,
      [bot.id]
    );

    const versions: AgentBotVersionSummary[] = versionRows.map((v) => ({
      id: v.id,
      version_number: v.version_number,
      version_label: v.version_label,
      is_default: v.is_default === 1,
      is_active: v.is_active === 1,
      created_at: v.created_at,
    }));

    const defaultVersion = versions.find((v) => v.is_default);

    const keyCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM agent_bot_api_keys WHERE agent_bot_id = ? AND is_active = 1',
      [bot.id]
    );

    const jobCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM agent_bot_jobs WHERE agent_bot_id = ?',
      [bot.id]
    );

    return {
      ...bot,
      versions,
      default_version_id: defaultVersion?.id || null,
      api_key_count: keyCount?.count || 0,
      total_jobs: jobCount?.count || 0,
    };
  });
}

/**
 * Create a new agent bot
 */
export function createAgentBot(
  input: CreateAgentBotInput,
  createdBy: string,
  role: CreatorRole
): AgentBot {
  const id = uuidv4();
  const baseSlug = input.slug || generateSlugFromName(input.name);
  const slug = ensureUniqueSlug(baseSlug);

  execute(
    `INSERT INTO agent_bots (id, name, slug, description, is_active, created_by, created_by_role)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [id, input.name, slug, input.description || null, createdBy, role]
  );

  return getAgentBotById(id)!;
}

/**
 * Update an agent bot
 */
export function updateAgentBot(id: string, updates: UpdateAgentBotInput): AgentBot | null {
  const existing = getAgentBotById(id);
  if (!existing) return null;

  const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    setClauses.push('name = ?');
    params.push(updates.name);
  }

  if (updates.description !== undefined) {
    setClauses.push('description = ?');
    params.push(updates.description);
  }

  if (updates.is_active !== undefined) {
    setClauses.push('is_active = ?');
    params.push(updates.is_active ? 1 : 0);
  }

  params.push(id);

  if (setClauses.length > 1) {
    execute(
      `UPDATE agent_bots SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );
  }

  return getAgentBotById(id);
}

/**
 * Delete an agent bot and all related data
 */
export function deleteAgentBot(id: string): boolean {
  const result = execute('DELETE FROM agent_bots WHERE id = ?', [id]);
  return result.changes > 0;
}

/**
 * Toggle agent bot active status
 */
export function toggleAgentBotActive(id: string, isActive: boolean): AgentBot | null {
  execute(
    'UPDATE agent_bots SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [isActive ? 1 : 0, id]
  );
  return getAgentBotById(id);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if name exists (for validation)
 */
export function nameExists(name: string, excludeId?: string): boolean {
  const result = queryOne<{ count: number }>(
    excludeId
      ? 'SELECT COUNT(*) as count FROM agent_bots WHERE name = ? AND id != ?'
      : 'SELECT COUNT(*) as count FROM agent_bots WHERE name = ?',
    excludeId ? [name, excludeId] : [name]
  );
  return (result?.count || 0) > 0;
}

/**
 * Check if slug exists (for validation)
 */
export function slugExists(slug: string, excludeId?: string): boolean {
  const result = queryOne<{ count: number }>(
    excludeId
      ? 'SELECT COUNT(*) as count FROM agent_bots WHERE slug = ? AND id != ?'
      : 'SELECT COUNT(*) as count FROM agent_bots WHERE slug = ?',
    excludeId ? [slug, excludeId] : [slug]
  );
  return (result?.count || 0) > 0;
}

/**
 * Search agent bots by name
 */
export function searchAgentBots(query: string): AgentBotWithRelations[] {
  const searchPattern = `%${query}%`;
  const rows = queryAll<AgentBotRow>(
    'SELECT * FROM agent_bots WHERE name LIKE ? OR description LIKE ? ORDER BY created_at DESC',
    [searchPattern, searchPattern]
  );

  return rows.map((row) => {
    const bot = rowToAgentBot(row);

    const versionRows = queryAll<{
      id: string;
      version_number: number;
      version_label: string | null;
      is_default: number;
      is_active: number;
      created_at: string;
    }>(
      `SELECT id, version_number, version_label, is_default, is_active, created_at
       FROM agent_bot_versions
       WHERE agent_bot_id = ?
       ORDER BY version_number DESC`,
      [bot.id]
    );

    const versions: AgentBotVersionSummary[] = versionRows.map((v) => ({
      id: v.id,
      version_number: v.version_number,
      version_label: v.version_label,
      is_default: v.is_default === 1,
      is_active: v.is_active === 1,
      created_at: v.created_at,
    }));

    const defaultVersion = versions.find((v) => v.is_default);

    const keyCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM agent_bot_api_keys WHERE agent_bot_id = ? AND is_active = 1',
      [bot.id]
    );

    const jobCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM agent_bot_jobs WHERE agent_bot_id = ?',
      [bot.id]
    );

    return {
      ...bot,
      versions,
      default_version_id: defaultVersion?.id || null,
      api_key_count: keyCount?.count || 0,
      total_jobs: jobCount?.count || 0,
    };
  });
}

/**
 * Get agent bot count
 */
export function getAgentBotCount(): { total: number; active: number } {
  const total = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM agent_bots',
    []
  );
  const active = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM agent_bots WHERE is_active = 1',
    []
  );
  return {
    total: total?.count || 0,
    active: active?.count || 0,
  };
}

/**
 * Get active agent bot by slug (for API invocation)
 */
export function getActiveAgentBotBySlug(slug: string): AgentBot | null {
  const row = queryOne<AgentBotRow>(
    'SELECT * FROM agent_bots WHERE slug = ? AND is_active = 1',
    [slug]
  );
  return row ? rowToAgentBot(row) : null;
}

/**
 * Get all unique category IDs linked to an agent bot (across all versions)
 * Used for access control (e.g., superuser category-based access)
 */
export function getAgentBotCategoryIds(agentBotId: string): number[] {
  const result = queryAll<{ category_id: number }>(
    `SELECT DISTINCT vc.category_id
     FROM agent_bot_version_categories vc
     JOIN agent_bot_versions v ON vc.version_id = v.id
     WHERE v.agent_bot_id = ?`,
    [agentBotId]
  );
  return result.map((r) => r.category_id);
}

/**
 * Check if a superuser has access to an agent bot based on category overlap
 * Returns true if any of the user's categories match any of the agent bot's categories
 */
export function checkSuperuserAgentBotAccess(
  agentBotId: string,
  userCategoryIds: number[]
): boolean {
  if (userCategoryIds.length === 0) return false;

  const agentBotCategoryIds = getAgentBotCategoryIds(agentBotId);
  if (agentBotCategoryIds.length === 0) return false;

  // Check for any overlap
  return agentBotCategoryIds.some((catId) => userCategoryIds.includes(catId));
}

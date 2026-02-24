/**
 * Agent Bot Version Database Operations
 *
 * CRUD operations for versioned configurations of agent bots.
 * Each version defines input schemas, output configs, linked categories/skills/tools.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase, queryAll, queryOne, execute, transaction } from './index';
import type {
  AgentBotVersion,
  AgentBotVersionWithRelations,
  AgentBotVersionRow,
  AgentBotVersionTool,
  AgentBotVersionToolRow,
  InputSchema,
  OutputConfig,
  CreateAgentBotVersionInput,
  UpdateAgentBotVersionInput,
} from '@/types/agent-bot';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert database row to AgentBotVersion object
 */
function rowToVersion(row: AgentBotVersionRow): AgentBotVersion {
  return {
    id: row.id,
    agent_bot_id: row.agent_bot_id,
    version_number: row.version_number,
    version_label: row.version_label,
    is_default: row.is_default === 1,
    input_schema: JSON.parse(row.input_schema) as InputSchema,
    output_config: JSON.parse(row.output_config) as OutputConfig,
    system_prompt: row.system_prompt,
    llm_model: row.llm_model,
    temperature: row.temperature,
    max_tokens: row.max_tokens,
    is_active: row.is_active === 1,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Convert tool row to AgentBotVersionTool object
 */
function rowToTool(row: AgentBotVersionToolRow): AgentBotVersionTool {
  return {
    id: row.id,
    version_id: row.version_id,
    tool_name: row.tool_name,
    is_enabled: row.is_enabled === 1,
    config_override: row.config_override ? JSON.parse(row.config_override) : null,
  };
}

// ============================================================================
// Version CRUD
// ============================================================================

/**
 * Get version by ID
 */
export function getVersionById(id: string): AgentBotVersion | null {
  const row = queryOne<AgentBotVersionRow>(
    'SELECT * FROM agent_bot_versions WHERE id = ?',
    [id]
  );
  return row ? rowToVersion(row) : null;
}

/**
 * Get version with all relations (categories, skills, tools)
 */
export function getVersionWithRelations(id: string): AgentBotVersionWithRelations | null {
  const version = getVersionById(id);
  if (!version) return null;

  // Get linked category IDs and names
  const categories = queryAll<{ category_id: number; name: string }>(
    `SELECT vc.category_id, c.name
     FROM agent_bot_version_categories vc
     JOIN categories c ON vc.category_id = c.id
     WHERE vc.version_id = ?`,
    [id]
  );

  // Get linked skill IDs and names
  const skills = queryAll<{ skill_id: number; name: string }>(
    `SELECT vs.skill_id, s.name
     FROM agent_bot_version_skills vs
     JOIN skills s ON vs.skill_id = s.id
     WHERE vs.version_id = ?`,
    [id]
  );

  // Get tool configurations
  const toolRows = queryAll<AgentBotVersionToolRow>(
    'SELECT * FROM agent_bot_version_tools WHERE version_id = ?',
    [id]
  );

  return {
    ...version,
    category_ids: categories.map((c) => c.category_id),
    category_names: categories.map((c) => c.name),
    skill_ids: skills.map((s) => s.skill_id),
    skill_names: skills.map((s) => s.name),
    tools: toolRows.map(rowToTool),
  };
}

/**
 * List versions for an agent bot
 */
export function listVersions(agentBotId: string): AgentBotVersionWithRelations[] {
  const rows = queryAll<AgentBotVersionRow>(
    'SELECT * FROM agent_bot_versions WHERE agent_bot_id = ? ORDER BY version_number DESC',
    [agentBotId]
  );

  return rows.map((row) => {
    const version = rowToVersion(row);

    const categories = queryAll<{ category_id: number; name: string }>(
      `SELECT vc.category_id, c.name
       FROM agent_bot_version_categories vc
       JOIN categories c ON vc.category_id = c.id
       WHERE vc.version_id = ?`,
      [version.id]
    );

    const skills = queryAll<{ skill_id: number; name: string }>(
      `SELECT vs.skill_id, s.name
       FROM agent_bot_version_skills vs
       JOIN skills s ON vs.skill_id = s.id
       WHERE vs.version_id = ?`,
      [version.id]
    );

    const toolRows = queryAll<AgentBotVersionToolRow>(
      'SELECT * FROM agent_bot_version_tools WHERE version_id = ?',
      [version.id]
    );

    return {
      ...version,
      category_ids: categories.map((c) => c.category_id),
      category_names: categories.map((c) => c.name),
      skill_ids: skills.map((s) => s.skill_id),
      skill_names: skills.map((s) => s.name),
      tools: toolRows.map(rowToTool),
    };
  });
}

/**
 * Get the default version for an agent bot
 */
export function getDefaultVersion(agentBotId: string): AgentBotVersionWithRelations | null {
  const row = queryOne<AgentBotVersionRow>(
    'SELECT * FROM agent_bot_versions WHERE agent_bot_id = ? AND is_default = 1 AND is_active = 1',
    [agentBotId]
  );

  if (!row) {
    // Fall back to highest version number if no default is set
    const fallback = queryOne<AgentBotVersionRow>(
      'SELECT * FROM agent_bot_versions WHERE agent_bot_id = ? AND is_active = 1 ORDER BY version_number DESC LIMIT 1',
      [agentBotId]
    );
    if (!fallback) return null;
    return getVersionWithRelations(fallback.id);
  }

  return getVersionWithRelations(row.id);
}

/**
 * Get a specific version by number
 */
export function getVersionByNumber(
  agentBotId: string,
  versionNumber: number
): AgentBotVersionWithRelations | null {
  const row = queryOne<AgentBotVersionRow>(
    'SELECT * FROM agent_bot_versions WHERE agent_bot_id = ? AND version_number = ?',
    [agentBotId, versionNumber]
  );

  if (!row) return null;
  return getVersionWithRelations(row.id);
}

/**
 * Get the next version number for an agent bot
 */
function getNextVersionNumber(agentBotId: string): number {
  const result = queryOne<{ max_version: number | null }>(
    'SELECT MAX(version_number) as max_version FROM agent_bot_versions WHERE agent_bot_id = ?',
    [agentBotId]
  );
  return (result?.max_version || 0) + 1;
}

/**
 * Create a new version for an agent bot
 */
export function createVersion(
  agentBotId: string,
  input: CreateAgentBotVersionInput,
  createdBy: string
): AgentBotVersionWithRelations {
  const id = uuidv4();
  const versionNumber = getNextVersionNumber(agentBotId);

  return transaction(() => {
    // If this is the first version or is_default is true, clear other defaults
    if (input.is_default !== false) {
      const existingVersions = queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM agent_bot_versions WHERE agent_bot_id = ?',
        [agentBotId]
      );

      if (existingVersions?.count === 0 || input.is_default) {
        execute(
          'UPDATE agent_bot_versions SET is_default = 0 WHERE agent_bot_id = ?',
          [agentBotId]
        );
      }
    }

    // Insert version
    execute(
      `INSERT INTO agent_bot_versions (
        id, agent_bot_id, version_number, version_label, is_default,
        input_schema, output_config, system_prompt, llm_model, temperature, max_tokens,
        is_active, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        id,
        agentBotId,
        versionNumber,
        input.version_label || null,
        input.is_default !== false ? 1 : 0, // Default to true for first version
        JSON.stringify(input.input_schema),
        JSON.stringify(input.output_config),
        input.system_prompt || null,
        input.llm_model || null,
        input.temperature ?? null,
        input.max_tokens ?? null,
        createdBy,
      ]
    );

    // Link categories
    if (input.category_ids && input.category_ids.length > 0) {
      linkCategories(id, input.category_ids);
    }

    // Link skills
    if (input.skill_ids && input.skill_ids.length > 0) {
      linkSkills(id, input.skill_ids);
    }

    // Add tool configurations
    if (input.tools && input.tools.length > 0) {
      for (const tool of input.tools) {
        addTool(id, tool.tool_name, tool.is_enabled, tool.config_override);
      }
    }

    return getVersionWithRelations(id)!;
  });
}

/**
 * Update a version
 */
export function updateVersion(
  id: string,
  updates: UpdateAgentBotVersionInput
): AgentBotVersionWithRelations | null {
  const existing = getVersionById(id);
  if (!existing) return null;

  return transaction(() => {
    const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const params: unknown[] = [];

    if (updates.version_label !== undefined) {
      setClauses.push('version_label = ?');
      params.push(updates.version_label);
    }

    if (updates.is_default !== undefined) {
      if (updates.is_default) {
        // Clear other defaults first
        execute(
          'UPDATE agent_bot_versions SET is_default = 0 WHERE agent_bot_id = ?',
          [existing.agent_bot_id]
        );
      }
      setClauses.push('is_default = ?');
      params.push(updates.is_default ? 1 : 0);
    }

    if (updates.is_active !== undefined) {
      setClauses.push('is_active = ?');
      params.push(updates.is_active ? 1 : 0);
    }

    if (updates.input_schema !== undefined) {
      setClauses.push('input_schema = ?');
      params.push(JSON.stringify(updates.input_schema));
    }

    if (updates.output_config !== undefined) {
      setClauses.push('output_config = ?');
      params.push(JSON.stringify(updates.output_config));
    }

    if (updates.system_prompt !== undefined) {
      setClauses.push('system_prompt = ?');
      params.push(updates.system_prompt);
    }

    if (updates.llm_model !== undefined) {
      setClauses.push('llm_model = ?');
      params.push(updates.llm_model);
    }

    if (updates.temperature !== undefined) {
      setClauses.push('temperature = ?');
      params.push(updates.temperature);
    }

    if (updates.max_tokens !== undefined) {
      setClauses.push('max_tokens = ?');
      params.push(updates.max_tokens);
    }

    params.push(id);

    if (setClauses.length > 1) {
      execute(
        `UPDATE agent_bot_versions SET ${setClauses.join(', ')} WHERE id = ?`,
        params
      );
    }

    // Update category links if provided
    if (updates.category_ids !== undefined) {
      execute('DELETE FROM agent_bot_version_categories WHERE version_id = ?', [id]);
      if (updates.category_ids.length > 0) {
        linkCategories(id, updates.category_ids);
      }
    }

    // Update skill links if provided
    if (updates.skill_ids !== undefined) {
      execute('DELETE FROM agent_bot_version_skills WHERE version_id = ?', [id]);
      if (updates.skill_ids.length > 0) {
        linkSkills(id, updates.skill_ids);
      }
    }

    // Update tools if provided
    if (updates.tools !== undefined) {
      execute('DELETE FROM agent_bot_version_tools WHERE version_id = ?', [id]);
      for (const tool of updates.tools) {
        addTool(id, tool.tool_name, tool.is_enabled, tool.config_override);
      }
    }

    return getVersionWithRelations(id);
  });
}

/**
 * Delete a version
 */
export function deleteVersion(id: string): boolean {
  const result = execute('DELETE FROM agent_bot_versions WHERE id = ?', [id]);
  return result.changes > 0;
}

/**
 * Set a version as the default
 */
export function setDefaultVersion(id: string): AgentBotVersionWithRelations | null {
  const version = getVersionById(id);
  if (!version) return null;

  transaction(() => {
    // Clear other defaults
    execute(
      'UPDATE agent_bot_versions SET is_default = 0 WHERE agent_bot_id = ?',
      [version.agent_bot_id]
    );

    // Set this version as default
    execute(
      'UPDATE agent_bot_versions SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );
  });

  return getVersionWithRelations(id);
}

// ============================================================================
// Category Linking
// ============================================================================

/**
 * Link categories to a version
 */
function linkCategories(versionId: string, categoryIds: number[]): void {
  const db = getDatabase();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO agent_bot_version_categories (version_id, category_id) VALUES (?, ?)'
  );

  for (const categoryId of categoryIds) {
    stmt.run(versionId, categoryId);
  }
}

/**
 * Get category IDs linked to a version
 */
export function getVersionCategoryIds(versionId: string): number[] {
  return queryAll<{ category_id: number }>(
    'SELECT category_id FROM agent_bot_version_categories WHERE version_id = ?',
    [versionId]
  ).map((r) => r.category_id);
}

// ============================================================================
// Skill Linking
// ============================================================================

/**
 * Link skills to a version
 */
function linkSkills(versionId: string, skillIds: number[]): void {
  const db = getDatabase();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO agent_bot_version_skills (version_id, skill_id) VALUES (?, ?)'
  );

  for (const skillId of skillIds) {
    stmt.run(versionId, skillId);
  }
}

/**
 * Get skill IDs linked to a version
 */
export function getVersionSkillIds(versionId: string): number[] {
  return queryAll<{ skill_id: number }>(
    'SELECT skill_id FROM agent_bot_version_skills WHERE version_id = ?',
    [versionId]
  ).map((r) => r.skill_id);
}

// ============================================================================
// Tool Configuration
// ============================================================================

/**
 * Add a tool configuration to a version
 */
function addTool(
  versionId: string,
  toolName: string,
  isEnabled: boolean,
  configOverride?: Record<string, unknown>
): void {
  execute(
    `INSERT INTO agent_bot_version_tools (id, version_id, tool_name, is_enabled, config_override)
     VALUES (?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      versionId,
      toolName,
      isEnabled ? 1 : 0,
      configOverride ? JSON.stringify(configOverride) : null,
    ]
  );
}

/**
 * Get tools for a version
 */
export function getVersionTools(versionId: string): AgentBotVersionTool[] {
  const rows = queryAll<AgentBotVersionToolRow>(
    'SELECT * FROM agent_bot_version_tools WHERE version_id = ?',
    [versionId]
  );
  return rows.map(rowToTool);
}

/**
 * Get enabled tools for a version (for execution)
 */
export function getEnabledVersionTools(versionId: string): AgentBotVersionTool[] {
  const rows = queryAll<AgentBotVersionToolRow>(
    'SELECT * FROM agent_bot_version_tools WHERE version_id = ? AND is_enabled = 1',
    [versionId]
  );
  return rows.map(rowToTool);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Duplicate a version (for creating a new version based on an existing one)
 */
export function duplicateVersion(
  sourceVersionId: string,
  createdBy: string,
  updates?: Partial<CreateAgentBotVersionInput>
): AgentBotVersionWithRelations | null {
  const source = getVersionWithRelations(sourceVersionId);
  if (!source) return null;

  const input: CreateAgentBotVersionInput = {
    version_label: updates?.version_label || `Copy of v${source.version_number}`,
    is_default: updates?.is_default ?? false,
    input_schema: updates?.input_schema || source.input_schema,
    output_config: updates?.output_config || source.output_config,
    system_prompt: updates?.system_prompt ?? source.system_prompt ?? undefined,
    llm_model: updates?.llm_model ?? source.llm_model ?? undefined,
    temperature: updates?.temperature ?? source.temperature ?? undefined,
    max_tokens: updates?.max_tokens ?? source.max_tokens ?? undefined,
    category_ids: updates?.category_ids || source.category_ids,
    skill_ids: updates?.skill_ids || source.skill_ids,
    tools:
      updates?.tools ||
      source.tools.map((t) => ({
        tool_name: t.tool_name,
        is_enabled: t.is_enabled,
        config_override: t.config_override || undefined,
      })),
  };

  return createVersion(source.agent_bot_id, input, createdBy);
}

/**
 * Get version count for an agent bot
 */
export function getVersionCount(agentBotId: string): number {
  const result = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM agent_bot_versions WHERE agent_bot_id = ?',
    [agentBotId]
  );
  return result?.count || 0;
}

/**
 * Get active version count for an agent bot
 */
export function getActiveVersionCount(agentBotId: string): number {
  const result = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM agent_bot_versions WHERE agent_bot_id = ? AND is_active = 1',
    [agentBotId]
  );
  return result?.count || 0;
}

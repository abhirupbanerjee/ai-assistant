/**
 * Skills Database Operations
 *
 * CRUD operations for the modular prompt skills system
 */

import { execute, queryOne, queryAll } from './index';
import type {
  Skill,
  SkillWithCategories,
  CreateSkillInput,
  TriggerType,
  MatchType,
  ForceMode,
  DataSourceFilter,
  SkillComplianceConfig,
} from '../skills/types';

// ============ Helper: Convert SQLite integers to booleans ============

// SQLite returns integers for booleans, this is the raw row type from the database
interface SkillRow {
  id: number;
  name: string;
  description: string | null;
  prompt_content: string;
  trigger_type: TriggerType;
  trigger_value: string | null;
  category_restricted: number;
  is_index: number;
  priority: number;
  is_active: number;
  is_core: number;
  created_by_role: 'admin' | 'superuser';
  token_estimate: number | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;

  // Tool routing fields
  match_type: MatchType | null;
  tool_name: string | null;
  force_mode: ForceMode | null;
  tool_config_override: string | null;
  data_source_filter: string | null;

  // Compliance configuration
  compliance_config: string | null;
}

function mapSkillRow(row: SkillRow): Skill {
  // Parse JSON fields safely
  let toolConfigOverride: Record<string, unknown> | null = null;
  let dataSourceFilter: DataSourceFilter | null = null;
  let complianceConfig: SkillComplianceConfig | null = null;

  if (row.tool_config_override) {
    try {
      toolConfigOverride = JSON.parse(row.tool_config_override);
    } catch {
      // Invalid JSON, leave as null
    }
  }

  if (row.data_source_filter) {
    try {
      dataSourceFilter = JSON.parse(row.data_source_filter);
    } catch {
      // Invalid JSON, leave as null
    }
  }

  if (row.compliance_config) {
    try {
      complianceConfig = JSON.parse(row.compliance_config);
    } catch {
      // Invalid JSON, leave as null
    }
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    prompt_content: row.prompt_content,
    trigger_type: row.trigger_type,
    trigger_value: row.trigger_value,
    category_restricted: Boolean(row.category_restricted),
    is_index: Boolean(row.is_index),
    priority: row.priority,
    is_active: Boolean(row.is_active),
    is_core: Boolean(row.is_core),
    created_by_role: row.created_by_role,
    token_estimate: row.token_estimate,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    updated_by: row.updated_by,

    // Tool routing fields
    match_type: row.match_type || 'keyword',
    tool_name: row.tool_name,
    force_mode: row.force_mode,
    tool_config_override: toolConfigOverride,
    data_source_filter: dataSourceFilter,

    // Compliance configuration
    compliance_config: complianceConfig,
  };
}

// ============ Read Operations ============

/**
 * Get skill by ID with linked categories
 */
export function getSkillById(id: number): SkillWithCategories | null {
  const skill = queryOne<SkillRow>(
    'SELECT * FROM skills WHERE id = ?',
    [id]
  );

  if (!skill) return null;

  const categories = queryAll<{ id: number; name: string; slug: string }>(
    `SELECT c.id, c.name, c.slug
     FROM categories c
     JOIN category_skills cs ON c.id = cs.category_id
     WHERE cs.skill_id = ?`,
    [id]
  );

  return {
    ...mapSkillRow(skill),
    categories,
  };
}

/**
 * Get all skills with optional filters
 */
export function getAllSkills(filters?: {
  trigger_type?: TriggerType;
  is_active?: boolean;
  category_id?: number;
}): Skill[] {
  let sql = 'SELECT * FROM skills WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.trigger_type) {
    sql += ' AND trigger_type = ?';
    params.push(filters.trigger_type);
  }

  if (filters?.is_active !== undefined) {
    sql += ' AND is_active = ?';
    params.push(filters.is_active ? 1 : 0);
  }

  if (filters?.category_id) {
    sql += ' AND id IN (SELECT skill_id FROM category_skills WHERE category_id = ?)';
    params.push(filters.category_id);
  }

  sql += ' ORDER BY priority ASC, name ASC';

  const rows = queryAll<SkillRow>(sql, params);

  return rows.map(mapSkillRow);
}

/**
 * Get skills by trigger type
 */
export function getSkillsByTrigger(trigger_type: TriggerType): Skill[] {
  const rows = queryAll<SkillRow>(
    `SELECT * FROM skills
     WHERE trigger_type = ? AND is_active = 1
     ORDER BY priority ASC`,
    [trigger_type]
  );

  return rows.map(mapSkillRow);
}

/**
 * Get index skills for given categories
 * Index skills are broader domain expertise skills (one per category)
 */
export function getIndexSkillsForCategories(categoryIds: number[]): Skill[] {
  if (categoryIds.length === 0) return [];

  const placeholders = categoryIds.map(() => '?').join(',');
  const rows = queryAll<SkillRow>(
    `SELECT DISTINCT s.*
     FROM skills s
     JOIN category_skills cs ON s.id = cs.skill_id
     WHERE cs.category_id IN (${placeholders})
       AND s.is_active = 1
       AND s.trigger_type = 'category'
       AND s.is_index = 1
     ORDER BY s.priority ASC`,
    categoryIds
  );

  return rows.map(mapSkillRow);
}

/**
 * Get all keyword-triggered skills (active only)
 */
export function getKeywordSkills(): Skill[] {
  const rows = queryAll<SkillRow>(
    `SELECT * FROM skills
     WHERE trigger_type = 'keyword' AND is_active = 1
     ORDER BY priority ASC`
  );

  return rows.map(mapSkillRow);
}

/**
 * Get categories linked to a skill
 */
export function getCategoriesForSkill(skillId: number): { id: number; name: string }[] {
  return queryAll<{ id: number; name: string }>(
    `SELECT c.id, c.name
     FROM categories c
     JOIN category_skills cs ON c.id = cs.category_id
     WHERE cs.skill_id = ?`,
    [skillId]
  );
}

/**
 * Check if any skill with a specific tool matches a message
 * Used to replace hardcoded keyword patterns with database-driven config
 */
export function wouldToolSkillMatch(toolName: string, message: string): boolean {
  const skills = queryAll<SkillRow>(
    `SELECT * FROM skills
     WHERE tool_name = ? AND is_active = 1 AND trigger_type = 'keyword'
     ORDER BY priority ASC`,
    [toolName]
  );

  if (skills.length === 0) return false;

  const messageLower = message.toLowerCase();

  for (const row of skills) {
    const skill = mapSkillRow(row);
    if (!skill.trigger_value) continue;

    const patterns = skill.trigger_value.split(',').map(p => p.trim());

    if (skill.match_type === 'regex') {
      // Regex matching
      const matched = patterns.some(pattern => {
        try {
          const regex = new RegExp(pattern, 'i');
          return regex.test(message);
        } catch {
          return false;
        }
      });
      if (matched) return true;
    } else {
      // Keyword matching with word boundaries
      const matched = patterns.some(keyword => {
        const keywordLower = keyword.toLowerCase();
        const escapedKeyword = keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
        return regex.test(messageLower);
      });
      if (matched) return true;
    }
  }

  return false;
}

/**
 * Get skills by tool name (for checking keywords for a specific tool)
 */
export function getSkillsByTool(toolName: string): Skill[] {
  const rows = queryAll<SkillRow>(
    `SELECT * FROM skills
     WHERE tool_name = ? AND is_active = 1
     ORDER BY priority ASC`,
    [toolName]
  );

  return rows.map(mapSkillRow);
}

/**
 * Get all skills with their categories
 */
export function getAllSkillsWithCategories(): SkillWithCategories[] {
  const skills = getAllSkills();
  return skills.map(skill => {
    const categories = queryAll<{ id: number; name: string; slug: string }>(
      `SELECT c.id, c.name, c.slug
       FROM categories c
       JOIN category_skills cs ON c.id = cs.category_id
       WHERE cs.skill_id = ?`,
      [skill.id]
    );
    return { ...skill, categories };
  });
}

// ============ Write Operations ============

/**
 * Create a new skill
 */
export function createSkill(
  input: CreateSkillInput,
  createdBy: string,
  role: 'admin' | 'superuser'
): number {
  const tokenEstimate = Math.ceil(input.prompt_content.length / 4);

  // Serialize JSON fields
  const toolConfigOverride = input.tool_config_override
    ? JSON.stringify(input.tool_config_override)
    : null;
  const dataSourceFilter = input.data_source_filter
    ? JSON.stringify(input.data_source_filter)
    : null;
  const complianceConfig = input.compliance_config
    ? JSON.stringify(input.compliance_config)
    : null;

  const result = execute(
    `INSERT INTO skills (
      name, description, prompt_content, trigger_type, trigger_value,
      category_restricted, is_index, priority, is_active, is_core,
      created_by_role, token_estimate, created_by, updated_by,
      match_type, tool_name, force_mode, tool_config_override, data_source_filter,
      compliance_config
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.description || null,
      input.prompt_content,
      input.trigger_type,
      input.trigger_value || null,
      input.category_restricted ? 1 : 0,
      input.is_index ? 1 : 0,
      input.priority || 100,
      role,
      tokenEstimate,
      createdBy,
      createdBy,
      input.match_type || 'keyword',
      input.tool_name || null,
      input.force_mode || null,
      toolConfigOverride,
      dataSourceFilter,
      complianceConfig,
    ]
  );

  const skillId = result.lastInsertRowid as number;

  // Link to categories if provided
  if (input.category_ids && input.category_ids.length > 0) {
    for (const categoryId of input.category_ids) {
      execute(
        'INSERT INTO category_skills (category_id, skill_id) VALUES (?, ?)',
        [categoryId, skillId]
      );
    }
  }

  return skillId;
}

/**
 * Update an existing skill
 */
export function updateSkill(
  id: number,
  updates: Partial<CreateSkillInput> & { is_active?: boolean },
  updatedBy: string
): void {
  const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP', 'updated_by = ?'];
  const params: unknown[] = [updatedBy];

  if (updates.name !== undefined) {
    setClauses.push('name = ?');
    params.push(updates.name);
  }
  if (updates.description !== undefined) {
    setClauses.push('description = ?');
    params.push(updates.description);
  }
  if (updates.prompt_content !== undefined) {
    setClauses.push('prompt_content = ?');
    setClauses.push('token_estimate = ?');
    params.push(updates.prompt_content);
    params.push(Math.ceil(updates.prompt_content.length / 4));
  }
  if (updates.trigger_type !== undefined) {
    setClauses.push('trigger_type = ?');
    params.push(updates.trigger_type);
  }
  if (updates.trigger_value !== undefined) {
    setClauses.push('trigger_value = ?');
    params.push(updates.trigger_value);
  }
  if (updates.priority !== undefined) {
    setClauses.push('priority = ?');
    params.push(updates.priority);
  }
  if (updates.is_active !== undefined) {
    setClauses.push('is_active = ?');
    params.push(updates.is_active ? 1 : 0);
  }
  if (updates.category_restricted !== undefined) {
    setClauses.push('category_restricted = ?');
    params.push(updates.category_restricted ? 1 : 0);
  }
  if (updates.is_index !== undefined) {
    setClauses.push('is_index = ?');
    params.push(updates.is_index ? 1 : 0);
  }

  // Tool routing fields
  if (updates.match_type !== undefined) {
    setClauses.push('match_type = ?');
    params.push(updates.match_type);
  }
  if (updates.tool_name !== undefined) {
    setClauses.push('tool_name = ?');
    params.push(updates.tool_name || null);
  }
  if (updates.force_mode !== undefined) {
    setClauses.push('force_mode = ?');
    params.push(updates.force_mode || null);
  }
  if (updates.tool_config_override !== undefined) {
    setClauses.push('tool_config_override = ?');
    params.push(updates.tool_config_override ? JSON.stringify(updates.tool_config_override) : null);
  }
  if (updates.data_source_filter !== undefined) {
    setClauses.push('data_source_filter = ?');
    params.push(updates.data_source_filter ? JSON.stringify(updates.data_source_filter) : null);
  }
  if (updates.compliance_config !== undefined) {
    setClauses.push('compliance_config = ?');
    params.push(updates.compliance_config ? JSON.stringify(updates.compliance_config) : null);
  }

  params.push(id);

  execute(`UPDATE skills SET ${setClauses.join(', ')} WHERE id = ?`, params);

  // Update category links if provided
  if (updates.category_ids !== undefined) {
    execute('DELETE FROM category_skills WHERE skill_id = ?', [id]);
    for (const categoryId of updates.category_ids) {
      execute('INSERT INTO category_skills (category_id, skill_id) VALUES (?, ?)', [categoryId, id]);
    }
  }
}

/**
 * Delete a skill
 */
export function deleteSkill(id: number): { success: boolean; message: string } {
  const skill = queryOne<{ id: number }>('SELECT id FROM skills WHERE id = ?', [id]);

  if (!skill) {
    return { success: false, message: 'Skill not found' };
  }

  // Delete category associations first
  execute('DELETE FROM category_skills WHERE skill_id = ?', [id]);
  // Delete the skill
  execute('DELETE FROM skills WHERE id = ?', [id]);
  return { success: true, message: 'Skill deleted' };
}

/**
 * Toggle skill active status
 */
export function toggleSkillActive(id: number, updatedBy: string): boolean {
  const skill = queryOne<{ is_active: number }>('SELECT is_active FROM skills WHERE id = ?', [id]);
  if (!skill) return false;

  const newStatus = skill.is_active ? 0 : 1;
  execute(
    'UPDATE skills SET is_active = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [newStatus, updatedBy, id]
  );

  return newStatus === 1;
}

// ============ Restore Operations ============

/**
 * Reset all core skills to their config file defaults
 * Deletes existing core skills - caller should re-run seedCoreSkills() after
 */
export function resetCoreSkillsToDefaults(): number {
  // Delete all existing core skills
  const deleteResult = execute('DELETE FROM skills WHERE is_core = 1');
  return deleteResult.changes;
}

/**
 * Remove is_core flag from all skills
 * This allows all skills to be deletable by admins
 */
export function removeCoreFlag(): number {
  const result = execute('UPDATE skills SET is_core = 0 WHERE is_core = 1');
  return result.changes;
}

// ============ Seed Operations ============

/**
 * Seed a core skill (idempotent)
 */
export function seedCoreSkill(
  name: string,
  description: string,
  promptContent: string,
  triggerType: TriggerType,
  triggerValue: string | null,
  priority: number
): void {
  const existing = queryOne<{ id: number }>('SELECT id FROM skills WHERE name = ?', [name]);
  if (existing) return;

  const tokenEstimate = Math.ceil(promptContent.length / 4);

  execute(
    `INSERT INTO skills (
      name, description, prompt_content, trigger_type, trigger_value,
      category_restricted, is_index, priority, is_active, is_core,
      created_by_role, token_estimate, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, 1, 1, 'admin', ?, 'system', 'system')`,
    [name, description, promptContent, triggerType, triggerValue, priority, tokenEstimate]
  );
}

// ============ Tool Routing Operations ============

/**
 * Get all keyword-triggered skills that have tool routing configured
 * Used by the resolver to determine tool_choice based on matched skills
 */
export function getSkillsWithToolRouting(): Skill[] {
  const rows = queryAll<SkillRow>(
    `SELECT * FROM skills
     WHERE trigger_type = 'keyword'
       AND is_active = 1
       AND tool_name IS NOT NULL
     ORDER BY priority ASC`
  );

  return rows.map(mapSkillRow);
}

/**
 * Get skills that match a specific tool
 * Useful for finding all skills that trigger a particular tool
 */
export function getSkillsForTool(toolName: string): Skill[] {
  const rows = queryAll<SkillRow>(
    `SELECT * FROM skills
     WHERE tool_name = ?
       AND is_active = 1
     ORDER BY priority ASC`,
    [toolName]
  );

  return rows.map(mapSkillRow);
}

// ============ Migration Operations ============

interface ToolRoutingRuleForMigration {
  id: string;
  tool_name: string;
  rule_name: string;
  rule_type: string;
  patterns: string;
  force_mode: string;
  priority: number;
  category_ids: string | null;
  is_active: number;
  created_by: string;
}

/**
 * Migrate tool routing rules to skills
 * Creates skill entries for each tool routing rule with tool_name set
 * This is a one-time migration for the unified keyword actions feature
 *
 * @returns Number of rules migrated
 */
export function migrateToolRoutingToSkills(migratedBy: string = 'system'): {
  migrated: number;
  skipped: number;
  errors: string[];
} {
  const results = { migrated: 0, skipped: 0, errors: [] as string[] };

  // Get all tool routing rules
  const rules = queryAll<ToolRoutingRuleForMigration>(
    `SELECT * FROM tool_routing_rules ORDER BY priority ASC`
  );

  for (const rule of rules) {
    try {
      // Check if a skill with this name already exists
      const existingSkill = queryOne<{ id: number }>(
        `SELECT id FROM skills WHERE name = ?`,
        [`[Tool] ${rule.rule_name}`]
      );

      if (existingSkill) {
        results.skipped++;
        continue;
      }

      // Parse JSON fields
      const patterns: string[] = JSON.parse(rule.patterns);
      const categoryIds: number[] | null = rule.category_ids
        ? JSON.parse(rule.category_ids)
        : null;

      // Create the skill with tool routing fields
      const result = execute(
        `INSERT INTO skills (
          name, description, prompt_content, trigger_type, trigger_value,
          category_restricted, is_index, priority, is_active, is_core,
          created_by_role, token_estimate, created_by, updated_by,
          match_type, tool_name, force_mode, tool_config_override, data_source_filter
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 'admin', 0, ?, ?, ?, ?, ?, NULL, NULL)`,
        [
          `[Tool] ${rule.rule_name}`,
          `Migrated from tool routing rule: ${rule.rule_name}`,
          '', // Empty prompt content for tool-only actions
          'keyword',
          patterns.join(', '), // Convert array to comma-separated
          categoryIds !== null ? 1 : 0, // category_restricted if categories specified
          rule.priority,
          rule.is_active,
          migratedBy,
          migratedBy,
          rule.rule_type as 'keyword' | 'regex',
          rule.tool_name,
          rule.force_mode,
        ]
      );

      const skillId = result.lastInsertRowid as number;

      // Link categories if specified
      if (categoryIds && categoryIds.length > 0) {
        for (const categoryId of categoryIds) {
          execute(
            'INSERT OR IGNORE INTO category_skills (category_id, skill_id) VALUES (?, ?)',
            [categoryId, skillId]
          );
        }
      }

      results.migrated++;
    } catch (error) {
      results.errors.push(
        `Failed to migrate rule "${rule.rule_name}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  return results;
}

/**
 * Check if tool routing migration has been completed
 */
export function isToolRoutingMigrated(): boolean {
  // Check if any skills exist with [Tool] prefix (indicating migrated rules)
  const migrated = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM skills WHERE name LIKE '[Tool]%'`
  );
  return (migrated?.count || 0) > 0;
}

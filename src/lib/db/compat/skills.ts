/**
 * Skills Database Operations - Async Compatibility Layer
 *
 * Provides async wrappers for skills operations that work with both SQLite and PostgreSQL.
 * - SQLite: Delegates to existing sync functions
 * - PostgreSQL: Uses Kysely query builder
 */

import { getDb } from '../kysely';
import type {
  Skill,
  SkillWithCategories,
  CreateSkillInput,
  TriggerType,
  MatchType,
  ForceMode,
  DataSourceFilter,
  SkillComplianceConfig,
  ResolvedSkills,
} from '../../skills/types';

// Re-export all types from skills/types
export type {
  Skill,
  SkillWithCategories,
  CreateSkillInput,
  TriggerType,
  MatchType,
  ForceMode,
  DataSourceFilter,
  SkillComplianceConfig,
  ResolvedSkills,
};

// ============ Helper: Map Postgres row to Skill ============

interface PgSkillRow {
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
  created_at: string | Date;
  updated_at: string | Date;
  created_by: string;
  updated_by: string;
  match_type: MatchType | string | null;
  tool_name: string | null;
  force_mode: ForceMode | string | null;
  tool_config_override: string | null;
  data_source_filter: string | null;
  compliance_config: string | null;
}

function mapPgSkillRow(row: PgSkillRow): Skill {
  let toolConfigOverride: Record<string, unknown> | null = null;
  let dataSourceFilter: DataSourceFilter | null = null;
  let complianceConfig: SkillComplianceConfig | null = null;

  if (row.tool_config_override) {
    try { toolConfigOverride = JSON.parse(row.tool_config_override); } catch { /* ignore */ }
  }
  if (row.data_source_filter) {
    try { dataSourceFilter = JSON.parse(row.data_source_filter); } catch { /* ignore */ }
  }
  if (row.compliance_config) {
    try { complianceConfig = JSON.parse(row.compliance_config); } catch { /* ignore */ }
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
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    created_by: row.created_by,
    updated_by: row.updated_by,
    match_type: (row.match_type as MatchType) || 'keyword',
    tool_name: row.tool_name,
    force_mode: row.force_mode as ForceMode | null,
    tool_config_override: toolConfigOverride,
    data_source_filter: dataSourceFilter,
    compliance_config: complianceConfig,
  };
}

async function getPgCategoriesForSkill(skillId: number): Promise<{ id: number; name: string; slug: string }[]> {
  const db = await getDb();
  return db
    .selectFrom('categories as c')
    .innerJoin('category_skills as cs', 'c.id', 'cs.category_id')
    .select(['c.id', 'c.name', 'c.slug'])
    .where('cs.skill_id', '=', skillId)
    .execute() as Promise<{ id: number; name: string; slug: string }[]>;
}

// ============ Read Operations ============

export async function getSkillById(id: number): Promise<SkillWithCategories | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('skills')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  if (!row) return null;

  const categories = await getPgCategoriesForSkill(id);
  return { ...mapPgSkillRow(row as unknown as PgSkillRow), categories };
}

export async function getSkillsByIds(ids: number[]): Promise<Skill[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const rows = await db
    .selectFrom('skills')
    .selectAll()
    .where('id', 'in', ids)
    .where('is_active', '=', 1)
    .execute();
  return rows.map(r => mapPgSkillRow(r as unknown as PgSkillRow));
}

export async function getSkillCatalogForPlanner(categoryIds: number[]): Promise<{
  id: number;
  name: string;
  description: string | null;
  trigger_value: string | null;
  tool_name: string | null;
  force_mode: string | null;
}[]> {
  const keywordSkills = await getAllSkills({ trigger_type: 'keyword', is_active: true });

  // Batch load category mappings for all category-restricted skills (1 query instead of N)
  const restrictedSkillIds = keywordSkills
    .filter(s => s.category_restricted)
    .map(s => s.id);

  const skillCatMap = new Map<number, number[]>();
  if (restrictedSkillIds.length > 0 && categoryIds.length > 0) {
    const db = await getDb();
    const rows = await db
      .selectFrom('category_skills')
      .select(['skill_id', 'category_id'])
      .where('skill_id', 'in', restrictedSkillIds)
      .execute();

    for (const row of rows) {
      const existing = skillCatMap.get(row.skill_id as number) || [];
      existing.push(row.category_id as number);
      skillCatMap.set(row.skill_id as number, existing);
    }
  }

  const eligible = keywordSkills.filter(skill => {
    if (!skill.category_restricted) return true;
    if (categoryIds.length === 0) return false;
    const skillCats = skillCatMap.get(skill.id) || [];
    return skillCats.some(cid => categoryIds.includes(cid));
  });

  return eligible.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    trigger_value: s.trigger_value,
    tool_name: s.tool_name,
    force_mode: s.force_mode,
  }));
}

export async function getAllSkills(filters?: {
  trigger_type?: TriggerType;
  is_active?: boolean;
  category_id?: number;
}): Promise<Skill[]> {
  const db = await getDb();
  let baseQuery = db.selectFrom('skills').selectAll();

  if (filters?.trigger_type) {
    baseQuery = baseQuery.where('trigger_type', '=', filters.trigger_type);
  }
  if (filters?.is_active !== undefined) {
    baseQuery = baseQuery.where('is_active', '=', filters.is_active ? 1 : 0);
  }
  if (filters?.category_id) {
    baseQuery = baseQuery.where(
      'id',
      'in',
      db.selectFrom('category_skills').select('skill_id').where('category_id', '=', filters.category_id)
    );
  }

  const rows = await baseQuery.orderBy('priority', 'asc').orderBy('name', 'asc').execute();
  return rows.map(r => mapPgSkillRow(r as unknown as PgSkillRow));
}

export async function getSkillsByTrigger(trigger_type: TriggerType): Promise<Skill[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('skills')
    .selectAll()
    .where('trigger_type', '=', trigger_type)
    .where('is_active', '=', 1)
    .orderBy('priority', 'asc')
    .execute();

  return rows.map(r => mapPgSkillRow(r as unknown as PgSkillRow));
}

export async function getIndexSkillsForCategories(categoryIds: number[]): Promise<Skill[]> {
  if (categoryIds.length === 0) return [];

  const db = await getDb();
  const rows = await db
    .selectFrom('skills as s')
    .innerJoin('category_skills as cs', 's.id', 'cs.skill_id')
    .selectAll('s')
    .where('cs.category_id', 'in', categoryIds)
    .where('s.is_active', '=', 1)
    .where('s.trigger_type', '=', 'category')
    .where('s.is_index', '=', 1)
    .orderBy('s.priority', 'asc')
    .execute();

  // Deduplicate by id
  const seen = new Set<number>();
  const unique = rows.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  return unique.map(r => mapPgSkillRow(r as unknown as PgSkillRow));
}

export async function getKeywordSkills(): Promise<Skill[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('skills')
    .selectAll()
    .where('trigger_type', '=', 'keyword')
    .where('is_active', '=', 1)
    .orderBy('priority', 'asc')
    .execute();

  return rows.map(r => mapPgSkillRow(r as unknown as PgSkillRow));
}

export async function getCategoriesForSkill(skillId: number): Promise<{ id: number; name: string }[]> {
  const db = await getDb();
  return db
    .selectFrom('categories as c')
    .innerJoin('category_skills as cs', 'c.id', 'cs.category_id')
    .select(['c.id', 'c.name'])
    .where('cs.skill_id', '=', skillId)
    .execute() as Promise<{ id: number; name: string }[]>;
}

export async function wouldToolSkillMatch(toolName: string, message: string): Promise<boolean> {
  const skills = await getSkillsByTool(toolName);
  if (skills.length === 0) return false;

  const messageLower = message.toLowerCase();

  for (const skill of skills) {
    if (!skill.trigger_value) continue;
    const patterns = skill.trigger_value.split(',').map(p => p.trim());

    if (skill.match_type === 'regex') {
      const matched = patterns.some(pattern => {
        try { return new RegExp(pattern, 'i').test(message); } catch { return false; }
      });
      if (matched) return true;
    } else {
      const matched = patterns.some(keyword => {
        const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}(?:e?s)?\\b`, 'i').test(messageLower);
      });
      if (matched) return true;
    }
  }

  return false;
}

export async function getSkillsByTool(toolName: string): Promise<Skill[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('skills')
    .selectAll()
    .where('tool_name', '=', toolName)
    .where('is_active', '=', 1)
    .orderBy('priority', 'asc')
    .execute();

  return rows.map(r => mapPgSkillRow(r as unknown as PgSkillRow));
}

export async function getAllSkillsWithCategories(): Promise<SkillWithCategories[]> {
  const skills = await getAllSkills();
  return Promise.all(
    skills.map(async skill => {
      const categories = await getPgCategoriesForSkill(skill.id);
      return { ...skill, categories };
    })
  );
}

export async function getSkillsWithToolRouting(): Promise<Skill[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('skills')
    .selectAll()
    .where('tool_name', 'is not', null)
    .where('is_active', '=', 1)
    .orderBy('priority', 'asc')
    .execute();

  return rows.map(r => mapPgSkillRow(r as unknown as PgSkillRow));
}

export async function getSkillsForTool(toolName: string): Promise<Skill[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('skills')
    .selectAll()
    .where('tool_name', '=', toolName)
    .orderBy('priority', 'asc')
    .execute();

  return rows.map(r => mapPgSkillRow(r as unknown as PgSkillRow));
}

export async function isToolRoutingMigrated(): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .selectFrom('skills')
    .select(db.fn.count<number>('id').as('count'))
    .where('name', 'like', '[Tool]%')
    .executeTakeFirst();

  return (result?.count ?? 0) > 0;
}

// ============ Write Operations ============

export async function createSkill(
  input: CreateSkillInput,
  createdBy: string,
  role: 'admin' | 'superuser'
): Promise<number> {
  const db = await getDb();
  const tokenEstimate = Math.ceil(input.prompt_content.length / 4);

  const result = await db
    .insertInto('skills')
    .values({
      name: input.name,
      description: input.description || null,
      prompt_content: input.prompt_content,
      trigger_type: input.trigger_type,
      trigger_value: input.trigger_value || null,
      category_restricted: input.category_restricted ? 1 : 0,
      is_index: input.is_index ? 1 : 0,
      priority: input.priority || 100,
      is_active: 1,
      is_core: 0,
      created_by_role: role,
      token_estimate: tokenEstimate,
      created_by: createdBy,
      updated_by: createdBy,
      match_type: input.match_type || 'keyword',
      tool_name: input.tool_name || null,
      force_mode: input.force_mode || null,
      tool_config_override: input.tool_config_override ? JSON.stringify(input.tool_config_override) : null,
      data_source_filter: input.data_source_filter ? JSON.stringify(input.data_source_filter) : null,
      compliance_config: input.compliance_config ? JSON.stringify(input.compliance_config) : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const skillId = result.id;

  if (input.category_ids && input.category_ids.length > 0) {
    await db
      .insertInto('category_skills')
      .values(input.category_ids.map(cid => ({ category_id: cid, skill_id: skillId })))
      .execute();
  }

  return skillId;
}

export async function updateSkill(
  id: number,
  updates: Partial<CreateSkillInput> & { is_active?: boolean },
  updatedBy: string
): Promise<void> {
  const db = await getDb();
  const updateData: Record<string, unknown> = { updated_by: updatedBy, updated_at: new Date() };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.prompt_content !== undefined) {
    updateData.prompt_content = updates.prompt_content;
    updateData.token_estimate = Math.ceil(updates.prompt_content.length / 4);
  }
  if (updates.trigger_type !== undefined) updateData.trigger_type = updates.trigger_type;
  if (updates.trigger_value !== undefined) updateData.trigger_value = updates.trigger_value;
  if (updates.category_restricted !== undefined) updateData.category_restricted = updates.category_restricted ? 1 : 0;
  if (updates.is_index !== undefined) updateData.is_index = updates.is_index ? 1 : 0;
  if (updates.priority !== undefined) updateData.priority = updates.priority;
  if (updates.is_active !== undefined) updateData.is_active = updates.is_active ? 1 : 0;
  if (updates.match_type !== undefined) updateData.match_type = updates.match_type;
  if (updates.tool_name !== undefined) updateData.tool_name = updates.tool_name;
  if (updates.force_mode !== undefined) updateData.force_mode = updates.force_mode;
  if (updates.tool_config_override !== undefined) {
    updateData.tool_config_override = updates.tool_config_override ? JSON.stringify(updates.tool_config_override) : null;
  }
  if (updates.data_source_filter !== undefined) {
    updateData.data_source_filter = updates.data_source_filter ? JSON.stringify(updates.data_source_filter) : null;
  }
  if (updates.compliance_config !== undefined) {
    updateData.compliance_config = updates.compliance_config ? JSON.stringify(updates.compliance_config) : null;
  }

  await db.updateTable('skills').set(updateData).where('id', '=', id).execute();

  if (updates.category_ids !== undefined) {
    await db.deleteFrom('category_skills').where('skill_id', '=', id).execute();
    if (updates.category_ids.length > 0) {
      await db
        .insertInto('category_skills')
        .values(updates.category_ids.map(cid => ({ category_id: cid, skill_id: id })))
        .execute();
    }
  }
}

export async function deleteSkill(id: number): Promise<{ success: boolean; message: string }> {
  const db = await getDb();
  const result = await db.deleteFrom('skills').where('id', '=', id).executeTakeFirst();
  const deleted = Number(result.numDeletedRows ?? 0) > 0;
  return {
    success: deleted,
    message: deleted ? 'Skill deleted successfully' : 'Skill not found',
  };
}

export async function toggleSkillActive(id: number, updatedBy: string): Promise<boolean> {
  const db = await getDb();
  const skill = await db.selectFrom('skills').select(['id', 'is_active']).where('id', '=', id).executeTakeFirst();
  if (!skill) return false;

  const newActive = skill.is_active ? 0 : 1;
  await db
    .updateTable('skills')
    .set({ is_active: newActive, updated_by: updatedBy, updated_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute();

  return Boolean(newActive);
}

// ============ Restore Operations ============

export async function resetCoreSkillsToDefaults(): Promise<number> {
  const db = await getDb();
  const result = await db.deleteFrom('skills').where('is_core', '=', 1).executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}

export async function removeCoreFlag(): Promise<number> {
  const db = await getDb();
  const result = await db
    .updateTable('skills')
    .set({ is_core: 0 })
    .where('is_core', '=', 1)
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0);
}

// ============ Seed Operations ============

export async function seedCoreSkill(
  name: string,
  description: string,
  promptContent: string,
  triggerType: TriggerType,
  triggerValue: string | null,
  priority: number,
  options?: {
    toolName?: string;
    forceMode?: 'required' | 'preferred' | 'suggested';
    toolConfigOverride?: Record<string, unknown>;
  }
): Promise<void> {
  const db = await getDb();
  const tokenEstimate = Math.ceil(promptContent.length / 4);

  await db
    .insertInto('skills')
    .values({
      name,
      description,
      prompt_content: promptContent,
      trigger_type: triggerType,
      trigger_value: triggerValue,
      category_restricted: 0,
      is_index: 0,
      priority,
      is_active: 1,
      is_core: 1,
      created_by_role: 'admin',
      token_estimate: tokenEstimate,
      created_by: 'system',
      updated_by: 'system',
      match_type: 'keyword',
      tool_name: options?.toolName ?? null,
      force_mode: options?.forceMode ?? null,
      tool_config_override: options?.toolConfigOverride ? JSON.stringify(options.toolConfigOverride) : null,
    })
    .onConflict(oc =>
      oc.column('name').doUpdateSet({
        description,
        prompt_content: promptContent,
        trigger_type: triggerType,
        trigger_value: triggerValue,
        priority,
        is_core: 1,
        token_estimate: tokenEstimate,
        updated_by: 'system',
        updated_at: new Date().toISOString(),
        tool_name: options?.toolName ?? null,
        force_mode: options?.forceMode ?? null,
        tool_config_override: options?.toolConfigOverride ? JSON.stringify(options.toolConfigOverride) : null,
      })
    )
    .execute();
}

// ============ Migration Operations ============

/**
 * Migrate tool routing rules to skills (async Kysely implementation)
 */
export async function migrateToolRoutingToSkills(migratedBy: string = 'system'): Promise<{
  migrated: number;
  skipped: number;
  errors: string[];
}> {
  const results = { migrated: 0, skipped: 0, errors: [] as string[] };
  const db = await getDb();

  const rules = await db
    .selectFrom('tool_routing_rules')
    .selectAll()
    .orderBy('priority', 'asc')
    .execute();

  for (const rule of rules) {
    try {
      const existingSkill = await db
        .selectFrom('skills')
        .select('id')
        .where('name', '=', `[Tool] ${rule.rule_name}`)
        .executeTakeFirst();

      if (existingSkill) {
        results.skipped++;
        continue;
      }

      const patterns: string[] = JSON.parse(rule.patterns as string);
      const categoryIds: number[] | null = rule.category_ids
        ? JSON.parse(rule.category_ids as string)
        : null;

      const insertResult = await db
        .insertInto('skills')
        .values({
          name: `[Tool] ${rule.rule_name}`,
          description: `Migrated from tool routing rule: ${rule.rule_name}`,
          prompt_content: '',
          trigger_type: 'keyword',
          trigger_value: patterns.join(', '),
          category_restricted: categoryIds !== null ? 1 : 0,
          is_index: 0,
          priority: rule.priority,
          is_active: rule.is_active,
          is_core: 0,
          created_by_role: 'admin',
          token_estimate: 0,
          created_by: migratedBy,
          updated_by: migratedBy,
          match_type: (rule.rule_type as string) || 'keyword',
          tool_name: rule.tool_name,
          force_mode: rule.force_mode,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (categoryIds && categoryIds.length > 0) {
        for (const categoryId of categoryIds) {
          await db
            .insertInto('category_skills' as any)
            .values({ category_id: categoryId, skill_id: insertResult.id })
            .onConflict((oc) => oc.doNothing())
            .execute();
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

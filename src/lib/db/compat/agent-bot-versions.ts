/**
 * Agent Bot Version Database Operations - Async Compatibility Layer
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb, transaction } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'kysely';

// Re-export types from the types file
export type {
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

import type {
  AgentBotVersion,
  AgentBotVersionWithRelations,
  AgentBotVersionRow,
  AgentBotVersionTool,
  AgentBotVersionToolRow,
  CreateAgentBotVersionInput,
  UpdateAgentBotVersionInput,
} from '@/types/agent-bot';

// ============ Helper Functions ============

function rowToVersion(row: AgentBotVersionRow): AgentBotVersion {
  return {
    id: row.id,
    agent_bot_id: row.agent_bot_id,
    version_number: row.version_number,
    version_label: row.version_label,
    is_default: row.is_default === 1,
    input_schema: typeof row.input_schema === 'string'
      ? JSON.parse(row.input_schema)
      : row.input_schema,
    output_config: typeof row.output_config === 'string'
      ? JSON.parse(row.output_config)
      : row.output_config,
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

function rowToTool(row: AgentBotVersionToolRow): AgentBotVersionTool {
  return {
    id: row.id,
    version_id: row.version_id,
    tool_name: row.tool_name,
    is_enabled: row.is_enabled === 1,
    config_override: row.config_override
      ? (typeof row.config_override === 'string'
          ? JSON.parse(row.config_override)
          : row.config_override)
      : null,
  };
}

// ============ Version CRUD ============

export async function getVersionById(id: string): Promise<AgentBotVersion | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('agent_bot_versions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? rowToVersion(row as AgentBotVersionRow) : null;
}

export async function getVersionWithRelations(id: string): Promise<AgentBotVersionWithRelations | null> {
  const version = await getVersionById(id);
  if (!version) return null;

  const db = await getDb();

  // Get linked category IDs and names
  const categories = await db
    .selectFrom('agent_bot_version_categories as vc')
    .innerJoin('categories as c', 'vc.category_id', 'c.id')
    .select(['vc.category_id', 'c.name'])
    .where('vc.version_id', '=', id)
    .execute();

  // Get linked skill IDs and names
  const skills = await db
    .selectFrom('agent_bot_version_skills as vs')
    .innerJoin('skills as s', 'vs.skill_id', 's.id')
    .select(['vs.skill_id', 's.name'])
    .where('vs.version_id', '=', id)
    .execute();

  // Get tool configurations
  const toolRows = await db
    .selectFrom('agent_bot_version_tools')
    .selectAll()
    .where('version_id', '=', id)
    .execute();

  return {
    ...version,
    category_ids: categories.map((c) => c.category_id),
    category_names: categories.map((c) => c.name),
    skill_ids: skills.map((s) => s.skill_id),
    skill_names: skills.map((s) => s.name),
    tools: toolRows.map((r) => rowToTool(r as AgentBotVersionToolRow)),
  };
}

export async function listVersions(agentBotId: string): Promise<AgentBotVersionWithRelations[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent_bot_versions')
    .selectAll()
    .where('agent_bot_id', '=', agentBotId)
    .orderBy('version_number', 'desc')
    .execute();

  const result: AgentBotVersionWithRelations[] = [];
  for (const row of rows) {
    const version = rowToVersion(row as AgentBotVersionRow);

    const categories = await db
      .selectFrom('agent_bot_version_categories as vc')
      .innerJoin('categories as c', 'vc.category_id', 'c.id')
      .select(['vc.category_id', 'c.name'])
      .where('vc.version_id', '=', version.id)
      .execute();

    const skills = await db
      .selectFrom('agent_bot_version_skills as vs')
      .innerJoin('skills as s', 'vs.skill_id', 's.id')
      .select(['vs.skill_id', 's.name'])
      .where('vs.version_id', '=', version.id)
      .execute();

    const toolRows = await db
      .selectFrom('agent_bot_version_tools')
      .selectAll()
      .where('version_id', '=', version.id)
      .execute();

    result.push({
      ...version,
      category_ids: categories.map((c) => c.category_id),
      category_names: categories.map((c) => c.name),
      skill_ids: skills.map((s) => s.skill_id),
      skill_names: skills.map((s) => s.name),
      tools: toolRows.map((r) => rowToTool(r as AgentBotVersionToolRow)),
    });
  }

  return result;
}

export async function getDefaultVersion(agentBotId: string): Promise<AgentBotVersionWithRelations | null> {
  const db = await getDb();
  let row = await db
    .selectFrom('agent_bot_versions')
    .selectAll()
    .where('agent_bot_id', '=', agentBotId)
    .where('is_default', '=', 1)
    .where('is_active', '=', 1)
    .executeTakeFirst();

  if (!row) {
    // Fall back to highest version number if no default is set
    row = await db
      .selectFrom('agent_bot_versions')
      .selectAll()
      .where('agent_bot_id', '=', agentBotId)
      .where('is_active', '=', 1)
      .orderBy('version_number', 'desc')
      .executeTakeFirst();
  }

  if (!row) return null;
  return getVersionWithRelations(row.id);
}

export async function getVersionByNumber(
  agentBotId: string,
  versionNumber: number
): Promise<AgentBotVersionWithRelations | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('agent_bot_versions')
    .selectAll()
    .where('agent_bot_id', '=', agentBotId)
    .where('version_number', '=', versionNumber)
    .executeTakeFirst();

  if (!row) return null;
  return getVersionWithRelations(row.id);
}

async function getNextVersionNumber(agentBotId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('agent_bot_versions')
    .select(db.fn.max('version_number').as('max_version'))
    .where('agent_bot_id', '=', agentBotId)
    .executeTakeFirst();

  return ((result?.max_version as number) || 0) + 1;
}

export async function createVersion(
  agentBotId: string,
  input: CreateAgentBotVersionInput,
  createdBy: string
): Promise<AgentBotVersionWithRelations> {
  const db = await getDb();
  const id = uuidv4();
  const versionNumber = await getNextVersionNumber(agentBotId);

  // If this is the first version or is_default is true, clear other defaults
  if (input.is_default !== false) {
    const existingCount = await db
      .selectFrom('agent_bot_versions')
      .select(db.fn.count<number>('id').as('count'))
      .where('agent_bot_id', '=', agentBotId)
      .executeTakeFirst();

    if ((existingCount?.count ?? 0) === 0 || input.is_default) {
      await db
        .updateTable('agent_bot_versions')
        .set({ is_default: 0 })
        .where('agent_bot_id', '=', agentBotId)
        .execute();
    }
  }

  // Insert version
  await db
    .insertInto('agent_bot_versions')
    .values({
      id,
      agent_bot_id: agentBotId,
      version_number: versionNumber,
      version_label: input.version_label || null,
      is_default: input.is_default !== false ? 1 : 0,
      input_schema: JSON.stringify(input.input_schema),
      output_config: JSON.stringify(input.output_config),
      system_prompt: input.system_prompt || null,
      llm_model: input.llm_model || null,
      temperature: input.temperature ?? null,
      max_tokens: input.max_tokens ?? null,
      is_active: 1,
      created_by: createdBy,
    })
    .execute();

  // Link categories
  if (input.category_ids && input.category_ids.length > 0) {
    await linkCategories(id, input.category_ids);
  }

  // Link skills
  if (input.skill_ids && input.skill_ids.length > 0) {
    await linkSkills(id, input.skill_ids);
  }

  // Add tool configurations
  if (input.tools && input.tools.length > 0) {
    for (const tool of input.tools) {
      await addTool(id, tool.tool_name, tool.is_enabled, tool.config_override);
    }
  }

  return (await getVersionWithRelations(id))!;
}

export async function updateVersion(
  id: string,
  updates: UpdateAgentBotVersionInput
): Promise<AgentBotVersionWithRelations | null> {
  const existing = await getVersionById(id);
  if (!existing) return null;

  const db = await getDb();
  const updateData: Record<string, unknown> = {
    updated_at: sql`NOW()`,
  };

  if (updates.version_label !== undefined) {
    updateData.version_label = updates.version_label;
  }

  if (updates.is_default !== undefined) {
    if (updates.is_default) {
      // Clear other defaults first
      await db
        .updateTable('agent_bot_versions')
        .set({ is_default: 0 })
        .where('agent_bot_id', '=', existing.agent_bot_id)
        .execute();
    }
    updateData.is_default = updates.is_default ? 1 : 0;
  }

  if (updates.is_active !== undefined) {
    updateData.is_active = updates.is_active ? 1 : 0;
  }

  if (updates.input_schema !== undefined) {
    updateData.input_schema = JSON.stringify(updates.input_schema);
  }

  if (updates.output_config !== undefined) {
    updateData.output_config = JSON.stringify(updates.output_config);
  }

  if (updates.system_prompt !== undefined) {
    updateData.system_prompt = updates.system_prompt;
  }

  if (updates.llm_model !== undefined) {
    updateData.llm_model = updates.llm_model;
  }

  if (updates.temperature !== undefined) {
    updateData.temperature = updates.temperature;
  }

  if (updates.max_tokens !== undefined) {
    updateData.max_tokens = updates.max_tokens;
  }

  await db
    .updateTable('agent_bot_versions')
    .set(updateData)
    .where('id', '=', id)
    .execute();

  // Update category links if provided
  if (updates.category_ids !== undefined) {
    await db.deleteFrom('agent_bot_version_categories').where('version_id', '=', id).execute();
    if (updates.category_ids.length > 0) {
      await linkCategories(id, updates.category_ids);
    }
  }

  // Update skill links if provided
  if (updates.skill_ids !== undefined) {
    await db.deleteFrom('agent_bot_version_skills').where('version_id', '=', id).execute();
    if (updates.skill_ids.length > 0) {
      await linkSkills(id, updates.skill_ids);
    }
  }

  // Update tools if provided
  if (updates.tools !== undefined) {
    await db.deleteFrom('agent_bot_version_tools').where('version_id', '=', id).execute();
    for (const tool of updates.tools) {
      await addTool(id, tool.tool_name, tool.is_enabled, tool.config_override);
    }
  }

  return getVersionWithRelations(id);
}

export async function deleteVersion(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('agent_bot_versions')
    .where('id', '=', id)
    .executeTakeFirst();

  return (result.numDeletedRows ?? BigInt(0)) > BigInt(0);
}

export async function setDefaultVersion(id: string): Promise<AgentBotVersionWithRelations | null> {
  const version = await getVersionById(id);
  if (!version) return null;

  const db = await getDb();

  // Clear other defaults
  await db
    .updateTable('agent_bot_versions')
    .set({ is_default: 0 })
    .where('agent_bot_id', '=', version.agent_bot_id)
    .execute();

  // Set this version as default
  await db
    .updateTable('agent_bot_versions')
    .set({ is_default: 1, updated_at: sql`NOW()` })
    .where('id', '=', id)
    .execute();

  return getVersionWithRelations(id);
}

// ============ Category Linking ============

async function linkCategories(versionId: string, categoryIds: number[]): Promise<void> {
  const db = await getDb();
  for (const categoryId of categoryIds) {
    await db
      .insertInto('agent_bot_version_categories')
      .values({ version_id: versionId, category_id: categoryId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
}

export async function getVersionCategoryIds(versionId: string): Promise<number[]> {
  const db = await getDb();
  const results = await db
    .selectFrom('agent_bot_version_categories')
    .select('category_id')
    .where('version_id', '=', versionId)
    .execute();

  return results.map((r) => r.category_id);
}

// ============ Skill Linking ============

async function linkSkills(versionId: string, skillIds: number[]): Promise<void> {
  const db = await getDb();
  for (const skillId of skillIds) {
    await db
      .insertInto('agent_bot_version_skills')
      .values({ version_id: versionId, skill_id: skillId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
}

export async function getVersionSkillIds(versionId: string): Promise<number[]> {
  const db = await getDb();
  const results = await db
    .selectFrom('agent_bot_version_skills')
    .select('skill_id')
    .where('version_id', '=', versionId)
    .execute();

  return results.map((r) => r.skill_id);
}

// ============ Tool Configuration ============

async function addTool(
  versionId: string,
  toolName: string,
  isEnabled: boolean,
  configOverride?: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  await db
    .insertInto('agent_bot_version_tools')
    .values({
      id: uuidv4(),
      version_id: versionId,
      tool_name: toolName,
      is_enabled: isEnabled ? 1 : 0,
      config_override: configOverride ? JSON.stringify(configOverride) : null,
    })
    .execute();
}

export async function getVersionTools(versionId: string): Promise<AgentBotVersionTool[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent_bot_version_tools')
    .selectAll()
    .where('version_id', '=', versionId)
    .execute();

  return rows.map((r) => rowToTool(r as AgentBotVersionToolRow));
}

export async function getEnabledVersionTools(versionId: string): Promise<AgentBotVersionTool[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent_bot_version_tools')
    .selectAll()
    .where('version_id', '=', versionId)
    .where('is_enabled', '=', 1)
    .execute();

  return rows.map((r) => rowToTool(r as AgentBotVersionToolRow));
}

// ============ Utility Functions ============

export async function duplicateVersion(
  sourceVersionId: string,
  createdBy: string,
  updates?: Partial<CreateAgentBotVersionInput>
): Promise<AgentBotVersionWithRelations | null> {
  const source = await getVersionWithRelations(sourceVersionId);
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

export async function getVersionCount(agentBotId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('agent_bot_versions')
    .select(db.fn.count<number>('id').as('count'))
    .where('agent_bot_id', '=', agentBotId)
    .executeTakeFirst();

  return result?.count ?? 0;
}

export async function getActiveVersionCount(agentBotId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('agent_bot_versions')
    .select(db.fn.count<number>('id').as('count'))
    .where('agent_bot_id', '=', agentBotId)
    .where('is_active', '=', 1)
    .executeTakeFirst();

  return result?.count ?? 0;
}

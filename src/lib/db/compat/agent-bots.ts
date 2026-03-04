/**
 * Agent Bot Database Operations - Async Compatibility Layer
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb, transaction } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'kysely';

// Re-export types from the types file
export type {
  AgentBot,
  AgentBotWithRelations,
  AgentBotRow,
  AgentBotVersionSummary,
  CreatorRole,
  CreateAgentBotInput,
  UpdateAgentBotInput,
} from '@/types/agent-bot';

import type {
  AgentBot,
  AgentBotWithRelations,
  AgentBotRow,
  CreatorRole,
  CreateAgentBotInput,
  UpdateAgentBotInput,
} from '@/types/agent-bot';

// Re-export helper (doesn't need DB access)
export { generateSlugFromName } from '../utils';
import { generateSlugFromName } from '../utils';

// ============ Helper Functions ============

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

// ============ Agent Bot CRUD ============

export async function getAgentBotById(id: string): Promise<AgentBot | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('agent_bots')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? rowToAgentBot(row as AgentBotRow) : null;
}

export async function getAgentBotBySlug(slug: string): Promise<AgentBot | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('agent_bots')
    .selectAll()
    .where('slug', '=', slug)
    .executeTakeFirst();

  return row ? rowToAgentBot(row as AgentBotRow) : null;
}

export async function getAgentBotWithRelations(id: string): Promise<AgentBotWithRelations | null> {
  const db = await getDb();
  const bot = await getAgentBotById(id);
  if (!bot) return null;

  // Get versions
  const versions = await db
    .selectFrom('agent_bot_versions')
    .select(['id', 'version_number', 'version_label', 'is_default', 'is_active', 'created_at'])
    .where('agent_bot_id', '=', id)
    .orderBy('version_number', 'desc')
    .execute();

  // Get API key count
  const keyCount = await db
    .selectFrom('agent_bot_api_keys')
    .select(db.fn.count<number>('id').as('count'))
    .where('agent_bot_id', '=', id)
    .where('is_active', '=', 1)
    .executeTakeFirst();

  // Get total jobs count
  const jobCount = await db
    .selectFrom('agent_bot_jobs')
    .select(db.fn.count<number>('id').as('count'))
    .where('agent_bot_id', '=', id)
    .executeTakeFirst();

  const defaultVersion = versions.find(v => v.is_default === 1);

  return {
    ...bot,
    versions: versions.map(v => ({
      id: v.id,
      version_number: v.version_number,
      version_label: v.version_label,
      is_default: v.is_default === 1,
      is_active: v.is_active === 1,
      created_at: v.created_at as string,
    })),
    default_version_id: defaultVersion?.id ?? null,
    api_key_count: keyCount?.count ?? 0,
    total_jobs: jobCount?.count ?? 0,
  };
}

export async function listAgentBots(): Promise<AgentBotWithRelations[]> {
  const db = await getDb();
  const bots = await db
    .selectFrom('agent_bots')
    .selectAll()
    .orderBy('created_at', 'desc')
    .execute();

  const result: AgentBotWithRelations[] = [];
  for (const bot of bots) {
    const versions = await db
      .selectFrom('agent_bot_versions')
      .select(['id', 'version_number', 'version_label', 'is_default', 'is_active', 'created_at'])
      .where('agent_bot_id', '=', bot.id)
      .orderBy('version_number', 'desc')
      .execute();

    // Get API key count
    const keyCount = await db
      .selectFrom('agent_bot_api_keys')
      .select(db.fn.count<number>('id').as('count'))
      .where('agent_bot_id', '=', bot.id)
      .where('is_active', '=', 1)
      .executeTakeFirst();

    // Get total jobs count
    const jobCount = await db
      .selectFrom('agent_bot_jobs')
      .select(db.fn.count<number>('id').as('count'))
      .where('agent_bot_id', '=', bot.id)
      .executeTakeFirst();

    const defaultVersion = versions.find(v => v.is_default === 1);

    result.push({
      ...rowToAgentBot(bot as AgentBotRow),
      versions: versions.map(v => ({
        id: v.id,
        version_number: v.version_number,
        version_label: v.version_label,
        is_default: v.is_default === 1,
        is_active: v.is_active === 1,
        created_at: v.created_at as string,
      })),
      default_version_id: defaultVersion?.id ?? null,
      api_key_count: keyCount?.count ?? 0,
      total_jobs: jobCount?.count ?? 0,
    });
  }

  return result;
}

export async function listAgentBotsByCreator(createdBy: string): Promise<AgentBotWithRelations[]> {
  const db = await getDb();
  const bots = await db
    .selectFrom('agent_bots')
    .selectAll()
    .where('created_by', '=', createdBy)
    .orderBy('created_at', 'desc')
    .execute();

  const result: AgentBotWithRelations[] = [];
  for (const bot of bots) {
    const versions = await db
      .selectFrom('agent_bot_versions')
      .select(['id', 'version_number', 'version_label', 'is_default', 'is_active', 'created_at'])
      .where('agent_bot_id', '=', bot.id)
      .orderBy('version_number', 'desc')
      .execute();

    // Get API key count
    const keyCount = await db
      .selectFrom('agent_bot_api_keys')
      .select(db.fn.count<number>('id').as('count'))
      .where('agent_bot_id', '=', bot.id)
      .where('is_active', '=', 1)
      .executeTakeFirst();

    // Get total jobs count
    const jobCount = await db
      .selectFrom('agent_bot_jobs')
      .select(db.fn.count<number>('id').as('count'))
      .where('agent_bot_id', '=', bot.id)
      .executeTakeFirst();

    const defaultVersion = versions.find(v => v.is_default === 1);

    result.push({
      ...rowToAgentBot(bot as AgentBotRow),
      versions: versions.map(v => ({
        id: v.id,
        version_number: v.version_number,
        version_label: v.version_label,
        is_default: v.is_default === 1,
        is_active: v.is_active === 1,
        created_at: v.created_at as string,
      })),
      default_version_id: defaultVersion?.id ?? null,
      api_key_count: keyCount?.count ?? 0,
      total_jobs: jobCount?.count ?? 0,
    });
  }

  return result;
}

export async function createAgentBot(
  input: CreateAgentBotInput,
  createdBy: string,
  createdByRole: CreatorRole
): Promise<AgentBot> {
  const db = await getDb();
  const id = uuidv4();
  const slug = await ensureUniqueSlug(generateSlugFromName(input.name));

  await db
    .insertInto('agent_bots')
    .values({
      id,
      name: input.name,
      slug,
      description: input.description ?? null,
      is_active: 1,
      created_by: createdBy,
      created_by_role: createdByRole,
    })
    .execute();

  const bot = await getAgentBotById(id);
  return bot!;
}

async function ensureUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
  const db = await getDb();
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    let query = db
      .selectFrom('agent_bots')
      .select('id')
      .where('slug', '=', slug);

    if (excludeId) {
      query = query.where('id', '!=', excludeId);
    }

    const existing = await query.executeTakeFirst();
    if (!existing) break;

    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

export async function updateAgentBot(id: string, updates: UpdateAgentBotInput): Promise<AgentBot | null> {
  const bot = await getAgentBotById(id);
  if (!bot) return null;

  const db = await getDb();
  const updateData: Record<string, unknown> = {
    updated_at: sql`NOW()`,
  };

  if (updates.name !== undefined) {
    updateData.name = updates.name;
    updateData.slug = await ensureUniqueSlug(generateSlugFromName(updates.name), id);
  }
  if (updates.description !== undefined) {
    updateData.description = updates.description;
  }
  if (updates.is_active !== undefined) {
    updateData.is_active = updates.is_active ? 1 : 0;
  }

  await db
    .updateTable('agent_bots')
    .set(updateData)
    .where('id', '=', id)
    .execute();

  return getAgentBotById(id);
}

export async function deleteAgentBot(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('agent_bots')
    .where('id', '=', id)
    .executeTakeFirst();

  return (result.numDeletedRows ?? BigInt(0)) > BigInt(0);
}

export async function toggleAgentBotActive(id: string, isActive: boolean): Promise<AgentBot | null> {
  const db = await getDb();
  await db
    .updateTable('agent_bots')
    .set({
      is_active: isActive ? 1 : 0,
      updated_at: sql`NOW()`,
    })
    .where('id', '=', id)
    .execute();

  return getAgentBotById(id);
}

export async function nameExists(name: string, excludeId?: string): Promise<boolean> {
  const db = await getDb();
  let query = db
    .selectFrom('agent_bots')
    .select(db.fn.count<number>('id').as('count'))
    .where('name', '=', name);

  if (excludeId) {
    query = query.where('id', '!=', excludeId);
  }

  const result = await query.executeTakeFirst();
  return (result?.count ?? 0) > 0;
}

export async function slugExists(slug: string, excludeId?: string): Promise<boolean> {
  const db = await getDb();
  let query = db
    .selectFrom('agent_bots')
    .select(db.fn.count<number>('id').as('count'))
    .where('slug', '=', slug);

  if (excludeId) {
    query = query.where('id', '!=', excludeId);
  }

  const result = await query.executeTakeFirst();
  return (result?.count ?? 0) > 0;
}

export async function getAgentBotCount(): Promise<{ total: number; active: number }> {
  const db = await getDb();
  const totalResult = await db
    .selectFrom('agent_bots')
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirst();

  const activeResult = await db
    .selectFrom('agent_bots')
    .select(db.fn.count<number>('id').as('count'))
    .where('is_active', '=', 1)
    .executeTakeFirst();

  return {
    total: totalResult?.count ?? 0,
    active: activeResult?.count ?? 0,
  };
}

export async function getActiveAgentBotBySlug(slug: string): Promise<AgentBot | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('agent_bots')
    .selectAll()
    .where('slug', '=', slug)
    .where('is_active', '=', 1)
    .executeTakeFirst();

  return row ? rowToAgentBot(row as AgentBotRow) : null;
}

export async function getAgentBotCategoryIds(agentBotId: string): Promise<number[]> {
  const db = await getDb();
  const results = await db
    .selectFrom('agent_bot_version_categories as vc')
    .innerJoin('agent_bot_versions as v', 'vc.version_id', 'v.id')
    .select('vc.category_id')
    .where('v.agent_bot_id', '=', agentBotId)
    .where('v.is_default', '=', 1)
    .execute();

  return results.map(r => r.category_id);
}

export async function checkSuperuserAgentBotAccess(
  agentBotId: string,
  superuserCategoryIds: number[]
): Promise<boolean> {
  if (superuserCategoryIds.length === 0) return false;

  const botCategoryIds = await getAgentBotCategoryIds(agentBotId);
  return botCategoryIds.some(id => superuserCategoryIds.includes(id));
}

export async function searchAgentBots(query: string): Promise<AgentBotWithRelations[]> {
  const db = await getDb();
  const searchTerm = `%${query}%`;

  const bots = await db
    .selectFrom('agent_bots')
    .selectAll()
    .where((eb) =>
      eb.or([
        eb('name', 'ilike', searchTerm),
        eb('description', 'ilike', searchTerm),
        eb('slug', 'ilike', searchTerm),
      ])
    )
    .orderBy('created_at', 'desc')
    .execute();

  const result: AgentBotWithRelations[] = [];
  for (const bot of bots) {
    const versions = await db
      .selectFrom('agent_bot_versions')
      .select(['id', 'version_number', 'version_label', 'is_default', 'is_active', 'created_at'])
      .where('agent_bot_id', '=', bot.id)
      .orderBy('version_number', 'desc')
      .execute();

    // Get API key count
    const keyCount = await db
      .selectFrom('agent_bot_api_keys')
      .select(db.fn.count<number>('id').as('count'))
      .where('agent_bot_id', '=', bot.id)
      .where('is_active', '=', 1)
      .executeTakeFirst();

    // Get total jobs count
    const jobCount = await db
      .selectFrom('agent_bot_jobs')
      .select(db.fn.count<number>('id').as('count'))
      .where('agent_bot_id', '=', bot.id)
      .executeTakeFirst();

    const defaultVersion = versions.find(v => v.is_default === 1);

    result.push({
      ...rowToAgentBot(bot as AgentBotRow),
      versions: versions.map(v => ({
        id: v.id,
        version_number: v.version_number,
        version_label: v.version_label,
        is_default: v.is_default === 1,
        is_active: v.is_active === 1,
        created_at: v.created_at as string,
      })),
      default_version_id: defaultVersion?.id ?? null,
      api_key_count: keyCount?.count ?? 0,
      total_jobs: jobCount?.count ?? 0,
    });
  }

  return result;
}

/**
 * Workspace Database Operations
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb, transaction } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import type {
  Workspace,
  WorkspaceWithRelations,
  WorkspaceType,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  CreatorRole,
} from '@/types/workspace';

// Re-export types
export type {
  Workspace,
  WorkspaceWithRelations,
  WorkspaceType,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  CreatorRole,
};

// Re-export the helper function
export { generateWorkspaceSlug as generateSlug } from '../utils';

// Import for local use (pure utility only — no DB calls)
import { generateWorkspaceSlug as generateSlug } from '../utils';

// ============ Read Operations ============

/**
 * Get workspace by slug (used for public access)
 */
export async function getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('workspaces')
    .selectAll()
    .where('slug', '=', slug)
    .executeTakeFirst();

  return row ? rowToWorkspace(row) : null;
}

/**
 * Get workspace by ID
 */
export async function getWorkspaceById(id: string): Promise<Workspace | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('workspaces')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? rowToWorkspace(row) : null;
}

/**
 * Get workspace with related data (categories, counts)
 */
export async function getWorkspaceWithRelations(id: string): Promise<WorkspaceWithRelations | null> {
  const workspace = await getWorkspaceById(id);
  if (!workspace) return null;

  const categoryIds = await getWorkspaceCategoryIds(id);

  const db = await getDb();
  const categoryNames = await db
    .selectFrom('categories')
    .innerJoin('workspace_categories', 'categories.id', 'workspace_categories.category_id')
    .select('categories.name')
    .where('workspace_categories.workspace_id', '=', id)
    .execute();

  // Get counts
  const userCount = await db
    .selectFrom('workspace_users')
    .select(db.fn.count('id').as('count'))
    .where('workspace_id', '=', id)
    .executeTakeFirst();

  const sessionCount = await db
    .selectFrom('workspace_sessions')
    .select(db.fn.count('id').as('count'))
    .where('workspace_id', '=', id)
    .executeTakeFirst();

  const messageCount = await db
    .selectFrom('workspace_messages')
    .select(db.fn.count('id').as('count'))
    .where('workspace_id', '=', id)
    .executeTakeFirst();

  return {
    ...workspace,
    category_ids: categoryIds,
    category_names: categoryNames.map(r => r.name as string),
    user_count: Number(userCount?.count || 0),
    session_count: Number(sessionCount?.count || 0),
    message_count: Number(messageCount?.count || 0),
  };
}

/**
 * List all workspaces (optionally filtered by type)
 */
export async function listWorkspaces(type?: WorkspaceType): Promise<WorkspaceWithRelations[]> {
  const db = await getDb();
  let query = db
    .selectFrom('workspaces')
    .selectAll()
    .orderBy('created_at', 'desc');

  if (type) {
    query = query.where('type', '=', type);
  }

  const rows = await query.execute();
  const workspaces = rows.map(row => rowToWorkspace(row));
  const categoryMap = await getWorkspaceCategoryIdsForMany(workspaces.map(w => w.id));

  return workspaces.map(w => ({
    ...w,
    category_ids: categoryMap.get(w.id) || [],
  }));
}

/**
 * List workspaces created by a specific user (for superuser scope)
 */
export async function listWorkspacesByCreator(createdBy: string): Promise<WorkspaceWithRelations[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('workspaces')
    .selectAll()
    .where('created_by', '=', createdBy)
    .orderBy('created_at', 'desc')
    .execute();

  const workspaces = rows.map(row => rowToWorkspace(row));
  const categoryMap = await getWorkspaceCategoryIdsForMany(workspaces.map(w => w.id));

  return workspaces.map(w => ({
    ...w,
    category_ids: categoryMap.get(w.id) || [],
  }));
}

/**
 * List workspaces accessible to a user (based on category access)
 *
 * Returns enabled workspaces where:
 * - access_mode = 'explicit' AND user is in workspace_users, OR
 * - access_mode = 'category' AND user has ALL workspace categories
 */
export async function listWorkspacesForUser(userId: number): Promise<WorkspaceWithRelations[]> {
  const db = await getDb();

  // Get user's active subscribed category IDs
  const userCats = await db
    .selectFrom('user_subscriptions')
    .select('category_id')
    .where('user_id', '=', userId)
    .where('is_active', '=', 1)
    .execute();

  const userCategoryIds = userCats.map(r => r.category_id as number);
  if (userCategoryIds.length === 0) return [];

  // Query workspaces the user can access
  const rows = await db
    .selectFrom('workspaces as w')
    .selectAll('w')
    .where('w.is_enabled', '=', 1)
    .where(eb => eb.or([
      // Explicit access mode: user is in workspace_users
      eb.and([
        eb('w.access_mode', '=', 'explicit'),
        eb.exists(
          eb.selectFrom('workspace_users as wu')
            .select(eb.lit(1).as('one'))
            .whereRef('wu.workspace_id', '=', 'w.id')
            .where('wu.user_id', '=', userId)
        ),
      ]),
      // Category-based: user has ALL workspace categories
      eb.and([
        eb('w.access_mode', '=', 'category'),
        eb.not(
          eb.exists(
            eb.selectFrom('workspace_categories as wc')
              .select(eb.lit(1).as('one'))
              .whereRef('wc.workspace_id', '=', 'w.id')
              .where('wc.category_id', 'not in', userCategoryIds)
          )
        ),
      ]),
    ]))
    .orderBy('w.created_at', 'desc')
    .execute();

  const workspaces = rows.map(row => rowToWorkspace(row));
  const categoryMap = await getWorkspaceCategoryIdsForMany(workspaces.map(w => w.id));

  return workspaces.map(w => ({
    ...w,
    category_ids: categoryMap.get(w.id) || [],
  }));
}

// ============ Write Operations ============

/**
 * Create a new workspace
 */
export async function createWorkspace(
  input: CreateWorkspaceInput,
  createdBy: string,
  role: CreatorRole
): Promise<Workspace> {
  const id = uuidv4();
  let slug = generateSlug();

  // Ensure slug is unique
  while (await getWorkspaceBySlug(slug)) {
    slug = generateSlug();
  }

  return transaction(async (trx) => {
    await trx
      .insertInto('workspaces')
      .values({
        id,
        slug,
        name: input.name,
        type: input.type,
        is_enabled: 1,
        access_mode: input.access_mode || 'category',
        primary_color: input.primary_color || '#2563eb',
        logo_url: input.logo_url || null,
        chat_title: input.chat_title || null,
        greeting_message: input.greeting_message || 'How can I help you today?',
        suggested_prompts: input.suggested_prompts ? JSON.stringify(input.suggested_prompts) : null,
        footer_text: input.footer_text || null,
        llm_provider: input.llm_provider || null,
        llm_model: input.llm_model || null,
        temperature: input.temperature ?? null,
        system_prompt: input.system_prompt || null,
        allowed_domains: JSON.stringify(input.allowed_domains || []),
        daily_limit: input.daily_limit ?? 1000,
        session_limit: input.session_limit ?? 50,
        voice_enabled: input.voice_enabled ? 1 : 0,
        file_upload_enabled: input.file_upload_enabled ? 1 : 0,
        max_file_size_mb: input.max_file_size_mb ?? 5,
        web_search_enabled: input.web_search_enabled !== false ? 1 : 0,
        auth_required: input.auth_required ? 1 : 0,
        created_by: createdBy,
        created_by_role: role,
      })
      .execute();

    // Link categories
    if (input.category_ids && input.category_ids.length > 0) {
      await trx
        .insertInto('workspace_categories')
        .values(input.category_ids.map(cid => ({ workspace_id: id, category_id: cid })))
        .onConflict(oc => oc.doNothing())
        .execute();
    }

    const row = await trx
      .selectFrom('workspaces')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

    return rowToWorkspace(row);
  });
}

/**
 * Update a workspace
 */
export async function updateWorkspace(id: string, updates: UpdateWorkspaceInput): Promise<Workspace | null> {
  const existing = await getWorkspaceById(id);
  if (!existing) return null;

  return transaction(async (trx) => {
    const updateData: Record<string, unknown> = {};

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.is_enabled !== undefined) updateData.is_enabled = updates.is_enabled ? 1 : 0;
    if (updates.access_mode !== undefined) updateData.access_mode = updates.access_mode;
    if (updates.primary_color !== undefined) updateData.primary_color = updates.primary_color;
    if (updates.logo_url !== undefined) updateData.logo_url = updates.logo_url;
    if (updates.chat_title !== undefined) updateData.chat_title = updates.chat_title;
    if (updates.greeting_message !== undefined) updateData.greeting_message = updates.greeting_message;
    if (updates.suggested_prompts !== undefined) {
      updateData.suggested_prompts = updates.suggested_prompts ? JSON.stringify(updates.suggested_prompts) : null;
    }
    if (updates.footer_text !== undefined) updateData.footer_text = updates.footer_text;
    if (updates.llm_provider !== undefined) updateData.llm_provider = updates.llm_provider;
    if (updates.llm_model !== undefined) updateData.llm_model = updates.llm_model;
    if (updates.temperature !== undefined) updateData.temperature = updates.temperature;
    if (updates.system_prompt !== undefined) updateData.system_prompt = updates.system_prompt;
    if (updates.allowed_domains !== undefined) {
      updateData.allowed_domains = JSON.stringify(updates.allowed_domains);
    }
    if (updates.daily_limit !== undefined) updateData.daily_limit = updates.daily_limit;
    if (updates.session_limit !== undefined) updateData.session_limit = updates.session_limit;
    if (updates.voice_enabled !== undefined) updateData.voice_enabled = updates.voice_enabled ? 1 : 0;
    if (updates.file_upload_enabled !== undefined) updateData.file_upload_enabled = updates.file_upload_enabled ? 1 : 0;
    if (updates.max_file_size_mb !== undefined) updateData.max_file_size_mb = updates.max_file_size_mb;
    if (updates.web_search_enabled !== undefined) updateData.web_search_enabled = updates.web_search_enabled ? 1 : 0;
    if (updates.auth_required !== undefined) updateData.auth_required = updates.auth_required ? 1 : 0;

    if (Object.keys(updateData).length > 0) {
      await trx
        .updateTable('workspaces')
        .set(updateData)
        .where('id', '=', id)
        .execute();
    }

    // Update categories if provided
    if (updates.category_ids !== undefined) {
      await trx
        .deleteFrom('workspace_categories')
        .where('workspace_id', '=', id)
        .execute();

      if (updates.category_ids.length > 0) {
        await trx
          .insertInto('workspace_categories')
          .values(updates.category_ids.map(cid => ({ workspace_id: id, category_id: cid })))
          .onConflict(oc => oc.doNothing())
          .execute();
      }
    }

    const row = await trx
      .selectFrom('workspaces')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row ? rowToWorkspace(row) : null;
  });
}

/**
 * Delete a workspace
 */
export async function deleteWorkspace(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('workspaces')
    .where('id', '=', id)
    .executeTakeFirst();

  return Number(result.numDeletedRows) > 0;
}

/**
 * Toggle workspace enabled status
 */
export async function toggleWorkspaceEnabled(id: string, enabled: boolean): Promise<Workspace | null> {
  const db = await getDb();
  await db
    .updateTable('workspaces')
    .set({ is_enabled: enabled ? 1 : 0 })
    .where('id', '=', id)
    .execute();

  return getWorkspaceById(id);
}

// ============ Category Operations ============

/**
 * Get category IDs linked to a workspace
 */
export async function getWorkspaceCategoryIds(workspaceId: string): Promise<number[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('workspace_categories')
    .select('category_id')
    .where('workspace_id', '=', workspaceId)
    .execute();

  return rows.map(r => r.category_id as number);
}

/**
 * Get category IDs for multiple workspaces in a single query (batch N+1 fix)
 */
export async function getWorkspaceCategoryIdsForMany(
  workspaceIds: string[]
): Promise<Map<string, number[]>> {
  if (workspaceIds.length === 0) return new Map();
  const db = await getDb();
  const rows = await db
    .selectFrom('workspace_categories')
    .select(['workspace_id', 'category_id'])
    .where('workspace_id', 'in', workspaceIds)
    .execute();

  const map = new Map<string, number[]>();
  for (const row of rows) {
    const wsId = String(row.workspace_id);
    const existing = map.get(wsId) || [];
    existing.push(row.category_id as number);
    map.set(wsId, existing);
  }
  return map;
}

/**
 * Get category slugs linked to a workspace (for RAG queries)
 */
export async function getWorkspaceCategorySlugs(workspaceId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('categories')
    .innerJoin('workspace_categories', 'categories.id', 'workspace_categories.category_id')
    .select('categories.slug')
    .where('workspace_categories.workspace_id', '=', workspaceId)
    .execute();

  return rows.map(r => r.slug as string);
}

/**
 * Set categories for a workspace (replace all)
 */
export async function setWorkspaceCategories(workspaceId: string, categoryIds: number[]): Promise<void> {
  return transaction(async (trx) => {
    await trx
      .deleteFrom('workspace_categories')
      .where('workspace_id', '=', workspaceId)
      .execute();

    if (categoryIds.length > 0) {
      await trx
        .insertInto('workspace_categories')
        .values(categoryIds.map(cid => ({ workspace_id: workspaceId, category_id: cid })))
        .onConflict(oc => oc.doNothing())
        .execute();
    }
  });
}

// ============ Access Control ============

/**
 * Check if a user can access a workspace
 *
 * - Embed workspaces: always accessible
 * - Explicit access mode: user must be in workspace_users
 * - Category access mode: user must have ALL workspace categories
 */
export async function canUserAccessWorkspace(userId: number, workspaceId: string): Promise<boolean> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace || !workspace.is_enabled) return false;

  // Embed workspaces don't require user authentication
  if (workspace.type === 'embed') return true;

  // Explicit access mode: check workspace_users
  if (workspace.access_mode === 'explicit') {
    return isUserInWorkspaceAccessList(userId, workspaceId);
  }

  // Category-based access: user must have ALL workspace categories
  const workspaceCategories = await getWorkspaceCategoryIds(workspaceId);
  if (workspaceCategories.length === 0) return true; // No categories = open access

  const db = await getDb();
  const userCats = await db
    .selectFrom('user_subscriptions')
    .select('category_id')
    .where('user_id', '=', userId)
    .where('is_active', '=', 1)
    .execute();

  const userCategoryIds = new Set(userCats.map(r => r.category_id as number));
  return workspaceCategories.every(catId => userCategoryIds.has(catId));
}

/**
 * Check if user is in workspace's explicit access list
 */
export async function isUserInWorkspaceAccessList(userId: number, workspaceId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .selectFrom('workspace_users')
    .select(db.fn.count('id').as('count'))
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  return Number(result?.count || 0) > 0;
}

/**
 * Validate domain for embed workspace
 *
 * Checks if the given origin is in the workspace's allowed_domains list.
 * Supports exact hostname matches and wildcard subdomains (*.example.com).
 * Returns true if no allowed_domains are configured (allow all).
 */
export async function validateDomain(workspaceId: string, origin: string): Promise<boolean> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return false;

  // If no allowed domains specified, allow all
  if (!workspace.allowed_domains || workspace.allowed_domains.length === 0) {
    return true;
  }

  try {
    const url = new URL(origin);
    const hostname = url.hostname;

    return workspace.allowed_domains.some((domain) => {
      // Exact match
      if (domain === hostname) return true;
      // Wildcard subdomain match (*.example.com)
      if (domain.startsWith('*.')) {
        const baseDomain = domain.slice(2);
        return hostname === baseDomain || hostname.endsWith('.' + baseDomain);
      }
      return false;
    });
  } catch {
    return false;
  }
}

// ============ Utility Functions ============

/**
 * Check if slug exists
 */
export async function slugExists(slug: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .selectFrom('workspaces')
    .select(db.fn.count('id').as('count'))
    .where('slug', '=', slug)
    .executeTakeFirst();

  return Number(result?.count || 0) > 0;
}

/**
 * Get workspace count by type
 */
export async function getWorkspaceCountByType(): Promise<{ embed: number; standalone: number }> {
  const db = await getDb();
  const embed = await db
    .selectFrom('workspaces')
    .select(db.fn.count('id').as('count'))
    .where('type', '=', 'embed')
    .executeTakeFirst();

  const standalone = await db
    .selectFrom('workspaces')
    .select(db.fn.count('id').as('count'))
    .where('type', '=', 'standalone')
    .executeTakeFirst();

  return {
    embed: Number(embed?.count || 0),
    standalone: Number(standalone?.count || 0),
  };
}

/**
 * Search workspaces by name
 */
export async function searchWorkspaces(query: string, type?: WorkspaceType): Promise<WorkspaceWithRelations[]> {
  const db = await getDb();
  let q = db
    .selectFrom('workspaces')
    .selectAll()
    .where('name', 'like', `%${query}%`)
    .orderBy('created_at', 'desc');

  if (type) {
    q = q.where('type', '=', type);
  }

  const rows = await q.execute();
  const workspaces = rows.map(row => rowToWorkspace(row));
  const categoryMap = await getWorkspaceCategoryIdsForMany(workspaces.map(w => w.id));

  return workspaces.map(w => ({
    ...w,
    category_ids: categoryMap.get(w.id) || [],
  }));
}

// ============ Helper Functions ============

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  type: string;
  is_enabled: number;
  access_mode: string;
  primary_color: string | null;
  logo_url: string | null;
  chat_title: string | null;
  greeting_message: string | null;
  suggested_prompts: string | null;
  footer_text: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  temperature: number | null;
  system_prompt: string | null;
  allowed_domains: string | null;
  daily_limit: number | null;
  session_limit: number | null;
  voice_enabled: number;
  file_upload_enabled: number;
  max_file_size_mb: number | null;
  web_search_enabled: number;
  auth_required: number;
  created_by: string | null;
  created_by_role: string | null;
  created_at: string;
  updated_at: string;
}

function rowToWorkspace(row: unknown): Workspace {
  const r = row as WorkspaceRow;
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    type: r.type as WorkspaceType,
    is_enabled: r.is_enabled === 1,
    access_mode: r.access_mode as 'category' | 'explicit',
    primary_color: r.primary_color || '#2563eb',
    logo_url: r.logo_url,
    chat_title: r.chat_title,
    greeting_message: r.greeting_message || 'How can I help you today?',
    suggested_prompts: r.suggested_prompts ? JSON.parse(r.suggested_prompts) : null,
    footer_text: r.footer_text,
    llm_provider: r.llm_provider,
    llm_model: r.llm_model,
    temperature: r.temperature,
    system_prompt: r.system_prompt,
    allowed_domains: JSON.parse(r.allowed_domains || '[]'),
    daily_limit: r.daily_limit ?? 1000,
    session_limit: r.session_limit ?? 50,
    voice_enabled: r.voice_enabled === 1,
    file_upload_enabled: r.file_upload_enabled === 1,
    max_file_size_mb: r.max_file_size_mb ?? 5,
    web_search_enabled: r.web_search_enabled === 1,
    auth_required: r.auth_required === 1,
    created_by: r.created_by || '',
    created_by_role: (r.created_by_role || 'admin') as CreatorRole,
    created_at: r.created_at || new Date().toISOString(),
    updated_at: r.updated_at || new Date().toISOString(),
  };
}

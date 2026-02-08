/**
 * Workspace Database Operations
 *
 * CRUD operations for workspaces (embed and standalone modes).
 * Handles workspace management, category linking, and access control.
 */

import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, queryAll, queryOne, execute, transaction } from './index';
import type {
  Workspace,
  WorkspaceWithRelations,
  WorkspaceRow,
  WorkspaceType,
  AccessMode,
  CreatorRole,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
} from '@/types/workspace';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a random 16-character slug for workspace URLs
 * Uses lowercase alphanumeric characters for URL-friendliness
 */
export function generateSlug(): string {
  // Use more bytes to ensure we have enough characters after filtering out +/= chars
  const bytes = randomBytes(24);
  const slug = bytes
    .toString('base64')
    .replace(/[+/=]/g, '')
    .toLowerCase()
    .slice(0, 16);

  // Ensure we got exactly 16 characters (very rare edge case if not)
  if (slug.length < 16) {
    return generateSlug();
  }

  return slug;
}

/**
 * Convert database row to Workspace object
 */
function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type as WorkspaceType,
    is_enabled: row.is_enabled === 1,
    access_mode: row.access_mode as AccessMode,
    primary_color: row.primary_color,
    logo_url: row.logo_url,
    chat_title: row.chat_title,
    greeting_message: row.greeting_message,
    suggested_prompts: row.suggested_prompts ? JSON.parse(row.suggested_prompts) : null,
    footer_text: row.footer_text,
    llm_provider: row.llm_provider,
    llm_model: row.llm_model,
    temperature: row.temperature,
    system_prompt: row.system_prompt,
    allowed_domains: JSON.parse(row.allowed_domains || '[]'),
    daily_limit: row.daily_limit,
    session_limit: row.session_limit,
    voice_enabled: row.voice_enabled === 1,
    file_upload_enabled: row.file_upload_enabled === 1,
    max_file_size_mb: row.max_file_size_mb,
    web_search_enabled: row.web_search_enabled === 1,
    auth_required: row.auth_required === 1,
    created_by: row.created_by,
    created_by_role: row.created_by_role as CreatorRole,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ============================================================================
// Workspace CRUD
// ============================================================================

/**
 * Get workspace by slug (used for public access)
 */
export function getWorkspaceBySlug(slug: string): Workspace | null {
  const row = queryOne<WorkspaceRow>(
    'SELECT * FROM workspaces WHERE slug = ?',
    [slug]
  );
  return row ? rowToWorkspace(row) : null;
}

/**
 * Get workspace by ID
 */
export function getWorkspaceById(id: string): Workspace | null {
  const row = queryOne<WorkspaceRow>(
    'SELECT * FROM workspaces WHERE id = ?',
    [id]
  );
  return row ? rowToWorkspace(row) : null;
}

/**
 * Get workspace with related data (categories, counts)
 */
export function getWorkspaceWithRelations(id: string): WorkspaceWithRelations | null {
  const workspace = getWorkspaceById(id);
  if (!workspace) return null;

  const categoryIds = getWorkspaceCategoryIds(id);
  const categoryNames = queryAll<{ name: string }>(
    `SELECT c.name FROM categories c
     INNER JOIN workspace_categories wc ON c.id = wc.category_id
     WHERE wc.workspace_id = ?`,
    [id]
  ).map((r) => r.name);

  const counts = queryOne<{
    user_count: number;
    session_count: number;
    message_count: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM workspace_users WHERE workspace_id = ?) as user_count,
       (SELECT COUNT(*) FROM workspace_sessions WHERE workspace_id = ?) as session_count,
       (SELECT COUNT(*) FROM workspace_messages WHERE workspace_id = ?) as message_count`,
    [id, id, id]
  );

  return {
    ...workspace,
    category_ids: categoryIds,
    category_names: categoryNames,
    user_count: counts?.user_count || 0,
    session_count: counts?.session_count || 0,
    message_count: counts?.message_count || 0,
  };
}

/**
 * List all workspaces (optionally filtered by type)
 */
export function listWorkspaces(type?: WorkspaceType): WorkspaceWithRelations[] {
  const sql = type
    ? 'SELECT * FROM workspaces WHERE type = ? ORDER BY created_at DESC'
    : 'SELECT * FROM workspaces ORDER BY created_at DESC';
  const params = type ? [type] : [];

  const rows = queryAll<WorkspaceRow>(sql, params);
  return rows.map((row) => {
    const workspace = rowToWorkspace(row);
    const categoryIds = getWorkspaceCategoryIds(workspace.id);
    return { ...workspace, category_ids: categoryIds };
  });
}

/**
 * List workspaces created by a specific user (for superuser scope)
 */
export function listWorkspacesByCreator(createdBy: string): WorkspaceWithRelations[] {
  const rows = queryAll<WorkspaceRow>(
    'SELECT * FROM workspaces WHERE created_by = ? ORDER BY created_at DESC',
    [createdBy]
  );
  return rows.map((row) => {
    const workspace = rowToWorkspace(row);
    const categoryIds = getWorkspaceCategoryIds(workspace.id);
    return { ...workspace, category_ids: categoryIds };
  });
}

/**
 * List workspaces accessible to a user (based on category access)
 */
export function listWorkspacesForUser(userId: number): WorkspaceWithRelations[] {
  // Get user's subscribed category IDs
  const userCategories = queryAll<{ category_id: number }>(
    `SELECT category_id FROM user_subscriptions WHERE user_id = ? AND is_active = 1`,
    [userId]
  ).map((r) => r.category_id);

  if (userCategories.length === 0) {
    return [];
  }

  // Get workspaces where:
  // 1. Workspace is enabled
  // 2. AND (access_mode = 'explicit' AND user is in workspace_users)
  //    OR (access_mode = 'category' AND user has ALL workspace categories)
  const rows = queryAll<WorkspaceRow>(
    `SELECT DISTINCT w.* FROM workspaces w
     WHERE w.is_enabled = 1
     AND (
       -- Explicit access mode: user is in workspace_users
       (w.access_mode = 'explicit' AND EXISTS (
         SELECT 1 FROM workspace_users wu WHERE wu.workspace_id = w.id AND wu.user_id = ?
       ))
       OR
       -- Category-based: user has all workspace categories
       (w.access_mode = 'category' AND NOT EXISTS (
         SELECT 1 FROM workspace_categories wc
         WHERE wc.workspace_id = w.id
         AND wc.category_id NOT IN (
           SELECT category_id FROM user_subscriptions
           WHERE user_id = ? AND is_active = 1
         )
       ))
     )
     ORDER BY w.created_at DESC`,
    [userId, userId]
  );

  return rows.map((row) => {
    const workspace = rowToWorkspace(row);
    const categoryIds = getWorkspaceCategoryIds(workspace.id);
    return { ...workspace, category_ids: categoryIds };
  });
}

/**
 * Create a new workspace
 */
export function createWorkspace(
  input: CreateWorkspaceInput,
  createdBy: string,
  role: CreatorRole
): Workspace {
  const id = uuidv4();
  let slug = generateSlug();

  // Ensure slug is unique
  while (getWorkspaceBySlug(slug)) {
    slug = generateSlug();
  }

  return transaction(() => {
    execute(
      `INSERT INTO workspaces (
        id, slug, name, type, is_enabled, access_mode,
        primary_color, logo_url, chat_title, greeting_message, suggested_prompts, footer_text,
        llm_provider, llm_model, temperature, system_prompt,
        allowed_domains, daily_limit, session_limit,
        voice_enabled, file_upload_enabled, max_file_size_mb, web_search_enabled, auth_required,
        created_by, created_by_role
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        slug,
        input.name,
        input.type,
        input.access_mode || 'category',
        input.primary_color || '#2563eb',
        input.logo_url || null,
        input.chat_title || null,
        input.greeting_message || 'How can I help you today?',
        input.suggested_prompts ? JSON.stringify(input.suggested_prompts) : null,
        input.footer_text || null,
        input.llm_provider || null,
        input.llm_model || null,
        input.temperature ?? null,
        input.system_prompt || null,
        JSON.stringify(input.allowed_domains || []),
        input.daily_limit ?? 1000,
        input.session_limit ?? 50,
        input.voice_enabled ? 1 : 0,
        input.file_upload_enabled ? 1 : 0,
        input.max_file_size_mb ?? 5,
        input.web_search_enabled !== false ? 1 : 0,
        input.auth_required ? 1 : 0,
        createdBy,
        role,
      ]
    );

    // Link categories
    if (input.category_ids && input.category_ids.length > 0) {
      linkCategories(id, input.category_ids);
    }

    return getWorkspaceById(id)!;
  });
}

/**
 * Update a workspace
 */
export function updateWorkspace(id: string, updates: UpdateWorkspaceInput): Workspace | null {
  const existing = getWorkspaceById(id);
  if (!existing) return null;

  const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    setClauses.push('name = ?');
    params.push(updates.name);
  }
  if (updates.is_enabled !== undefined) {
    setClauses.push('is_enabled = ?');
    params.push(updates.is_enabled ? 1 : 0);
  }
  if (updates.access_mode !== undefined) {
    setClauses.push('access_mode = ?');
    params.push(updates.access_mode);
  }
  if (updates.primary_color !== undefined) {
    setClauses.push('primary_color = ?');
    params.push(updates.primary_color);
  }
  if (updates.logo_url !== undefined) {
    setClauses.push('logo_url = ?');
    params.push(updates.logo_url);
  }
  if (updates.chat_title !== undefined) {
    setClauses.push('chat_title = ?');
    params.push(updates.chat_title);
  }
  if (updates.greeting_message !== undefined) {
    setClauses.push('greeting_message = ?');
    params.push(updates.greeting_message);
  }
  if (updates.suggested_prompts !== undefined) {
    setClauses.push('suggested_prompts = ?');
    params.push(updates.suggested_prompts ? JSON.stringify(updates.suggested_prompts) : null);
  }
  if (updates.footer_text !== undefined) {
    setClauses.push('footer_text = ?');
    params.push(updates.footer_text);
  }
  if (updates.llm_provider !== undefined) {
    setClauses.push('llm_provider = ?');
    params.push(updates.llm_provider);
  }
  if (updates.llm_model !== undefined) {
    setClauses.push('llm_model = ?');
    params.push(updates.llm_model);
  }
  if (updates.temperature !== undefined) {
    setClauses.push('temperature = ?');
    params.push(updates.temperature);
  }
  if (updates.system_prompt !== undefined) {
    setClauses.push('system_prompt = ?');
    params.push(updates.system_prompt);
  }
  if (updates.allowed_domains !== undefined) {
    setClauses.push('allowed_domains = ?');
    params.push(JSON.stringify(updates.allowed_domains));
  }
  if (updates.daily_limit !== undefined) {
    setClauses.push('daily_limit = ?');
    params.push(updates.daily_limit);
  }
  if (updates.session_limit !== undefined) {
    setClauses.push('session_limit = ?');
    params.push(updates.session_limit);
  }
  if (updates.voice_enabled !== undefined) {
    setClauses.push('voice_enabled = ?');
    params.push(updates.voice_enabled ? 1 : 0);
  }
  if (updates.file_upload_enabled !== undefined) {
    setClauses.push('file_upload_enabled = ?');
    params.push(updates.file_upload_enabled ? 1 : 0);
  }
  if (updates.max_file_size_mb !== undefined) {
    setClauses.push('max_file_size_mb = ?');
    params.push(updates.max_file_size_mb);
  }
  if (updates.web_search_enabled !== undefined) {
    setClauses.push('web_search_enabled = ?');
    params.push(updates.web_search_enabled ? 1 : 0);
  }
  if (updates.auth_required !== undefined) {
    setClauses.push('auth_required = ?');
    params.push(updates.auth_required ? 1 : 0);
  }

  params.push(id);

  return transaction(() => {
    if (setClauses.length > 1) {
      execute(
        `UPDATE workspaces SET ${setClauses.join(', ')} WHERE id = ?`,
        params
      );
    }

    // Update categories if provided
    if (updates.category_ids !== undefined) {
      execute('DELETE FROM workspace_categories WHERE workspace_id = ?', [id]);
      if (updates.category_ids.length > 0) {
        linkCategories(id, updates.category_ids);
      }
    }

    return getWorkspaceById(id);
  });
}

/**
 * Delete a workspace
 */
export function deleteWorkspace(id: string): boolean {
  const result = execute('DELETE FROM workspaces WHERE id = ?', [id]);
  return result.changes > 0;
}

/**
 * Toggle workspace enabled status
 */
export function toggleWorkspaceEnabled(id: string, enabled: boolean): Workspace | null {
  execute(
    'UPDATE workspaces SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [enabled ? 1 : 0, id]
  );
  return getWorkspaceById(id);
}

// ============================================================================
// Category Linking
// ============================================================================

/**
 * Link categories to a workspace
 */
export function linkCategories(workspaceId: string, categoryIds: number[]): void {
  const db = getDatabase();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO workspace_categories (workspace_id, category_id) VALUES (?, ?)'
  );

  for (const categoryId of categoryIds) {
    stmt.run(workspaceId, categoryId);
  }
}

/**
 * Get category IDs linked to a workspace
 */
export function getWorkspaceCategoryIds(workspaceId: string): number[] {
  return queryAll<{ category_id: number }>(
    'SELECT category_id FROM workspace_categories WHERE workspace_id = ?',
    [workspaceId]
  ).map((r) => r.category_id);
}

/**
 * Get category slugs linked to a workspace (for RAG queries)
 */
export function getWorkspaceCategorySlugs(workspaceId: string): string[] {
  return queryAll<{ slug: string }>(
    `SELECT c.slug FROM categories c
     INNER JOIN workspace_categories wc ON c.id = wc.category_id
     WHERE wc.workspace_id = ?`,
    [workspaceId]
  ).map((r) => r.slug);
}

/**
 * Set categories for a workspace (replace all)
 */
export function setWorkspaceCategories(workspaceId: string, categoryIds: number[]): void {
  transaction(() => {
    execute('DELETE FROM workspace_categories WHERE workspace_id = ?', [workspaceId]);
    if (categoryIds.length > 0) {
      linkCategories(workspaceId, categoryIds);
    }
  });
}

// ============================================================================
// Access Control
// ============================================================================

/**
 * Check if a user can access a workspace
 * - For embed mode: Always true (no auth required)
 * - For standalone mode: Check category access or explicit user list
 */
export function canUserAccessWorkspace(userId: number, workspaceId: string): boolean {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace || !workspace.is_enabled) return false;

  // Embed workspaces don't require user authentication
  if (workspace.type === 'embed') return true;

  // Check access mode
  if (workspace.access_mode === 'explicit') {
    return isUserInWorkspaceAccessList(userId, workspaceId);
  }

  // Category-based access: user must have ALL workspace categories
  const workspaceCategories = getWorkspaceCategoryIds(workspaceId);
  if (workspaceCategories.length === 0) return true; // No categories = open access

  const userCategories = queryAll<{ category_id: number }>(
    `SELECT category_id FROM user_subscriptions WHERE user_id = ? AND is_active = 1`,
    [userId]
  ).map((r) => r.category_id);

  return workspaceCategories.every((catId) => userCategories.includes(catId));
}

/**
 * Check if user is in workspace's explicit access list
 */
export function isUserInWorkspaceAccessList(userId: number, workspaceId: string): boolean {
  const result = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM workspace_users WHERE workspace_id = ? AND user_id = ?',
    [workspaceId, userId]
  );
  return (result?.count || 0) > 0;
}

/**
 * Validate domain for embed workspace
 */
export function validateDomain(workspaceId: string, origin: string): boolean {
  const workspace = getWorkspaceById(workspaceId);
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

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if slug exists (for validation)
 */
export function slugExists(slug: string): boolean {
  const result = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM workspaces WHERE slug = ?',
    [slug]
  );
  return (result?.count || 0) > 0;
}

/**
 * Get workspace count by type
 */
export function getWorkspaceCountByType(): { embed: number; standalone: number } {
  const embed = queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM workspaces WHERE type = 'embed'",
    []
  );
  const standalone = queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM workspaces WHERE type = 'standalone'",
    []
  );
  return {
    embed: embed?.count || 0,
    standalone: standalone?.count || 0,
  };
}

/**
 * Search workspaces by name
 */
export function searchWorkspaces(query: string, type?: WorkspaceType): WorkspaceWithRelations[] {
  const searchPattern = `%${query}%`;
  const sql = type
    ? 'SELECT * FROM workspaces WHERE name LIKE ? AND type = ? ORDER BY created_at DESC'
    : 'SELECT * FROM workspaces WHERE name LIKE ? ORDER BY created_at DESC';
  const params = type ? [searchPattern, type] : [searchPattern];

  const rows = queryAll<WorkspaceRow>(sql, params);
  return rows.map((row) => {
    const workspace = rowToWorkspace(row);
    const categoryIds = getWorkspaceCategoryIds(workspace.id);
    return { ...workspace, category_ids: categoryIds };
  });
}

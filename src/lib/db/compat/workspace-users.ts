/**
 * Workspace User Management
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb, transaction } from '../kysely';
import type { WorkspaceUser } from '@/types/workspace';

// Re-export types
export type { WorkspaceUser };

// ============ User Management ============

/**
 * Add a user to a workspace (for explicit access mode)
 */
export async function addUserToWorkspace(
  workspaceId: string,
  userId: number,
  addedBy: string
): Promise<void> {
  const db = await getDb();
  await db
    .insertInto('workspace_users')
    .values({
      workspace_id: workspaceId,
      user_id: userId,
      added_by: addedBy,
    })
    .onConflict(oc => oc.doNothing())
    .execute();
}

/**
 * Remove a user from a workspace
 */
export async function removeUserFromWorkspace(
  workspaceId: string,
  userId: number
): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_users')
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  return Number(result.numDeletedRows) > 0;
}

/**
 * Get all users with access to a workspace
 */
export async function getWorkspaceUsers(workspaceId: string): Promise<WorkspaceUser[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('workspace_users as wu')
    .innerJoin('users as u', 'wu.user_id', 'u.id')
    .select([
      'wu.workspace_id',
      'wu.user_id',
      'u.email as user_email',
      'u.name as user_name',
      'wu.added_by',
      'wu.added_at',
    ])
    .where('wu.workspace_id', '=', workspaceId)
    .orderBy('wu.added_at', 'desc')
    .execute();

  return rows.map(r => ({
    workspace_id: r.workspace_id as string,
    user_id: r.user_id as number,
    user_email: r.user_email as string,
    user_name: r.user_name as string | null,
    added_by: r.added_by as string,
    added_at: r.added_at as string,
  }));
}

/**
 * Check if a user is in the workspace access list
 */
export async function isUserInWorkspaceAccessList(
  userId: number,
  workspaceId: string
): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .selectFrom('workspace_users')
    .select(db.fn.count('user_id').as('count'))
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  return Number(result?.count || 0) > 0;
}

/**
 * Bulk add users to a workspace
 */
export async function bulkAddUsersToWorkspace(
  workspaceId: string,
  userIds: number[],
  addedBy: string
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;

  await transaction(async (trx) => {
    for (const userId of userIds) {
      // Check if already exists
      const existing = await trx
        .selectFrom('workspace_users')
        .select('user_id')
        .where('workspace_id', '=', workspaceId)
        .where('user_id', '=', userId)
        .executeTakeFirst();

      if (existing) {
        skipped++;
      } else {
        await trx
          .insertInto('workspace_users')
          .values({
            workspace_id: workspaceId,
            user_id: userId,
            added_by: addedBy,
          })
          .execute();
        added++;
      }
    }
  });

  return { added, skipped };
}

/**
 * Bulk remove users from a workspace
 */
export async function bulkRemoveUsersFromWorkspace(
  workspaceId: string,
  userIds: number[]
): Promise<number> {
  if (userIds.length === 0) return 0;

  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_users')
    .where('workspace_id', '=', workspaceId)
    .where('user_id', 'in', userIds)
    .executeTakeFirst();

  return Number(result.numDeletedRows);
}

/**
 * Get count of users in a workspace
 */
export async function getWorkspaceUserCount(workspaceId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('workspace_users')
    .select(db.fn.count('user_id').as('count'))
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();

  return Number(result?.count || 0);
}

/**
 * Get workspaces a user has been explicitly added to
 */
export async function getUserWorkspaces(userId: number): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('workspace_users')
    .select('workspace_id')
    .where('user_id', '=', userId)
    .execute();

  return rows.map(r => r.workspace_id as string);
}

/**
 * Remove all users from a workspace
 */
export async function clearWorkspaceUsers(workspaceId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_users')
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();

  return Number(result.numDeletedRows);
}

/**
 * Set workspace users (replace all existing)
 */
export async function setWorkspaceUsers(
  workspaceId: string,
  userIds: number[],
  addedBy: string
): Promise<void> {
  await transaction(async (trx) => {
    // Clear existing users
    await trx
      .deleteFrom('workspace_users')
      .where('workspace_id', '=', workspaceId)
      .execute();

    // Add new users
    if (userIds.length > 0) {
      for (const userId of userIds) {
        await trx
          .insertInto('workspace_users')
          .values({
            workspace_id: workspaceId,
            user_id: userId,
            added_by: addedBy,
          })
          .execute();
      }
    }
  });
}

// ============ Validation Helpers ============

/**
 * Get users who can be added to a workspace (have required category access)
 * Used by superusers who can only add users from their assigned categories
 */
export async function getEligibleUsersForWorkspace(
  workspaceId: string,
  limitToCategoryIds?: number[]
): Promise<Array<{ id: number; email: string; name: string | null }>> {
  const db = await getDb();

  // Get workspace categories
  const workspaceCatRows = await db
    .selectFrom('workspace_categories')
    .select('category_id')
    .where('workspace_id', '=', workspaceId)
    .execute();
  const workspaceCategories = workspaceCatRows.map(r => r.category_id as number);

  if (workspaceCategories.length === 0) {
    // No category restrictions - return all users not already in the workspace
    return await db
      .selectFrom('users as u')
      .select(['u.id', 'u.email', 'u.name'])
      .where('u.id', 'not in',
        db.selectFrom('workspace_users')
          .select('user_id')
          .where('workspace_id', '=', workspaceId)
      )
      .orderBy('u.email')
      .execute();
  }

  // If limitToCategoryIds provided (for superuser), intersect with workspace categories
  const effectiveCategories = limitToCategoryIds
    ? workspaceCategories.filter(id => limitToCategoryIds.includes(id))
    : workspaceCategories;

  if (effectiveCategories.length === 0) {
    return []; // Superuser has no overlap with workspace categories
  }

  // Find users who have ALL effective categories and are not already in the workspace
  const rows = await db
    .selectFrom('users as u')
    .select(['u.id', 'u.email', 'u.name'])
    .where('u.id', 'not in',
      db.selectFrom('workspace_users')
        .select('user_id')
        .where('workspace_id', '=', workspaceId)
    )
    .where(eb =>
      eb(
        eb.selectFrom('user_subscriptions as us')
          .select(eb.fn.countAll<number>().as('cnt'))
          .whereRef('us.user_id', '=', 'u.id')
          .where('us.is_active', '=', 1)
          .where('us.category_id', 'in', effectiveCategories),
        '=',
        effectiveCategories.length
      )
    )
    .orderBy('u.email')
    .execute();

  return rows;
}

/**
 * Check if a superuser can manage users for a workspace
 * Superuser must have access to ALL workspace categories
 */
export async function canSuperuserManageWorkspaceUsers(
  superuserId: number,
  workspaceId: string
): Promise<boolean> {
  const db = await getDb();

  // Get workspace categories
  const workspaceCatRows = await db
    .selectFrom('workspace_categories')
    .select('category_id')
    .where('workspace_id', '=', workspaceId)
    .execute();
  const workspaceCategories = workspaceCatRows.map(r => r.category_id as number);

  if (workspaceCategories.length === 0) return true;

  // Get superuser's assigned categories
  const superuserCatRows = await db
    .selectFrom('super_user_categories')
    .select('category_id')
    .where('user_id', '=', superuserId)
    .execute();
  const superuserCategories = superuserCatRows.map(r => r.category_id as number);

  // Superuser must have ALL workspace categories
  return workspaceCategories.every(catId => superuserCategories.includes(catId));
}

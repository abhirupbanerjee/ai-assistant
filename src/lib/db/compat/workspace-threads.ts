/**
 * Workspace Thread Management
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'kysely';
import type {
  WorkspaceThread,
  WorkspaceThreadWithMessages,
  WorkspaceThreadRow,
  CreateWorkspaceThreadInput,
  UpdateWorkspaceThreadInput,
} from '@/types/workspace';
import { getThreadMessages } from './workspace-messages';

// Re-export types
export type {
  WorkspaceThread,
  WorkspaceThreadWithMessages,
  CreateWorkspaceThreadInput,
  UpdateWorkspaceThreadInput,
} from '@/types/workspace';

// ============================================================================
// Helpers
// ============================================================================

function rowToThread(row: WorkspaceThreadRow): WorkspaceThread {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    session_id: row.session_id,
    title: row.title,
    is_archived: row.is_archived === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ============================================================================
// Thread CRUD
// ============================================================================

/**
 * Create a new thread
 */
export async function createThread(
  workspaceId: string,
  sessionId: string,
  input: CreateWorkspaceThreadInput = {}
): Promise<WorkspaceThread> {
  const id = uuidv4();
  const title = input.title || 'New Chat';

  const db = await getDb();
  await db
    .insertInto('workspace_threads')
    .values({
      id,
      workspace_id: workspaceId,
      session_id: sessionId,
      title,
    })
    .execute();

  return (await getThread(id))!;
}

/**
 * Get thread by ID
 */
export async function getThread(threadId: string): Promise<WorkspaceThread | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('workspace_threads')
    .selectAll()
    .where('id', '=', threadId)
    .executeTakeFirst();

  return row ? rowToThread(row as unknown as WorkspaceThreadRow) : null;
}

/**
 * Get thread with messages
 */
export async function getThreadWithMessages(threadId: string): Promise<WorkspaceThreadWithMessages | null> {
  const thread = await getThread(threadId);
  if (!thread) return null;

  const messages = await getThreadMessages(threadId);
  return {
    ...thread,
    messages,
    message_count: messages.length,
  };
}

/**
 * Get thread with validation that it belongs to the session
 */
export async function getThreadForSession(
  threadId: string,
  sessionId: string
): Promise<WorkspaceThread | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('workspace_threads')
    .selectAll()
    .where('id', '=', threadId)
    .where('session_id', '=', sessionId)
    .executeTakeFirst();

  return row ? rowToThread(row as unknown as WorkspaceThreadRow) : null;
}

/**
 * Update thread
 */
export async function updateThread(
  threadId: string,
  updates: UpdateWorkspaceThreadInput
): Promise<WorkspaceThread | null> {
  const db = await getDb();
  const updateObj: Record<string, unknown> = {
    updated_at: sql`CURRENT_TIMESTAMP`,
  };

  if (updates.title !== undefined) {
    updateObj.title = updates.title;
  }
  if (updates.is_archived !== undefined) {
    updateObj.is_archived = updates.is_archived ? 1 : 0;
  }

  await db
    .updateTable('workspace_threads')
    .set(updateObj)
    .where('id', '=', threadId)
    .execute();

  return getThread(threadId);
}

/**
 * Delete thread (and cascade delete messages)
 */
export async function deleteThread(threadId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_threads')
    .where('id', '=', threadId)
    .executeTakeFirst();

  return Number(result.numDeletedRows || 0) > 0;
}

/**
 * Archive/unarchive thread
 */
export async function archiveThread(threadId: string, archived: boolean = true): Promise<WorkspaceThread | null> {
  return updateThread(threadId, { is_archived: archived });
}

/**
 * Update thread title
 */
export async function updateThreadTitle(threadId: string, title: string): Promise<WorkspaceThread | null> {
  return updateThread(threadId, { title });
}

/**
 * Touch thread (update updated_at timestamp)
 */
export async function touchThread(threadId: string): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('workspace_threads')
    .set({ updated_at: sql`CURRENT_TIMESTAMP` })
    .where('id', '=', threadId)
    .execute();
}

// ============================================================================
// Thread Queries
// ============================================================================

/**
 * Get all threads for a session (standalone mode)
 */
export async function getSessionThreads(
  sessionId: string,
  options: {
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<WorkspaceThread[]> {
  const { includeArchived = false, limit = 50, offset = 0 } = options;
  const db = await getDb();

  let query = db
    .selectFrom('workspace_threads')
    .selectAll()
    .where('session_id', '=', sessionId);

  if (!includeArchived) {
    query = query.where('is_archived', '=', 0);
  }

  const rows = await query
    .orderBy('updated_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return rows.map((row) => rowToThread(row as unknown as WorkspaceThreadRow));
}

/**
 * Get threads for a workspace
 */
export async function getWorkspaceThreads(
  workspaceId: string,
  options: {
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<WorkspaceThread[]> {
  const { includeArchived = false, limit = 100, offset = 0 } = options;
  const db = await getDb();

  let query = db
    .selectFrom('workspace_threads')
    .selectAll()
    .where('workspace_id', '=', workspaceId);

  if (!includeArchived) {
    query = query.where('is_archived', '=', 0);
  }

  const rows = await query
    .orderBy('updated_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return rows.map((row) => rowToThread(row as unknown as WorkspaceThreadRow));
}

/**
 * Get most recent thread for a session
 */
export async function getLatestThread(sessionId: string): Promise<WorkspaceThread | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('workspace_threads')
    .selectAll()
    .where('session_id', '=', sessionId)
    .where('is_archived', '=', 0)
    .orderBy('updated_at', 'desc')
    .limit(1)
    .executeTakeFirst();

  return row ? rowToThread(row as unknown as WorkspaceThreadRow) : null;
}

/**
 * Get or create a thread for a session
 * Returns the most recent active thread or creates a new one
 */
export async function getOrCreateThread(
  workspaceId: string,
  sessionId: string
): Promise<WorkspaceThread> {
  const existing = await getLatestThread(sessionId);
  if (existing) return existing;
  return createThread(workspaceId, sessionId);
}

/**
 * Search threads by title
 */
export async function searchThreads(
  sessionId: string,
  query: string,
  limit: number = 20
): Promise<WorkspaceThread[]> {
  const searchPattern = `%${query}%`;
  const db = await getDb();
  const rows = await db
    .selectFrom('workspace_threads')
    .selectAll()
    .where('session_id', '=', sessionId)
    .where('title', 'like', searchPattern)
    .orderBy('updated_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map((row) => rowToThread(row as unknown as WorkspaceThreadRow));
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Archive all threads for a session
 */
export async function archiveAllSessionThreads(sessionId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .updateTable('workspace_threads')
    .set({
      is_archived: 1,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where('session_id', '=', sessionId)
    .where('is_archived', '=', 0)
    .executeTakeFirst();

  return Number(result.numUpdatedRows || 0);
}

/**
 * Delete all threads for a session
 */
export async function deleteSessionThreads(sessionId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_threads')
    .where('session_id', '=', sessionId)
    .executeTakeFirst();

  return Number(result.numDeletedRows || 0);
}

/**
 * Delete all threads for a workspace
 */
export async function deleteWorkspaceThreads(workspaceId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_threads')
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();

  return Number(result.numDeletedRows || 0);
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get thread count for a session
 */
export async function getSessionThreadCount(
  sessionId: string,
  includeArchived: boolean = false
): Promise<number> {
  const db = await getDb();
  let query = db
    .selectFrom('workspace_threads')
    .select(db.fn.count<number>('id').as('count'))
    .where('session_id', '=', sessionId);

  if (!includeArchived) {
    query = query.where('is_archived', '=', 0);
  }

  const result = await query.executeTakeFirst();
  return result?.count || 0;
}

/**
 * Get thread count for a workspace
 */
export async function getWorkspaceThreadCount(workspaceId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('workspace_threads')
    .select(db.fn.count<number>('id').as('count'))
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();

  return result?.count || 0;
}

/**
 * Get message count for a thread
 */
export async function getThreadMessageCount(threadId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('workspace_messages')
    .select(db.fn.count<number>('id').as('count'))
    .where('thread_id', '=', threadId)
    .executeTakeFirst();

  return result?.count || 0;
}

/**
 * Auto-generate title from first message
 */
export async function autoTitleThread(threadId: string, maxLength: number = 50): Promise<string | null> {
  const db = await getDb();
  const firstMessage = await db
    .selectFrom('workspace_messages')
    .select('content')
    .where('thread_id', '=', threadId)
    .where('role', '=', 'user')
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();

  if (!firstMessage) return null;

  // Clean up and truncate content for title
  let title = firstMessage.content
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

  if (firstMessage.content.length > maxLength) {
    title += '...';
  }

  await updateThreadTitle(threadId, title);
  return title;
}

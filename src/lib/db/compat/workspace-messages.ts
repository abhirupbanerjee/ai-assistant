/**
 * Workspace Message Storage
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'kysely';
import type {
  WorkspaceMessage,
  WorkspaceMessageRow,
  WorkspaceMessageSource,
} from '@/types/workspace';

// Re-export types and helpers
export type { WorkspaceMessage, WorkspaceMessageSource } from '@/types/workspace';
export { parseSources } from '../utils';

// ============================================================================
// Helpers
// ============================================================================

function rowToMessage(row: WorkspaceMessageRow): WorkspaceMessage {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    session_id: row.session_id,
    thread_id: row.thread_id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    sources_json: row.sources_json,
    latency_ms: row.latency_ms,
    tokens_used: row.tokens_used,
    model: row.model ?? null,
    created_at: row.created_at,
  };
}

// ============================================================================
// Message CRUD
// ============================================================================

/**
 * Add a message to workspace storage
 */
export async function addMessage(input: {
  workspaceId: string;
  sessionId: string;
  threadId?: string | null;
  role: 'user' | 'assistant';
  content: string;
  sources?: WorkspaceMessageSource[];
  latencyMs?: number;
  tokensUsed?: number;
  model?: string;
}): Promise<WorkspaceMessage> {
  const id = uuidv4();
  const db = await getDb();

  await db
    .insertInto('workspace_messages')
    .values({
      id,
      workspace_id: input.workspaceId,
      session_id: input.sessionId,
      thread_id: input.threadId || null,
      role: input.role,
      content: input.content,
      sources_json: input.sources ? JSON.stringify(input.sources) : null,
      latency_ms: input.latencyMs || null,
      tokens_used: input.tokensUsed || null,
      model: input.model || null,
    })
    .execute();

  return (await getMessage(id))!;
}

/**
 * Get message by ID
 */
export async function getMessage(messageId: string): Promise<WorkspaceMessage | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('workspace_messages')
    .selectAll()
    .where('id', '=', messageId)
    .executeTakeFirst();

  return row ? rowToMessage(row as unknown as WorkspaceMessageRow) : null;
}

/**
 * Update message tokens used (after streaming completes)
 */
export async function updateMessageTokens(messageId: string, tokensUsed: number): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('workspace_messages')
    .set({ tokens_used: tokensUsed })
    .where('id', '=', messageId)
    .execute();
}

/**
 * Update message latency
 */
export async function updateMessageLatency(messageId: string, latencyMs: number): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('workspace_messages')
    .set({ latency_ms: latencyMs })
    .where('id', '=', messageId)
    .execute();
}

/**
 * Delete message
 */
export async function deleteMessage(messageId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_messages')
    .where('id', '=', messageId)
    .executeTakeFirst();

  return Number(result.numDeletedRows || 0) > 0;
}

// ============================================================================
// Message Queries
// ============================================================================

/**
 * Get messages for a thread (standalone mode)
 */
export async function getThreadMessages(
  threadId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<WorkspaceMessage[]> {
  const { limit = 100, offset = 0 } = options;
  const db = await getDb();

  const rows = await db
    .selectFrom('workspace_messages')
    .selectAll()
    .where('thread_id', '=', threadId)
    .orderBy('created_at', 'asc')
    .limit(limit)
    .offset(offset)
    .execute();

  return rows.map((row) => rowToMessage(row as unknown as WorkspaceMessageRow));
}

/**
 * Get messages for a session (all messages regardless of thread)
 * Useful for analytics
 */
export async function getSessionMessages(
  sessionId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<WorkspaceMessage[]> {
  const { limit = 100, offset = 0 } = options;
  const db = await getDb();

  const rows = await db
    .selectFrom('workspace_messages')
    .selectAll()
    .where('session_id', '=', sessionId)
    .orderBy('created_at', 'asc')
    .limit(limit)
    .offset(offset)
    .execute();

  return rows.map((row) => rowToMessage(row as unknown as WorkspaceMessageRow));
}

/**
 * Get messages for a workspace (for analytics/admin)
 */
export async function getWorkspaceMessages(
  workspaceId: string,
  options: { limit?: number; offset?: number; role?: 'user' | 'assistant' } = {}
): Promise<WorkspaceMessage[]> {
  const { limit = 100, offset = 0, role } = options;
  const db = await getDb();

  let query = db
    .selectFrom('workspace_messages')
    .selectAll()
    .where('workspace_id', '=', workspaceId);

  if (role) {
    query = query.where('role', '=', role);
  }

  const rows = await query
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return rows.map((row) => rowToMessage(row as unknown as WorkspaceMessageRow));
}

/**
 * Get recent messages for a thread (for context building)
 */
export async function getRecentThreadMessages(
  threadId: string,
  limit: number = 10
): Promise<WorkspaceMessage[]> {
  const db = await getDb();
  // Get last N messages, then reverse to chronological order
  const rows = await db
    .selectFrom('workspace_messages')
    .selectAll()
    .where('thread_id', '=', threadId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

  // Reverse to get chronological order
  return rows.reverse().map((row) => rowToMessage(row as unknown as WorkspaceMessageRow));
}

/**
 * Get last N messages from a session (for embed mode context)
 */
export async function getRecentSessionMessages(
  sessionId: string,
  limit: number = 10
): Promise<WorkspaceMessage[]> {
  const db = await getDb();
  // Get last N messages, then reverse to chronological order
  const rows = await db
    .selectFrom('workspace_messages')
    .selectAll()
    .where('session_id', '=', sessionId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

  // Reverse to get chronological order
  return rows.reverse().map((row) => rowToMessage(row as unknown as WorkspaceMessageRow));
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Delete all messages for a thread
 */
export async function deleteThreadMessages(threadId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_messages')
    .where('thread_id', '=', threadId)
    .executeTakeFirst();

  return Number(result.numDeletedRows || 0);
}

/**
 * Delete all messages for a session
 */
export async function deleteSessionMessages(sessionId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_messages')
    .where('session_id', '=', sessionId)
    .executeTakeFirst();

  return Number(result.numDeletedRows || 0);
}

/**
 * Delete all messages for a workspace
 */
export async function deleteWorkspaceMessages(workspaceId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_messages')
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();

  return Number(result.numDeletedRows || 0);
}

// ============================================================================
// Statistics
// ============================================================================

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
 * Get message count for a session
 */
export async function getSessionMessageCount(sessionId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('workspace_messages')
    .select(db.fn.count<number>('id').as('count'))
    .where('session_id', '=', sessionId)
    .executeTakeFirst();

  return result?.count || 0;
}

/**
 * Get message count for a workspace
 */
export async function getWorkspaceMessageCount(workspaceId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('workspace_messages')
    .select(db.fn.count<number>('id').as('count'))
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();

  return result?.count || 0;
}

/**
 * Get total tokens used for a workspace
 */
export async function getWorkspaceTotalTokens(workspaceId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('workspace_messages')
    .select(sql<number>`COALESCE(SUM(tokens_used), 0)`.as('total'))
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();

  return result?.total || 0;
}

/**
 * Get average latency for a workspace
 */
export async function getWorkspaceAverageLatency(workspaceId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('workspace_messages')
    .select(sql<number>`AVG(latency_ms)`.as('avg'))
    .where('workspace_id', '=', workspaceId)
    .where('latency_ms', 'is not', null)
    .executeTakeFirst();

  return result?.avg || 0;
}

/**
 * Get daily message counts for a workspace (for analytics)
 */
export async function getDailyMessageCounts(
  workspaceId: string,
  days: number = 30
): Promise<Array<{ date: string; count: number; tokens: number }>> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const db = await getDb();

  const rows = await db
    .selectFrom('workspace_messages')
    .select([
      sql<string>`DATE(created_at)`.as('date'),
      db.fn.count<number>('id').as('count'),
      sql<number>`COALESCE(SUM(tokens_used), 0)`.as('tokens'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('created_at', '>=', cutoff)
    .groupBy(sql`DATE(created_at)`)
    .orderBy('date', 'desc')
    .execute();

  return rows as Array<{ date: string; count: number; tokens: number }>;
}

/**
 * Get message count by role for a workspace
 */
export async function getMessageCountByRole(workspaceId: string): Promise<{ user: number; assistant: number }> {
  const db = await getDb();
  const rows = await db
    .selectFrom('workspace_messages')
    .select(['role', db.fn.count<number>('id').as('count')])
    .where('workspace_id', '=', workspaceId)
    .groupBy('role')
    .execute();

  const counts = { user: 0, assistant: 0 };
  for (const row of rows) {
    if (row.role === 'user') counts.user = row.count;
    if (row.role === 'assistant') counts.assistant = row.count;
  }
  return counts;
}

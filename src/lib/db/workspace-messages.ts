/**
 * Workspace Message Storage
 *
 * Handles message storage for both embed and standalone modes.
 * - Embed: Messages stored for analytics only (not returned to user)
 * - Standalone: Full message history with thread association
 */

import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, execute } from './index';
import type {
  WorkspaceMessage,
  WorkspaceMessageRow,
  WorkspaceMessageSource,
} from '@/types/workspace';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert database row to WorkspaceMessage object
 */
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

/**
 * Parse sources from JSON string
 */
export function parseSources(sourcesJson: string | null): WorkspaceMessageSource[] {
  if (!sourcesJson) return [];
  try {
    return JSON.parse(sourcesJson);
  } catch {
    return [];
  }
}

// ============================================================================
// Message CRUD
// ============================================================================

/**
 * Add a message to workspace storage
 */
export function addMessage(input: {
  workspaceId: string;
  sessionId: string;
  threadId?: string | null;
  role: 'user' | 'assistant';
  content: string;
  sources?: WorkspaceMessageSource[];
  latencyMs?: number;
  tokensUsed?: number;
}): WorkspaceMessage {
  const id = uuidv4();

  execute(
    `INSERT INTO workspace_messages (
      id, workspace_id, session_id, thread_id, role, content,
      sources_json, latency_ms, tokens_used
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.workspaceId,
      input.sessionId,
      input.threadId || null,
      input.role,
      input.content,
      input.sources ? JSON.stringify(input.sources) : null,
      input.latencyMs || null,
      input.tokensUsed || null,
    ]
  );

  return getMessage(id)!;
}

/**
 * Get message by ID
 */
export function getMessage(messageId: string): WorkspaceMessage | null {
  const row = queryOne<WorkspaceMessageRow>(
    'SELECT * FROM workspace_messages WHERE id = ?',
    [messageId]
  );
  return row ? rowToMessage(row) : null;
}

/**
 * Update message tokens used (after streaming completes)
 */
export function updateMessageTokens(messageId: string, tokensUsed: number): void {
  execute(
    'UPDATE workspace_messages SET tokens_used = ? WHERE id = ?',
    [tokensUsed, messageId]
  );
}

/**
 * Update message latency
 */
export function updateMessageLatency(messageId: string, latencyMs: number): void {
  execute(
    'UPDATE workspace_messages SET latency_ms = ? WHERE id = ?',
    [latencyMs, messageId]
  );
}

/**
 * Delete message
 */
export function deleteMessage(messageId: string): boolean {
  const result = execute(
    'DELETE FROM workspace_messages WHERE id = ?',
    [messageId]
  );
  return result.changes > 0;
}

// ============================================================================
// Message Queries
// ============================================================================

/**
 * Get messages for a thread (standalone mode)
 */
export function getThreadMessages(
  threadId: string,
  options: { limit?: number; offset?: number } = {}
): WorkspaceMessage[] {
  const { limit = 100, offset = 0 } = options;

  const rows = queryAll<WorkspaceMessageRow>(
    `SELECT * FROM workspace_messages
     WHERE thread_id = ?
     ORDER BY created_at ASC
     LIMIT ? OFFSET ?`,
    [threadId, limit, offset]
  );

  return rows.map(rowToMessage);
}

/**
 * Get messages for a session (all messages regardless of thread)
 * Useful for analytics
 */
export function getSessionMessages(
  sessionId: string,
  options: { limit?: number; offset?: number } = {}
): WorkspaceMessage[] {
  const { limit = 100, offset = 0 } = options;

  const rows = queryAll<WorkspaceMessageRow>(
    `SELECT * FROM workspace_messages
     WHERE session_id = ?
     ORDER BY created_at ASC
     LIMIT ? OFFSET ?`,
    [sessionId, limit, offset]
  );

  return rows.map(rowToMessage);
}

/**
 * Get messages for a workspace (for analytics/admin)
 */
export function getWorkspaceMessages(
  workspaceId: string,
  options: { limit?: number; offset?: number; role?: 'user' | 'assistant' } = {}
): WorkspaceMessage[] {
  const { limit = 100, offset = 0, role } = options;

  const whereClause = role
    ? 'WHERE workspace_id = ? AND role = ?'
    : 'WHERE workspace_id = ?';
  const params = role
    ? [workspaceId, role, limit, offset]
    : [workspaceId, limit, offset];

  const rows = queryAll<WorkspaceMessageRow>(
    `SELECT * FROM workspace_messages ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    params
  );

  return rows.map(rowToMessage);
}

/**
 * Get recent messages for a thread (for context building)
 */
export function getRecentThreadMessages(
  threadId: string,
  limit: number = 10
): WorkspaceMessage[] {
  const rows = queryAll<WorkspaceMessageRow>(
    `SELECT * FROM (
       SELECT * FROM workspace_messages
       WHERE thread_id = ?
       ORDER BY created_at DESC
       LIMIT ?
     ) ORDER BY created_at ASC`,
    [threadId, limit]
  );

  return rows.map(rowToMessage);
}

/**
 * Get last N messages from a session (for embed mode context)
 */
export function getRecentSessionMessages(
  sessionId: string,
  limit: number = 10
): WorkspaceMessage[] {
  const rows = queryAll<WorkspaceMessageRow>(
    `SELECT * FROM (
       SELECT * FROM workspace_messages
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ?
     ) ORDER BY created_at ASC`,
    [sessionId, limit]
  );

  return rows.map(rowToMessage);
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Delete all messages for a thread
 */
export function deleteThreadMessages(threadId: string): number {
  const result = execute(
    'DELETE FROM workspace_messages WHERE thread_id = ?',
    [threadId]
  );
  return result.changes;
}

/**
 * Delete all messages for a session
 */
export function deleteSessionMessages(sessionId: string): number {
  const result = execute(
    'DELETE FROM workspace_messages WHERE session_id = ?',
    [sessionId]
  );
  return result.changes;
}

/**
 * Delete all messages for a workspace
 */
export function deleteWorkspaceMessages(workspaceId: string): number {
  const result = execute(
    'DELETE FROM workspace_messages WHERE workspace_id = ?',
    [workspaceId]
  );
  return result.changes;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get message count for a thread
 */
export function getThreadMessageCount(threadId: string): number {
  const result = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM workspace_messages WHERE thread_id = ?',
    [threadId]
  );
  return result?.count || 0;
}

/**
 * Get message count for a session
 */
export function getSessionMessageCount(sessionId: string): number {
  const result = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM workspace_messages WHERE session_id = ?',
    [sessionId]
  );
  return result?.count || 0;
}

/**
 * Get message count for a workspace
 */
export function getWorkspaceMessageCount(workspaceId: string): number {
  const result = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM workspace_messages WHERE workspace_id = ?',
    [workspaceId]
  );
  return result?.count || 0;
}

/**
 * Get total tokens used for a workspace
 */
export function getWorkspaceTotalTokens(workspaceId: string): number {
  const result = queryOne<{ total: number | null }>(
    'SELECT SUM(tokens_used) as total FROM workspace_messages WHERE workspace_id = ?',
    [workspaceId]
  );
  return result?.total || 0;
}

/**
 * Get average latency for a workspace
 */
export function getWorkspaceAverageLatency(workspaceId: string): number {
  const result = queryOne<{ avg: number | null }>(
    `SELECT AVG(latency_ms) as avg FROM workspace_messages
     WHERE workspace_id = ? AND latency_ms IS NOT NULL`,
    [workspaceId]
  );
  return result?.avg || 0;
}

/**
 * Get daily message counts for a workspace (for analytics)
 */
export function getDailyMessageCounts(
  workspaceId: string,
  days: number = 30
): Array<{ date: string; count: number; tokens: number }> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return queryAll<{ date: string; count: number; tokens: number }>(
    `SELECT
       DATE(created_at) as date,
       COUNT(*) as count,
       COALESCE(SUM(tokens_used), 0) as tokens
     FROM workspace_messages
     WHERE workspace_id = ? AND created_at >= ?
     GROUP BY DATE(created_at)
     ORDER BY date DESC`,
    [workspaceId, cutoff]
  );
}

/**
 * Get message count by role for a workspace
 */
export function getMessageCountByRole(workspaceId: string): { user: number; assistant: number } {
  const result = queryAll<{ role: string; count: number }>(
    `SELECT role, COUNT(*) as count FROM workspace_messages
     WHERE workspace_id = ?
     GROUP BY role`,
    [workspaceId]
  );

  const counts = { user: 0, assistant: 0 };
  for (const row of result) {
    if (row.role === 'user') counts.user = row.count;
    if (row.role === 'assistant') counts.assistant = row.count;
  }
  return counts;
}

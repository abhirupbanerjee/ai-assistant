/**
 * Workspace Session Management
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'kysely';
import type { WorkspaceSession, WorkspaceSessionRow } from '@/types/workspace';

// Re-export types
export type { WorkspaceSession } from '@/types/workspace';

// ============================================================================
// Constants
// ============================================================================

const EMBED_SESSION_TTL_HOURS = 24;

// ============================================================================
// Helpers
// ============================================================================

function rowToSession(row: WorkspaceSessionRow): WorkspaceSession {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    visitor_id: row.visitor_id,
    user_id: row.user_id,
    referrer_url: row.referrer_url,
    ip_hash: row.ip_hash,
    message_count: row.message_count,
    started_at: row.started_at,
    last_activity: row.last_activity,
    expires_at: row.expires_at,
  };
}

// ============================================================================
// Session CRUD
// ============================================================================

/**
 * Create a new session for a workspace
 */
export async function createSession(
  workspaceId: string,
  options: {
    userId?: number;
    visitorId?: string;
    referrerUrl?: string;
    ipHash?: string;
    expiresInHours?: number;
  } = {}
): Promise<WorkspaceSession> {
  const id = uuidv4();
  const {
    userId,
    visitorId,
    referrerUrl,
    ipHash,
    expiresInHours = EMBED_SESSION_TTL_HOURS,
  } = options;

  // For embed mode, set expiry. For standalone (with userId), no expiry
  const expiresAt = userId
    ? null
    : new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  const db = await getDb();
  await db
    .insertInto('workspace_sessions')
    .values({
      id,
      workspace_id: workspaceId,
      visitor_id: visitorId || null,
      user_id: userId || null,
      referrer_url: referrerUrl || null,
      ip_hash: ipHash || null,
      expires_at: expiresAt,
    })
    .execute();

  return (await getSession(id))!;
}

/**
 * Get session by ID
 */
export async function getSession(sessionId: string): Promise<WorkspaceSession | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('workspace_sessions')
    .selectAll()
    .where('id', '=', sessionId)
    .executeTakeFirst();

  return row ? rowToSession(row as unknown as WorkspaceSessionRow) : null;
}

/**
 * Get session with workspace info
 */
export async function getSessionWithWorkspace(
  sessionId: string
): Promise<(WorkspaceSession & { workspace_type: string }) | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('workspace_sessions as ws')
    .innerJoin('workspaces as w', 'ws.workspace_id', 'w.id')
    .select([
      'ws.id',
      'ws.workspace_id',
      'ws.visitor_id',
      'ws.user_id',
      'ws.referrer_url',
      'ws.ip_hash',
      'ws.message_count',
      'ws.started_at',
      'ws.last_activity',
      'ws.expires_at',
      'w.type as workspace_type',
    ])
    .where('ws.id', '=', sessionId)
    .executeTakeFirst();

  if (!row) return null;
  return { ...rowToSession(row as unknown as WorkspaceSessionRow), workspace_type: row.workspace_type };
}

/**
 * Check if session is valid (exists and not expired)
 */
export async function isSessionValid(sessionId: string): Promise<boolean> {
  const session = await getSession(sessionId);
  if (!session) return false;

  // No expiry = always valid (standalone mode)
  if (!session.expires_at) return true;

  // Check if expired
  return new Date(session.expires_at) > new Date();
}

/**
 * Update session last activity timestamp
 */
export async function updateSessionActivity(sessionId: string): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('workspace_sessions')
    .set({ last_activity: sql`CURRENT_TIMESTAMP` })
    .where('id', '=', sessionId)
    .execute();
}

/**
 * Increment message count for a session
 */
export async function incrementMessageCount(sessionId: string): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('workspace_sessions')
    .set({
      message_count: sql`message_count + 1`,
      last_activity: sql`CURRENT_TIMESTAMP`,
    })
    .where('id', '=', sessionId)
    .execute();
}

/**
 * Get session message count
 */
export async function getSessionMessageCount(sessionId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('workspace_sessions')
    .select('message_count')
    .where('id', '=', sessionId)
    .executeTakeFirst();
  return result?.message_count || 0;
}

/**
 * Extend session expiry (for embed mode)
 */
export async function extendSessionExpiry(
  sessionId: string,
  hours: number = EMBED_SESSION_TTL_HOURS
): Promise<void> {
  const newExpiry = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const db = await getDb();
  await db
    .updateTable('workspace_sessions')
    .set({
      expires_at: newExpiry,
      last_activity: sql`CURRENT_TIMESTAMP`,
    })
    .where('id', '=', sessionId)
    .execute();
}

// ============================================================================
// Session Queries
// ============================================================================

/**
 * Get sessions for a workspace
 */
export async function getWorkspaceSessions(
  workspaceId: string,
  options: {
    includeExpired?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<WorkspaceSession[]> {
  const { includeExpired = false, limit = 100, offset = 0 } = options;
  const db = await getDb();

  let query = db
    .selectFrom('workspace_sessions')
    .selectAll()
    .where('workspace_id', '=', workspaceId);

  if (!includeExpired) {
    const now = new Date().toISOString();
    query = query.where((eb) =>
      eb.or([
        eb('expires_at', 'is', null),
        eb('expires_at', '>', now),
      ])
    );
  }

  const rows = await query
    .orderBy('last_activity', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return rows.map((row) => rowToSession(row as unknown as WorkspaceSessionRow));
}

/**
 * Get sessions for a user across all workspaces
 */
export async function getUserSessions(userId: number): Promise<WorkspaceSession[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('workspace_sessions')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('last_activity', 'desc')
    .execute();

  return rows.map((row) => rowToSession(row as unknown as WorkspaceSessionRow));
}

/**
 * Get active session for user in a workspace (standalone mode)
 */
export async function getUserWorkspaceSession(
  userId: number,
  workspaceId: string
): Promise<WorkspaceSession | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('workspace_sessions')
    .selectAll()
    .where('user_id', '=', userId)
    .where('workspace_id', '=', workspaceId)
    .orderBy('last_activity', 'desc')
    .limit(1)
    .executeTakeFirst();

  return row ? rowToSession(row as unknown as WorkspaceSessionRow) : null;
}

/**
 * Get or create session for user in a workspace
 */
export async function getOrCreateUserSession(
  userId: number,
  workspaceId: string
): Promise<WorkspaceSession> {
  const existing = await getUserWorkspaceSession(userId, workspaceId);
  if (existing) {
    await updateSessionActivity(existing.id);
    return existing;
  }
  return createSession(workspaceId, { userId });
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clean up expired sessions
 * Returns number of sessions deleted
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const now = new Date().toISOString();
  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_sessions')
    .where('expires_at', 'is not', null)
    .where('expires_at', '<', now)
    .executeTakeFirst();

  return Number(result.numDeletedRows || 0);
}

/**
 * Clean up old inactive sessions (even non-expired ones)
 */
export async function cleanupInactiveSessions(daysInactive: number = 30): Promise<number> {
  const cutoff = new Date(Date.now() - daysInactive * 24 * 60 * 60 * 1000).toISOString();
  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_sessions')
    .where('last_activity', '<', cutoff)
    .executeTakeFirst();

  return Number(result.numDeletedRows || 0);
}

/**
 * Delete a specific session
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_sessions')
    .where('id', '=', sessionId)
    .executeTakeFirst();

  return Number(result.numDeletedRows || 0) > 0;
}

/**
 * Delete all sessions for a workspace
 */
export async function deleteWorkspaceSessions(workspaceId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_sessions')
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();

  return Number(result.numDeletedRows || 0);
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get session count for a workspace
 */
export async function getWorkspaceSessionCount(
  workspaceId: string,
  activeOnly: boolean = true
): Promise<number> {
  const db = await getDb();
  let query = db
    .selectFrom('workspace_sessions')
    .select(db.fn.count<number>('id').as('count'))
    .where('workspace_id', '=', workspaceId);

  if (activeOnly) {
    const now = new Date().toISOString();
    query = query.where((eb) =>
      eb.or([
        eb('expires_at', 'is', null),
        eb('expires_at', '>', now),
      ])
    );
  }

  const result = await query.executeTakeFirst();
  return result?.count || 0;
}

/**
 * Get unique visitor count for a workspace (last N days)
 */
export async function getUniqueVisitorCount(workspaceId: string, days: number = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const db = await getDb();
  const result = await db
    .selectFrom('workspace_sessions')
    .select(sql<number>`COUNT(DISTINCT COALESCE(visitor_id, ip_hash, id))`.as('count'))
    .where('workspace_id', '=', workspaceId)
    .where('started_at', '>=', cutoff)
    .executeTakeFirst();

  return result?.count || 0;
}

/**
 * Get daily session counts for analytics
 */
export async function getDailySessionCounts(
  workspaceId: string,
  days: number = 30
): Promise<Array<{ date: string; count: number }>> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const db = await getDb();
  const rows = await db
    .selectFrom('workspace_sessions')
    .select([
      sql<string>`DATE(started_at)`.as('date'),
      db.fn.count<number>('id').as('count'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('started_at', '>=', cutoff)
    .groupBy(sql`DATE(started_at)`)
    .orderBy('date', 'desc')
    .execute();

  return rows as Array<{ date: string; count: number }>;
}

/**
 * Get comprehensive analytics for a workspace
 */
export async function getWorkspaceAnalytics(workspaceId: string, days: number = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const db = await getDb();

  // Total sessions
  const totalSessionsResult = await db
    .selectFrom('workspace_sessions')
    .select(db.fn.count<number>('id').as('count'))
    .where('workspace_id', '=', workspaceId)
    .where('started_at', '>=', cutoff)
    .executeTakeFirst();
  const totalSessions = totalSessionsResult?.count || 0;

  // Active sessions (not expired)
  const now = new Date().toISOString();
  const activeSessionsResult = await db
    .selectFrom('workspace_sessions')
    .select(db.fn.count<number>('id').as('count'))
    .where('workspace_id', '=', workspaceId)
    .where((eb) =>
      eb.or([
        eb('expires_at', 'is', null),
        eb('expires_at', '>', now),
      ])
    )
    .executeTakeFirst();
  const activeSessions = activeSessionsResult?.count || 0;

  // Unique visitors
  const uniqueVisitors = await getUniqueVisitorCount(workspaceId, days);

  // Total messages
  const totalMessagesResult = await db
    .selectFrom('workspace_messages')
    .select(db.fn.count<number>('id').as('count'))
    .where('workspace_id', '=', workspaceId)
    .where('created_at', '>=', cutoff)
    .executeTakeFirst();
  const totalMessages = totalMessagesResult?.count || 0;

  // Average messages per session
  const avgMessagesPerSession = totalSessions > 0 ? Math.round((totalMessages / totalSessions) * 10) / 10 : 0;

  // Daily data for charts
  const dailySessions = await getDailySessionCounts(workspaceId, days);

  // Daily messages
  const dailyMessages = await db
    .selectFrom('workspace_messages')
    .select([
      sql<string>`DATE(created_at)`.as('date'),
      db.fn.count<number>('id').as('count'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('created_at', '>=', cutoff)
    .groupBy(sql`DATE(created_at)`)
    .orderBy('date', 'desc')
    .execute();

  // Average response time (from messages with latency data)
  const avgResponseTimeResult = await db
    .selectFrom('workspace_messages')
    .select(sql<number>`AVG(latency_ms)`.as('avg_latency'))
    .where('workspace_id', '=', workspaceId)
    .where('role', '=', 'assistant')
    .where('latency_ms', 'is not', null)
    .where('created_at', '>=', cutoff)
    .executeTakeFirst();
  const avgResponseTime = avgResponseTimeResult?.avg_latency || 0;

  return {
    summary: {
      totalSessions,
      activeSessions,
      uniqueVisitors,
      totalMessages,
      avgMessagesPerSession,
      avgResponseTimeMs: Math.round(avgResponseTime),
    },
    dailySessions,
    dailyMessages: dailyMessages as Array<{ date: string; count: number }>,
  };
}

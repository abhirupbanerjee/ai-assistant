/**
 * Thread Sharing - Async Compatibility Layer
 *
 * Provides async wrappers that work with both SQLite and PostgreSQL.
 * - SQLite: Delegates to existing sync functions in sharing.ts
 * - PostgreSQL: Uses Kysely query builder
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDb, transaction } from '../kysely';
import { sql } from 'kysely';
import type { ThreadShare, ShareAccessLog } from '@/types';

// Re-export pure utility functions (no DB access)
export { generateShareToken, validateShareAccess } from '../utils';

// ============ Mappers ============

interface DbThreadShare {
  id: string;
  thread_id: string;
  share_token: string;
  created_by: number;
  allow_download: number;
  expires_at: string | null;
  view_count: number;
  created_at: string;
  last_viewed_at: string | null;
  revoked_at: string | null;
  creator_email?: string;
  creator_name?: string;
}

interface DbShareAccessLog {
  id: number;
  share_id: string;
  accessed_by: number;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  accessed_at: string;
  accessor_email?: string;
}

function mapDbToThreadShare(row: DbThreadShare): ThreadShare {
  const now = new Date();
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  const isExpired = expiresAt ? expiresAt < now : false;
  const isRevoked = !!row.revoked_at;

  return {
    id: row.id,
    threadId: row.thread_id,
    shareToken: row.share_token,
    createdBy: row.created_by,
    createdByEmail: row.creator_email,
    createdByName: row.creator_name,
    allowDownload: row.allow_download === 1,
    expiresAt,
    viewCount: row.view_count,
    createdAt: new Date(row.created_at),
    lastViewedAt: row.last_viewed_at ? new Date(row.last_viewed_at) : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    isActive: !isRevoked && !isExpired,
    isExpired,
  };
}

function mapDbToAccessLog(row: DbShareAccessLog): ShareAccessLog {
  return {
    id: row.id,
    shareId: row.share_id,
    accessedBy: row.accessed_by,
    accessedByEmail: row.accessor_email,
    action: row.action as 'view' | 'download',
    resourceType: row.resource_type || undefined,
    resourceId: row.resource_id || undefined,
    accessedAt: new Date(row.accessed_at),
  };
}

// ============ Share CRUD Operations ============

/**
 * Create a new thread share
 */
export async function createThreadShare(
  threadId: string,
  createdBy: number,
  options: { allowDownload?: boolean; expiresInDays?: number | null } = {}
): Promise<ThreadShare> {
  const id = uuidv4();
  const shareToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = options.expiresInDays
    ? new Date(Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  await transaction(async (trx) => {
    await trx
      .insertInto('thread_shares')
      .values({
        id,
        thread_id: threadId,
        share_token: shareToken,
        created_by: createdBy,
        allow_download: options.allowDownload !== false ? 1 : 0,
        expires_at: expiresAt,
      })
      .execute();
  });

  const share = await getShareById(id);
  return share!;
}

/**
 * Get share by ID
 */
export async function getShareById(shareId: string): Promise<ThreadShare | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('thread_shares as ts')
    .leftJoin('users as u', 'u.id', 'ts.created_by')
    .select([
      'ts.id', 'ts.thread_id', 'ts.share_token', 'ts.created_by',
      'ts.allow_download', 'ts.expires_at', 'ts.view_count',
      'ts.created_at', 'ts.last_viewed_at', 'ts.revoked_at',
      'u.email as creator_email', 'u.name as creator_name',
    ])
    .where('ts.id', '=', shareId)
    .executeTakeFirst();
  return row ? mapDbToThreadShare(row as unknown as DbThreadShare) : undefined;
}

/**
 * Get share by token
 */
export async function getShareByToken(token: string): Promise<ThreadShare | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('thread_shares as ts')
    .leftJoin('users as u', 'u.id', 'ts.created_by')
    .select([
      'ts.id', 'ts.thread_id', 'ts.share_token', 'ts.created_by',
      'ts.allow_download', 'ts.expires_at', 'ts.view_count',
      'ts.created_at', 'ts.last_viewed_at', 'ts.revoked_at',
      'u.email as creator_email', 'u.name as creator_name',
    ])
    .where('ts.share_token', '=', token)
    .executeTakeFirst();
  return row ? mapDbToThreadShare(row as unknown as DbThreadShare) : undefined;
}

/**
 * Get all shares for a thread
 */
export async function getThreadShares(threadId: string): Promise<ThreadShare[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('thread_shares as ts')
    .leftJoin('users as u', 'u.id', 'ts.created_by')
    .select([
      'ts.id', 'ts.thread_id', 'ts.share_token', 'ts.created_by',
      'ts.allow_download', 'ts.expires_at', 'ts.view_count',
      'ts.created_at', 'ts.last_viewed_at', 'ts.revoked_at',
      'u.email as creator_email', 'u.name as creator_name',
    ])
    .where('ts.thread_id', '=', threadId)
    .orderBy('ts.created_at', 'desc')
    .execute();
  return rows.map((r) => mapDbToThreadShare(r as unknown as DbThreadShare));
}

/**
 * Get all shares created by a user
 */
export async function getUserShares(userId: number): Promise<ThreadShare[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('thread_shares as ts')
    .leftJoin('users as u', 'u.id', 'ts.created_by')
    .select([
      'ts.id', 'ts.thread_id', 'ts.share_token', 'ts.created_by',
      'ts.allow_download', 'ts.expires_at', 'ts.view_count',
      'ts.created_at', 'ts.last_viewed_at', 'ts.revoked_at',
      'u.email as creator_email', 'u.name as creator_name',
    ])
    .where('ts.created_by', '=', userId)
    .orderBy('ts.created_at', 'desc')
    .execute();
  return rows.map((r) => mapDbToThreadShare(r as unknown as DbThreadShare));
}

/**
 * Count active shares for a thread
 */
export async function countActiveThreadShares(threadId: string): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  const result = await db
    .selectFrom('thread_shares')
    .select(db.fn.countAll<number>().as('count'))
    .where('thread_id', '=', threadId)
    .where('revoked_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb('expires_at', 'is', null),
        eb('expires_at', '>', now),
      ])
    )
    .executeTakeFirst();
  return Number(result?.count ?? 0);
}

/**
 * Count shares created by user in the last hour (rate limiting)
 */
export async function countUserSharesInLastHour(userId: number): Promise<number> {
  const db = await getDb();
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const result = await db
    .selectFrom('thread_shares')
    .select(db.fn.countAll<number>().as('count'))
    .where('created_by', '=', userId)
    .where('created_at', '>', oneHourAgo)
    .executeTakeFirst();
  return Number(result?.count ?? 0);
}

/**
 * Update share settings
 */
export async function updateShare(
  shareId: string,
  updates: { allowDownload?: boolean; expiresInDays?: number | null }
): Promise<ThreadShare | undefined> {
  const existing = await getShareById(shareId);
  if (!existing) return undefined;

  const setValue: Record<string, unknown> = {};

  if (updates.allowDownload !== undefined) {
    setValue.allow_download = updates.allowDownload ? 1 : 0;
  }
  if (updates.expiresInDays !== undefined) {
    setValue.expires_at = updates.expiresInDays
      ? new Date(Date.now() + updates.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;
  }

  if (Object.keys(setValue).length === 0) return existing;

  const db = await getDb();
  await db
    .updateTable('thread_shares')
    .set(setValue)
    .where('id', '=', shareId)
    .execute();

  return getShareById(shareId);
}

/**
 * Revoke a share (soft delete)
 */
export async function revokeShare(shareId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .updateTable('thread_shares')
    .set({ revoked_at: new Date().toISOString() })
    .where('id', '=', shareId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

/**
 * Delete a share permanently
 */
export async function deleteShare(shareId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('thread_shares')
    .where('id', '=', shareId)
    .executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}

/**
 * Record a view and increment view count
 */
export async function recordShareView(shareId: string): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('thread_shares')
    .set({
      view_count: sql`view_count + 1`,
      last_viewed_at: new Date().toISOString(),
    })
    .where('id', '=', shareId)
    .execute();
}

// ============ Access Log Operations ============

/**
 * Log share access
 */
export async function logShareAccess(
  shareId: string,
  accessedBy: number,
  action: 'view' | 'download',
  resourceType?: string,
  resourceId?: string
): Promise<void> {
  const db = await getDb();
  await db
    .insertInto('share_access_log')
    .values({
      share_id: shareId,
      accessed_by: accessedBy,
      action,
      resource_type: resourceType ?? null,
      resource_id: resourceId ?? null,
    })
    .execute();
}

/**
 * Get access log for a share
 */
export async function getShareAccessLog(shareId: string, limit: number = 100): Promise<ShareAccessLog[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('share_access_log as sal')
    .leftJoin('users as u', 'u.id', 'sal.accessed_by')
    .select([
      'sal.id', 'sal.share_id', 'sal.accessed_by', 'sal.action',
      'sal.resource_type', 'sal.resource_id', 'sal.accessed_at',
      'u.email as accessor_email',
    ])
    .where('sal.share_id', '=', shareId)
    .orderBy('sal.accessed_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map((r) => mapDbToAccessLog(r as unknown as DbShareAccessLog));
}

// ============ Statistics ============

/**
 * Get sharing statistics
 */
export async function getSharingStats(): Promise<{
  totalShares: number;
  activeShares: number;
  totalViews: number;
  sharesThisWeek: number;
}> {
  const db = await getDb();
  const now = new Date().toISOString();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const result = await db
    .selectFrom('thread_shares')
    .select([
      db.fn.countAll<number>().as('total_shares'),
      sql<number>`SUM(CASE WHEN revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ${now}) THEN 1 ELSE 0 END)`.as('active_shares'),
      sql<number>`COALESCE(SUM(view_count), 0)`.as('total_views'),
      sql<number>`SUM(CASE WHEN created_at > ${oneWeekAgo} THEN 1 ELSE 0 END)`.as('shares_this_week'),
    ])
    .executeTakeFirst();

  return {
    totalShares: Number(result?.total_shares ?? 0),
    activeShares: Number(result?.active_shares ?? 0),
    totalViews: Number(result?.total_views ?? 0),
    sharesThisWeek: Number(result?.shares_this_week ?? 0),
  };
}

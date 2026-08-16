import { sql } from 'kysely';
import { getDb } from '../kysely';

export type NotificationType = 'category_memory_suggestion_submitted' | 'category_memory_suggestion_approved' | 'category_memory_suggestion_rejected';

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  resourceType: 'category_memory';
  resourceId: number;
  metadata: unknown;
  readAt: string | null;
  createdAt: string;
}

export async function createNotifications(input: {
  userIds: number[];
  type: NotificationType;
  title: string;
  message: string;
  resourceId: number;
  metadata?: unknown;
}): Promise<void> {
  const userIds = [...new Set(input.userIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (!userIds.length) return;
  const db = await getDb();
  await db.insertInto('notifications').values(userIds.map((userId) => ({
    user_id: userId,
    type: input.type,
    title: input.title,
    message: input.message,
    resource_type: 'category_memory' as const,
    resource_id: input.resourceId,
    metadata: input.metadata ?? {},
    read_at: null,
  }))).execute();
}

export async function listNotifications(userId: number, limit = 30): Promise<{ notifications: AppNotification[]; unreadCount: number }> {
  const db = await getDb();
  const [rows, count] = await Promise.all([
    db.selectFrom('notifications').selectAll().where('user_id', '=', userId)
      .orderBy('created_at', 'desc').limit(Math.min(100, Math.max(1, limit))).execute(),
    db.selectFrom('notifications').select(({ fn }) => fn.countAll<number>().as('count'))
      .where('user_id', '=', userId).where('read_at', 'is', null).executeTakeFirst(),
  ]);
  return {
    notifications: rows.map((row) => ({
      id: Number(row.id), type: row.type, title: row.title, message: row.message,
      resourceType: row.resource_type, resourceId: Number(row.resource_id), metadata: row.metadata,
      readAt: row.read_at, createdAt: row.created_at,
    })),
    unreadCount: Number(count?.count ?? 0),
  };
}

export async function markNotificationRead(userId: number, id?: number): Promise<void> {
  const db = await getDb();
  let query = db.updateTable('notifications').set({ read_at: sql<string>`NOW()` })
    .where('user_id', '=', userId).where('read_at', 'is', null);
  if (id !== undefined) query = query.where('id', '=', id);
  await query.execute();
}

export async function listCategoryMemoryReviewerIds(categoryId: number): Promise<number[]> {
  const db = await getDb();
  const rows = await db.selectFrom('users as u').select('u.id')
    .where((eb) => eb.or([
      eb('u.role', 'in', ['admin', 'super_admin']),
      eb.and([
        eb('u.role', '=', 'superuser'),
        eb.exists(eb.selectFrom('super_user_categories as suc').select('suc.user_id')
          .whereRef('suc.user_id', '=', 'u.id').where('suc.category_id', '=', categoryId)),
      ]),
    ])).execute();
  return rows.map((row) => row.id);
}

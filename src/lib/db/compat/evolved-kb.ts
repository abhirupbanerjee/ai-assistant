/**
 * Self-Evolving Knowledge Base — Database Operations
 *
 * Uses Kysely query builder for PostgreSQL.
 * All evolved KB data access must go through this module.
 * Route handlers and src/lib/evolved-kb/ modules must import from here, never inline raw SQL.
 */

import { getDb } from '../kysely';
import { sql } from 'kysely';
import { v4 as uuidv4 } from 'uuid';

// ============ Types ============

export interface FeedbackRecord {
  id: string;
  query: string;
  answer: string;
  rating: 'positive' | 'negative';
  correction?: string | null;
  modelId?: string | null;
  categorySlugs?: string[] | null;
  workspaceId?: string | null;
  userId: number;
  threadId?: string | null;
  messageId: string;
  createdAt?: string;
  processed?: boolean;
}

export interface UserEvolvedKbSettings {
  userId: number;
  allowLearning: boolean;
  showProvenance: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface EvolvedKbSettings {
  id: string;
  enabled: boolean;
  shadowMode: boolean;
  shadowModeSampleRate: number;
  autoApproveThreshold: number;
  pendingTtlDays: number;
  rejectedTtlDays: number;
  supersededTtlDays: number;
  orphanedTtlDays: number;
  verifierModel?: string | null;
  updatedAt?: string;
}

// ============ User Feedback ============

/**
 * Insert a user feedback record. Returns the new row id.
 */
export async function insertUserFeedback(feedback: Omit<FeedbackRecord, 'id' | 'createdAt' | 'processed'>): Promise<string> {
  const db = await getDb();
  const id = uuidv4();
  await db
    .insertInto('user_feedback' as any)
    .values({
      id,
      query: feedback.query,
      answer: feedback.answer,
      rating: feedback.rating,
      correction: feedback.correction ?? null,
      model_id: feedback.modelId ?? null,
      category_slugs: feedback.categorySlugs ? JSON.stringify(feedback.categorySlugs) : null,
      workspace_id: feedback.workspaceId ?? null,
      user_id: feedback.userId,
      thread_id: feedback.threadId ?? null,
      message_id: feedback.messageId,
    })
    .execute();
  return id;
}

/**
 * Get feedback by user and message ID (for double-submit guard).
 */
export async function getFeedbackByUserAndMessage(userId: number, messageId: string): Promise<FeedbackRecord | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('user_feedback' as any)
    .selectAll()
    .where('user_id', '=', userId)
    .where('message_id', '=', messageId)
    .executeTakeFirst();

  if (!row) return undefined;
  return mapRowToFeedback(row);
}

/**
 * Get all feedback for a thread.
 */
export async function getFeedbackByThread(threadId: string): Promise<FeedbackRecord[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('user_feedback' as any)
    .selectAll()
    .where('thread_id', '=', threadId)
    .orderBy('created_at', 'desc')
    .execute();

  return rows.map(mapRowToFeedback);
}

/**
 * Mark a feedback record as processed.
 */
export async function markFeedbackProcessed(id: string): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('user_feedback' as any)
    .set({ processed: true })
    .where('id', '=', id)
    .execute();
}

// ============ User Evolved KB Settings ============

/**
 * Get evolved KB settings for a user. Returns defaults if no row exists.
 */
export async function getUserEvolvedKbSettings(userId: number): Promise<UserEvolvedKbSettings> {
  const db = await getDb();
  const row = await db
    .selectFrom('user_evolved_kb_settings' as any)
    .selectAll()
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (row) return mapRowToUserSettings(row);

  // Return defaults
  return {
    userId,
    allowLearning: true,
    showProvenance: true,
  };
}

/**
 * Upsert user evolved KB settings.
 */
export async function updateUserEvolvedKbSettings(
  userId: number,
  settings: Partial<Pick<UserEvolvedKbSettings, 'allowLearning' | 'showProvenance'>>
): Promise<UserEvolvedKbSettings> {
  const db = await getDb();

  await db
    .insertInto('user_evolved_kb_settings' as any)
    .values({
      user_id: userId,
      allow_learning: settings.allowLearning ?? true,
      show_provenance: settings.showProvenance ?? true,
      updated_at: new Date(),
    })
    .onConflict((oc: any) => oc.column('user_id').doUpdateSet({
      allow_learning: settings.allowLearning ?? true,
      show_provenance: settings.showProvenance ?? true,
      updated_at: new Date(),
    }))
    .execute();

  return getUserEvolvedKbSettings(userId);
}

// ============ Global Evolved KB Settings ============

/**
 * Get global evolved KB settings. Returns defaults if no row exists.
 */
export async function getEvolvedKbSettings(): Promise<EvolvedKbSettings> {
  const db = await getDb();
  const row = await db
    .selectFrom('evolved_kb_settings' as any)
    .selectAll()
    .where('id', '=', 'default')
    .executeTakeFirst();

  if (row) return mapRowToGlobalSettings(row);

  // Return safe defaults
  return {
    id: 'default',
    enabled: false,
    shadowMode: true,
    shadowModeSampleRate: 0.1,
    autoApproveThreshold: 0.95,
    pendingTtlDays: 30,
    rejectedTtlDays: 30,
    supersededTtlDays: 90,
    orphanedTtlDays: 30,
    verifierModel: null,
  };
}

/**
 * Update global evolved KB settings.
 */
export async function updateEvolvedKbSettings(
  settings: Partial<Omit<EvolvedKbSettings, 'id' | 'updatedAt'>>
): Promise<EvolvedKbSettings> {
  const db = await getDb();

  const updateValues: Record<string, any> = { updated_at: new Date() };
  if (settings.enabled !== undefined) updateValues.enabled = settings.enabled;
  if (settings.shadowMode !== undefined) updateValues.shadow_mode = settings.shadowMode;
  if (settings.shadowModeSampleRate !== undefined) updateValues.shadow_mode_sample_rate = settings.shadowModeSampleRate;
  if (settings.autoApproveThreshold !== undefined) updateValues.auto_approve_threshold = settings.autoApproveThreshold;
  if (settings.pendingTtlDays !== undefined) updateValues.pending_ttl_days = settings.pendingTtlDays;
  if (settings.rejectedTtlDays !== undefined) updateValues.rejected_ttl_days = settings.rejectedTtlDays;
  if (settings.supersededTtlDays !== undefined) updateValues.superseded_ttl_days = settings.supersededTtlDays;
  if (settings.orphanedTtlDays !== undefined) updateValues.orphaned_ttl_days = settings.orphanedTtlDays;
  if (settings.verifierModel !== undefined) updateValues.verifier_model = settings.verifierModel;

  await db
    .updateTable('evolved_kb_settings' as any)
    .set(updateValues)
    .where('id', '=', 'default')
    .execute();

  return getEvolvedKbSettings();
}

// ============ Model Feedback Stats ============

export interface ModelFeedbackStats {
  modelId: string;
  totalRatings: number;
  positiveRatings: number;
  satisfactionRate: number | null;  // null = no data yet
}

/**
 * Get satisfaction statistics per model from user feedback.
 * Default window: last 30 days. Set windowDays=0 for all-time.
 */
export async function getModelFeedbackStats(windowDays = 30): Promise<ModelFeedbackStats[]> {
  const db = await getDb();

  let query = (db
    .selectFrom('user_feedback' as any)
    .select([
      'model_id',
      (db.fn.count('id') as any).as('total'),
      sql<number>`SUM(CASE WHEN rating = 'positive' THEN 1 ELSE 0 END)`.as('positive'),
    ])
    .where('model_id', 'is not', null)) as any;

  // Only apply time window when windowDays > 0
  if (windowDays > 0) {
    const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString();
    query = query.where('created_at', '>', cutoff);
  }

  const rows = await query.groupBy('model_id').execute() as Array<{ model_id: string; total: number; positive: number }>;

  return rows.map(r => ({
    modelId: r.model_id,
    totalRatings: Number(r.total),
    positiveRatings: Number(r.positive),
    satisfactionRate: Number(r.total) > 0 ? Number(r.positive) / Number(r.total) : null,
  }));
}

// ============ Helpers ============

function mapRowToFeedback(row: any): FeedbackRecord {
  return {
    id: row.id,
    query: row.query,
    answer: row.answer,
    rating: row.rating,
    correction: row.correction,
    categorySlugs: row.category_slugs ? (typeof row.category_slugs === 'string' ? JSON.parse(row.category_slugs) : row.category_slugs) : null,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    threadId: row.thread_id,
    messageId: row.message_id,
    createdAt: row.created_at,
    processed: row.processed,
  };
}

function mapRowToUserSettings(row: any): UserEvolvedKbSettings {
  return {
    userId: row.user_id,
    allowLearning: row.allow_learning,
    showProvenance: row.show_provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowToGlobalSettings(row: any): EvolvedKbSettings {
  return {
    id: row.id,
    enabled: row.enabled,
    shadowMode: row.shadow_mode,
    shadowModeSampleRate: row.shadow_mode_sample_rate,
    autoApproveThreshold: row.auto_approve_threshold,
    pendingTtlDays: row.pending_ttl_days,
    rejectedTtlDays: row.rejected_ttl_days,
    supersededTtlDays: row.superseded_ttl_days,
    orphanedTtlDays: row.orphaned_ttl_days,
    verifierModel: row.verifier_model,
    updatedAt: row.updated_at,
  };
}

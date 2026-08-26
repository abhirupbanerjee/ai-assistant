import { sql, type Kysely } from 'kysely';
import { getDb, transaction } from '../kysely';
import type { DB } from '../db-types';
import type { UserRole } from '../users';
import { detectCategoryMemoryAdvisories, type CategoryMemoryAdvisoryFlag } from '../../category-memory-moderation';
import { normalizeCategoryMemoryText } from '../../category-memory-moderation';
import { resolveUserOrganizationIdByUserId } from '../../org-membership';
import { getDefaultOrganizationId } from '../../org-context';

export type CategoryMemoryType = 'fact' | 'terminology' | 'decision' | 'process' | 'faq' | 'caveat';
export type CategoryMemoryStatus = 'draft' | 'suggested' | 'approved' | 'archived' | 'rejected';
export type CategoryMemoryAction = 'created' | 'suggested' | 'edited' | 'approved' | 'rejected' | 'archived' | 'restored' | 'expiry_changed';

export interface CategoryMemoryItem {
  id: number;
  categoryId: number;
  memoryType: CategoryMemoryType;
  title: string;
  normalizedTitle: string;
  content: string;
  status: CategoryMemoryStatus;
  sourceReference: string | null;
  confidence: number;
  validFrom: string | null;
  expiresAt: string | null;
  createdBy: number | null;
  approvedBy: number | null;
  moderationFlags: CategoryMemoryAdvisoryFlag[];
  createdAt: string;
  updatedAt: string;
}

export interface CategoryMemoryEvent {
  id: number;
  categoryMemoryId: number;
  categoryId: number;
  revisionNumber: number;
  action: CategoryMemoryAction;
  actorId: number | null;
  previousValue: unknown | null;
  newValue: unknown | null;
  createdAt: string;
}

export interface CategoryMemoryInput {
  memoryType: CategoryMemoryType;
  title: string;
  content: string;
  sourceReference?: string | null;
  confidence?: number;
  validFrom?: string | null;
  expiresAt?: string | null;
}

export interface CategoryMemoryAccess {
  canRead: boolean;
  canManage: boolean;
  categoryEnabled: boolean;
}

export interface CategoryMemoryLearningMetrics {
  extractionRuns: number;
  candidateCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  approvalRate: number;
  rejectionRate: number;
  duplicateSkips: number;
  redactionCount: number;
  sourceMainChatCount: number;
}

const MEMORY_TYPES = new Set<CategoryMemoryType>(['fact', 'terminology', 'decision', 'process', 'faq', 'caveat']);

export function normalizeCategoryMemoryTitle(title: string): string {
  return title.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function isCategoryMemoryActive(
  item: Pick<CategoryMemoryItem, 'status' | 'validFrom' | 'expiresAt'>,
  now = new Date(),
): boolean {
  const timestamp = now.getTime();
  return item.status === 'approved'
    && (!item.validFrom || Date.parse(item.validFrom) <= timestamp)
    && (!item.expiresAt || Date.parse(item.expiresAt) > timestamp);
}

export function calculateCategoryMemoryPermission(input: {
  role: UserRole;
  hasActiveSubscription: boolean;
  hasSuperuserAssignment: boolean;
}): Pick<CategoryMemoryAccess, 'canRead' | 'canManage'> {
  if (input.role === 'admin' || input.role === 'super_admin') return { canRead: true, canManage: true };
  if (input.role === 'superuser') {
    return {
      canRead: input.hasSuperuserAssignment || input.hasActiveSubscription,
      canManage: input.hasSuperuserAssignment,
    };
  }
  return { canRead: input.hasActiveSubscription, canManage: false };
}

function mapItem(row: {
  id: number; category_id: number; memory_type: CategoryMemoryType; title: string; normalized_title: string;
  content: string; status: CategoryMemoryStatus; source_reference: string | null; confidence: number;
  valid_from: string | null; expires_at: string | null; created_by: number | null; approved_by: number | null;
  moderation_flags: unknown; created_at: string; updated_at: string;
}): CategoryMemoryItem {
  return {
    id: Number(row.id), categoryId: row.category_id, memoryType: row.memory_type, title: row.title,
    normalizedTitle: row.normalized_title, content: row.content, status: row.status,
    sourceReference: row.source_reference, confidence: row.confidence, validFrom: row.valid_from,
    expiresAt: row.expires_at, createdBy: row.created_by, approvedBy: row.approved_by,
    moderationFlags: Array.isArray(row.moderation_flags) ? row.moderation_flags as CategoryMemoryAdvisoryFlag[] : [],
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function validateInput(input: CategoryMemoryInput): void {
  if (!MEMORY_TYPES.has(input.memoryType)) throw new Error('Invalid category memory type');
  if (!input.title.trim() || !normalizeCategoryMemoryTitle(input.title)) throw new Error('Title is required');
  if (!input.content.trim()) throw new Error('Content is required');
  if (input.title.trim().length > 160) throw new Error('Title must be 160 characters or fewer');
  if (input.content.trim().length > 8000) throw new Error('Content must be 8000 characters or fewer');
  if ((input.sourceReference?.trim().length ?? 0) > 1000) throw new Error('Source reference must be 1000 characters or fewer');
  if (input.title.includes('\0') || input.content.includes('\0') || input.sourceReference?.includes('\0')) throw new Error('Memory contains invalid control characters');
  if ((input.confidence ?? 1) < 0 || (input.confidence ?? 1) > 1) throw new Error('Confidence must be between 0 and 1');
  if (input.validFrom && Number.isNaN(Date.parse(input.validFrom))) throw new Error('Invalid valid-from date');
  if (input.expiresAt && Number.isNaN(Date.parse(input.expiresAt))) throw new Error('Invalid expiry date');
  if (input.validFrom && input.expiresAt && Date.parse(input.expiresAt) <= Date.parse(input.validFrom)) {
    throw new Error('Expiry must be after valid-from date');
  }
}

export function validateCategoryMemoryForApproval(input: Pick<CategoryMemoryInput, 'title' | 'content'>): void {
  validateInput({ memoryType: 'fact', title: input.title, content: input.content });
  if (/(ignore|override|disregard)\s+(all\s+)?(previous|prior|system|developer)\s+(instructions?|prompts?)/i.test(input.content)
    || /\b(system|developer)\s*prompt\s*:/i.test(input.content)) {
    throw new Error('Instruction-like content must be removed before approval');
  }
}

async function appendEvent(
  trx: Kysely<DB>,
  item: CategoryMemoryItem,
  action: CategoryMemoryAction,
  actorId: number,
  previousValue: unknown | null,
  newValue: unknown | null,
): Promise<void> {
  const revision = await trx.selectFrom('category_memory_events')
    .select(({ fn }) => fn.max<number>('revision_number').as('revision'))
    .where('category_memory_id', '=', item.id)
    .executeTakeFirst();
  await trx.insertInto('category_memory_events').values({
    category_memory_id: item.id,
    category_id: item.categoryId,
    revision_number: Number(revision?.revision ?? 0) + 1,
    action,
    actor_id: actorId,
    previous_value: previousValue,
    new_value: newValue,
  }).execute();
}

export async function getCategoryMemoryAccess(userId: number, role: UserRole, categoryId: number): Promise<CategoryMemoryAccess> {
  const db = await getDb();
  const [category, subscription, assignment, userOrgId] = await Promise.all([
    db.selectFrom('categories').select(['id', 'memory_enabled', 'organization_id']).where('id', '=', categoryId).executeTakeFirst(),
    db.selectFrom('user_subscriptions').select('category_id')
      .where('user_id', '=', userId).where('category_id', '=', categoryId).where('is_active', '=', 1).executeTakeFirst(),
    role === 'superuser'
      ? db.selectFrom('super_user_categories').select('category_id')
        .where('user_id', '=', userId).where('category_id', '=', categoryId).executeTakeFirst()
      : Promise.resolve(undefined),
    resolveUserOrganizationIdByUserId(userId, db),
  ]);
  if (!category) return { canRead: false, canManage: false, categoryEnabled: false };
  const permission = calculateCategoryMemoryPermission({
    role,
    hasActiveSubscription: Boolean(subscription),
    hasSuperuserAssignment: Boolean(assignment),
  });
  // Organization tenancy guard: non-admin access is restricted to the category's
  // owning organization. Admins/super_admins keep deployment-wide access (parity
  // with calculateCategoryMemoryPermission). Legacy categories without an org and
  // users with no resolvable membership fall back to the DEFAULT organization,
  // preserving single-tenant parity while blocking cross-org access.
  if (role !== 'admin' && role !== 'super_admin' && category.organization_id != null) {
    const defaultOrgId = userOrgId == null ? await getDefaultOrganizationId(db) : null;
    const effectiveOrgId = userOrgId ?? defaultOrgId;
    if (effectiveOrgId !== category.organization_id) {
      permission.canRead = false;
      permission.canManage = false;
    }
  }
  return {
    ...permission,
    categoryEnabled: Boolean(category.memory_enabled),
  };
}

export async function verifyCategoryMemoryExtractionContext(input: {
  userId: number;
  role: UserRole;
  threadId: string;
  categoryId: number;
}): Promise<boolean> {
  const db = await getDb();
  const threadCategory = await db.selectFrom('threads as t')
    .innerJoin('thread_categories as tc', 'tc.thread_id', 't.id')
    .select(['t.id'])
    .where('t.id', '=', input.threadId)
    .where('t.user_id', '=', input.userId)
    .where('tc.category_id', '=', input.categoryId)
    .executeTakeFirst();
  if (!threadCategory) return false;
  const access = await getCategoryMemoryAccess(input.userId, input.role, input.categoryId);
  return access.canRead && access.categoryEnabled;
}

export async function claimCategoryMemoryExtraction(input: {
  categoryId: number;
  userId: number;
  threadId: string;
  sourceMessageId: string;
}): Promise<number | null> {
  const db = await getDb();
  const row = await db.insertInto('category_memory_extraction_events').values({
    category_id: input.categoryId,
    user_id: input.userId,
    thread_id: input.threadId,
    source_message_id: input.sourceMessageId,
    source_surface: 'main-chat',
    outcome: 'pending',
    category_memory_id: null,
    completed_at: null,
  }).onConflict((oc) => oc.column('source_message_id').doNothing()).returning('id').executeTakeFirst();
  return row ? Number(row.id) : null;
}

export async function completeCategoryMemoryExtraction(eventId: number, input: {
  outcome: 'no_candidate' | 'candidate_created' | 'duplicate_skip' | 'access_revoked' | 'error';
  categoryMemoryId?: number;
  candidateCount?: number;
  duplicateSkips?: number;
  redactionCount?: number;
}): Promise<void> {
  const db = await getDb();
  await db.updateTable('category_memory_extraction_events').set({
    outcome: input.outcome,
    category_memory_id: input.categoryMemoryId ?? null,
    candidate_count: input.candidateCount ?? 0,
    duplicate_skips: input.duplicateSkips ?? 0,
    redaction_count: input.redactionCount ?? 0,
    completed_at: sql<string>`NOW()`,
  }).where('id', '=', eventId).where('outcome', '=', 'pending').execute();
}

export async function getCategoryMemoryLearningMetrics(categoryIds: number[]): Promise<CategoryMemoryLearningMetrics> {
  const empty: CategoryMemoryLearningMetrics = {
    extractionRuns: 0, candidateCount: 0, pendingCount: 0, approvedCount: 0, rejectedCount: 0,
    approvalRate: 0, rejectionRate: 0, duplicateSkips: 0, redactionCount: 0, sourceMainChatCount: 0,
  };
  if (!categoryIds.length) return empty;
  const db = await getDb();
  const rows = await db.selectFrom('category_memory_extraction_events as e')
    .leftJoin('category_memories as m', 'm.id', 'e.category_memory_id')
    .select(['e.outcome', 'e.candidate_count', 'e.duplicate_skips', 'e.redaction_count', 'e.source_surface', 'm.status'])
    .where('e.category_id', 'in', categoryIds)
    .execute();
  const metrics = rows.reduce((result, row) => {
    if (row.outcome !== 'pending') result.extractionRuns += 1;
    result.candidateCount += row.candidate_count;
    result.duplicateSkips += row.duplicate_skips;
    result.redactionCount += row.redaction_count;
    if (row.source_surface === 'main-chat') result.sourceMainChatCount += row.candidate_count;
    if (row.status === 'approved') result.approvedCount += 1;
    else if (row.status === 'rejected') result.rejectedCount += 1;
    else if (row.status === 'suggested') result.pendingCount += 1;
    return result;
  }, { ...empty });
  metrics.approvalRate = metrics.candidateCount ? metrics.approvedCount / metrics.candidateCount : 0;
  metrics.rejectionRate = metrics.candidateCount ? metrics.rejectedCount / metrics.candidateCount : 0;
  return metrics;
}

export async function listEffectiveCategoryMemoryCategories(userId: number, role: UserRole) {
  const db = await getDb();
  let query = db.selectFrom('categories as c')
    .select(['c.id', 'c.name', 'c.slug', 'c.description', 'c.memory_enabled'])
    .orderBy('c.name');
  if (role === 'user') {
    query = query.innerJoin('user_subscriptions as us', 'us.category_id', 'c.id')
      .where('us.user_id', '=', userId).where('us.is_active', '=', 1);
  } else if (role === 'superuser') {
    query = query.where((eb) => eb.or([
      eb.exists(eb.selectFrom('super_user_categories as suc').select('suc.category_id')
        .whereRef('suc.category_id', '=', 'c.id').where('suc.user_id', '=', userId)),
      eb.exists(eb.selectFrom('user_subscriptions as us').select('us.category_id')
        .whereRef('us.category_id', '=', 'c.id').where('us.user_id', '=', userId).where('us.is_active', '=', 1)),
    ]));
  }
  const rows = await query.distinct().execute();
  return Promise.all(rows.map(async (row) => ({
    id: row.id, name: row.name, slug: row.slug, description: row.description,
    memoryEnabled: Boolean(row.memory_enabled),
    ...(await getCategoryMemoryAccess(userId, role, row.id)),
  })));
}

export async function setCategoryMemoryEnabled(categoryId: number, enabled: boolean): Promise<void> {
  const db = await getDb();
  await db.updateTable('categories').set({ memory_enabled: enabled }).where('id', '=', categoryId).execute();
}

export async function listCategoryMemories(categoryId: number, includeNonApproved: boolean): Promise<CategoryMemoryItem[]> {
  const db = await getDb();
  let query = db.selectFrom('category_memories').selectAll().where('category_id', '=', categoryId);
  if (!includeNonApproved) {
    query = query.where('status', '=', 'approved')
      .where((eb) => eb.or([eb('valid_from', 'is', null), eb('valid_from', '<=', sql<string>`NOW()`)]))
      .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', sql<string>`NOW()`)]));
  }
  return (await query.orderBy('updated_at', 'desc').execute()).map((row) => mapItem(row as Parameters<typeof mapItem>[0]));
}

export async function getCategoryMemoryById(categoryId: number, id: number): Promise<CategoryMemoryItem | undefined> {
  const db = await getDb();
  const row = await db.selectFrom('category_memories').selectAll()
    .where('category_id', '=', categoryId).where('id', '=', id).executeTakeFirst();
  return row ? mapItem(row as Parameters<typeof mapItem>[0]) : undefined;
}

export async function createCategoryMemory(categoryId: number, actorId: number, input: CategoryMemoryInput): Promise<CategoryMemoryItem> {
  validateInput(input);
  return transaction(async (trx) => {
    const settingsRow = await trx.selectFrom('settings').select('value').where('key', '=', 'memory-settings').executeTakeFirst();
    let maxActiveItems = 100;
    if (settingsRow) {
      try { maxActiveItems = Number((JSON.parse(settingsRow.value) as { categoryMemoryMaxActiveItems?: number }).categoryMemoryMaxActiveItems ?? 100); } catch { /* use safe default */ }
    }
    const activeCount = await trx.selectFrom('category_memories').select(({ fn }) => fn.countAll<number>().as('count'))
      .where('category_id', '=', categoryId).where('status', 'in', ['draft', 'approved']).executeTakeFirst();
    if (Number(activeCount?.count ?? 0) >= Math.max(1, maxActiveItems)) throw new Error('Category memory item limit reached');
    const row = await trx.insertInto('category_memories').values({
      category_id: categoryId, memory_type: input.memoryType, title: input.title.trim(),
      normalized_title: normalizeCategoryMemoryTitle(input.title), content: input.content.trim(), status: 'draft',
      source_reference: input.sourceReference?.trim() || null, confidence: input.confidence ?? 1,
      valid_from: input.validFrom ?? null, expires_at: input.expiresAt ?? null, created_by: actorId,
    }).returningAll().executeTakeFirstOrThrow();
    const item = mapItem(row as Parameters<typeof mapItem>[0]);
    await appendEvent(trx, item, 'created', actorId, null, item);
    return item;
  });
}

export async function createCategoryMemorySuggestion(categoryId: number, actorId: number, input: CategoryMemoryInput): Promise<CategoryMemoryItem> {
  validateInput(input);
  return transaction(async (trx) => {
    const settingsRow = await trx.selectFrom('settings').select('value').where('key', '=', 'memory-settings').executeTakeFirst();
    let suggestionsEnabled = true;
    if (settingsRow) {
      try { suggestionsEnabled = (JSON.parse(settingsRow.value) as { suggestionsEnabled?: boolean }).suggestionsEnabled ?? true; } catch { suggestionsEnabled = false; }
    }
    if (!suggestionsEnabled) throw new Error('Category memory suggestions are disabled');
    const candidates = await trx.selectFrom('category_memories').select(['id', 'title', 'content', 'status'])
      .where('category_id', '=', categoryId).where('status', 'in', ['suggested', 'draft', 'approved']).execute();
    if (candidates.some((candidate) => normalizeCategoryMemoryText(candidate.content) === normalizeCategoryMemoryText(input.content))) {
      throw new Error('An item with the same normalized content already exists in the category');
    }
    const flags = detectCategoryMemoryAdvisories(input, candidates.map((row) => ({ ...row, id: Number(row.id) })));
    const row = await trx.insertInto('category_memories').values({
      category_id: categoryId, memory_type: input.memoryType, title: input.title.trim(),
      normalized_title: normalizeCategoryMemoryTitle(input.title), content: input.content.trim(), status: 'suggested',
      source_reference: input.sourceReference?.trim() || null, confidence: input.confidence ?? 1,
      valid_from: input.validFrom ?? null, expires_at: input.expiresAt ?? null, created_by: actorId,
      moderation_flags: flags,
    }).returningAll().executeTakeFirstOrThrow();
    const item = mapItem(row as Parameters<typeof mapItem>[0]);
    await appendEvent(trx, item, 'suggested', actorId, null, item);
    return item;
  });
}

export async function listUserCategoryMemorySuggestions(categoryId: number, userId: number): Promise<CategoryMemoryItem[]> {
  const db = await getDb();
  const rows = await db.selectFrom('category_memories').selectAll()
    .where('category_id', '=', categoryId).where('created_by', '=', userId)
    .where('status', 'in', ['suggested', 'rejected', 'archived'])
    .orderBy('created_at', 'desc').execute();
  return rows.map((row) => mapItem(row as Parameters<typeof mapItem>[0]));
}

export async function listCategoryMemoryReviewQueue(categoryIds: number[]): Promise<CategoryMemoryItem[]> {
  if (!categoryIds.length) return [];
  const db = await getDb();
  const rows = await db.selectFrom('category_memories').selectAll()
    .where('category_id', 'in', categoryIds).where('status', '=', 'suggested')
    .orderBy('created_at', 'asc').execute();
  return rows.map((row) => mapItem(row as Parameters<typeof mapItem>[0]));
}

export async function updateCategoryMemory(categoryId: number, id: number, actorId: number, input: CategoryMemoryInput): Promise<CategoryMemoryItem> {
  validateInput(input);
  return transaction(async (trx) => {
    const previousRow = await trx.selectFrom('category_memories').selectAll()
      .where('category_id', '=', categoryId).where('id', '=', id).executeTakeFirstOrThrow();
    const previous = mapItem(previousRow as Parameters<typeof mapItem>[0]);
    if (previous.status === 'rejected') throw new Error('Rejected memory cannot be edited');
    const row = await trx.updateTable('category_memories').set({
      memory_type: input.memoryType, title: input.title.trim(), normalized_title: normalizeCategoryMemoryTitle(input.title),
      content: input.content.trim(), source_reference: input.sourceReference?.trim() || null,
      confidence: input.confidence ?? 1, valid_from: input.validFrom ?? null, expires_at: input.expiresAt ?? null,
      updated_at: sql<string>`NOW()`,
    }).where('category_id', '=', categoryId).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    const item = mapItem(row as Parameters<typeof mapItem>[0]);
    const action: CategoryMemoryAction = previous.expiresAt !== item.expiresAt ? 'expiry_changed' : 'edited';
    await appendEvent(trx, item, action, actorId, previous, item);
    return item;
  });
}

export async function transitionCategoryMemory(
  categoryId: number,
  id: number,
  actorId: number,
  action: 'approve' | 'reject' | 'archive' | 'restore',
): Promise<CategoryMemoryItem> {
  const transitions: Record<typeof action, { from: CategoryMemoryStatus[]; to: CategoryMemoryStatus; event: CategoryMemoryAction }> = {
    approve: { from: ['draft', 'suggested'], to: 'approved', event: 'approved' },
    reject: { from: ['draft', 'suggested'], to: 'rejected', event: 'rejected' },
    archive: { from: ['draft', 'suggested', 'approved', 'rejected'], to: 'archived', event: 'archived' },
    restore: { from: ['archived'], to: 'draft', event: 'restored' },
  };
  return transaction(async (trx) => {
    const row = await trx.selectFrom('category_memories').selectAll()
      .where('category_id', '=', categoryId).where('id', '=', id).executeTakeFirstOrThrow();
    const previous = mapItem(row as Parameters<typeof mapItem>[0]);
    const transition = transitions[action];
    if (!transition.from.includes(previous.status)) throw new Error(`Cannot ${action} memory in ${previous.status} status`);
    if (action === 'approve') validateCategoryMemoryForApproval(previous);
    const updatedRow = await trx.updateTable('category_memories').set({
      status: transition.to,
      approved_by: action === 'approve' ? actorId : (action === 'restore' ? null : previous.approvedBy),
      updated_at: sql<string>`NOW()`,
    }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    const item = mapItem(updatedRow as Parameters<typeof mapItem>[0]);
    await appendEvent(trx, item, transition.event, actorId, previous, item);
    return item;
  });
}

export async function deleteCategoryMemory(categoryId: number, id: number): Promise<boolean> {
  const db = await getDb();
  const result = await db.deleteFrom('category_memories').where('category_id', '=', categoryId).where('id', '=', id).executeTakeFirst();
  return (result.numDeletedRows ?? BigInt(0)) > BigInt(0);
}

/** Delete every memory item for a category. Related events are removed by FK cascade. */
export async function clearCategoryMemories(categoryId: number): Promise<number[]> {
  const db = await getDb();
  const rows = await db.deleteFrom('category_memories')
    .where('category_id', '=', categoryId)
    .returning('id')
    .execute();
  return rows.map((row) => Number(row.id));
}

export async function listCategoryMemoryEvents(categoryId: number, id: number): Promise<CategoryMemoryEvent[]> {
  const db = await getDb();
  const rows = await db.selectFrom('category_memory_events').selectAll()
    .where('category_id', '=', categoryId).where('category_memory_id', '=', id)
    .orderBy('revision_number', 'desc').execute();
  return rows.map((row) => ({
    id: Number(row.id), categoryMemoryId: Number(row.category_memory_id), categoryId: row.category_id,
    revisionNumber: row.revision_number, action: row.action, actorId: row.actor_id,
    previousValue: row.previous_value, newValue: row.new_value, createdAt: row.created_at,
  }));
}

export async function listExpiredApprovedCategoryMemories(categoryId: number): Promise<CategoryMemoryItem[]> {
  const db = await getDb();
  const rows = await db.selectFrom('category_memories').selectAll()
    .where('category_id', '=', categoryId).where('status', '=', 'approved')
    .where('expires_at', 'is not', null).where('expires_at', '<=', sql<string>`NOW()`).execute();
  return rows.map((row) => mapItem(row as Parameters<typeof mapItem>[0]));
}

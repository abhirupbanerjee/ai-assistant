/**
 * Direct Thread Sharing — recipient-owned, fully independent copy.
 *
 * A share copies the source thread (messages, attachments, generated artifacts,
 * and the latest summary) into a brand-new thread owned by the recipient. There
 * is no runtime link back to the source: no synchronization, no revocation, no
 * lineage FK. The `thread_user_shares` row is an immutable audit record only.
 *
 * The copy is created synchronously only after the recipient is proven eligible.
 */

import { getDb, transaction } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { readFileBuffer, writeFileBuffer, getThreadUploadsDir } from '../../storage';
import { getOutputDirectory } from '../../docgen/branding';
import { countTokens } from '../../summarization';
import type { DbUser } from '../users';
import { remapPayloadReferences as remapText } from './payload-remap';

// ============ Types ============

export type ShareabilityErrorCode =
  | 'THREAD_NOT_ORG_SCOPED'
  | 'THREAD_NOT_CATEGORIZED'
  | 'THREAD_CATEGORY_ORG_MISMATCH'
  | 'RECIPIENT_NOT_ELIGIBLE';

export interface ShareabilityFailure {
  ok: false;
  code: ShareabilityErrorCode;
  message: string;
}

export interface ShareabilitySuccess {
  ok: true;
  sourceThreadId: string;
  organizationId: number;
  categoryIds: number[];
  recipient: DbUser;
  /** Validated model for the copied thread, or null to inherit the default. */
  selectedModel: string | null;
}

export type DirectShareEligibilityResult = ShareabilityFailure | ShareabilitySuccess;

export interface DirectShareRecord {
  id: string;
  sourceThreadId: string;
  recipientThreadId: string;
  sharedByUserId: number;
  sharedWithUserId: number;
  organizationId: number | null;
  categoryIdsSnapshot: unknown;
  createdAt: string;
  sharedByEmail?: string | null;
  sharedByName?: string | null;
  sharedWithEmail?: string | null;
  sharedWithName?: string | null;
}

export interface CreateDirectShareCopyInput {
  sourceThreadId: string;
  sharedByUserId: number;
  sharedByName: string;
  recipientUserId: number;
  recipientEmail: string;
  organizationId: number;
  categoryIds: number[];
  selectedModel: string | null;
}

const SHAREABILITY_MESSAGES: Record<ShareabilityErrorCode, string> = {
  THREAD_NOT_ORG_SCOPED: 'This thread is not assigned to an organization and cannot be shared.',
  THREAD_NOT_CATEGORIZED: 'This thread has no category assigned and cannot be shared.',
  THREAD_CATEGORY_ORG_MISMATCH:
    "This thread's categories are not mapped to its organization, so it cannot be shared.",
  RECIPIENT_NOT_ELIGIBLE: 'This recipient is not eligible to receive this thread.',
};

// ============ Eligibility primitives ============

export async function getThreadOrganizationId(threadId: string): Promise<number | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('threads')
    .select('organization_id')
    .where('id', '=', threadId)
    .executeTakeFirst();
  return row?.organization_id ?? null;
}

export async function getThreadCategoriesWithOrg(
  threadId: string
): Promise<{ id: number; organization_id: number | null }[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('thread_categories as tc')
    .innerJoin('categories as c', 'c.id', 'tc.category_id')
    .select(['tc.category_id as id', 'c.organization_id'])
    .where('tc.thread_id', '=', threadId)
    .execute();
  return rows.map((r) => ({ id: r.id, organization_id: r.organization_id as number | null }));
}

export async function getUserActiveOrganizationIds(userId: number): Promise<number[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('organization_memberships')
    .select('organization_id')
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .execute();
  return rows.map((r) => r.organization_id);
}

export async function userHasCategoryAccess(
  userId: number,
  role: string,
  categoryIds: number[]
): Promise<boolean> {
  if (categoryIds.length === 0) return false;

  // Admins/super-admins are category-authorized once their active org membership
  // is verified (done separately by the eligibility check).
  if (role === 'admin' || role === 'super_admin') return true;

  const db = await getDb();
  for (const categoryId of categoryIds) {
    const subscription = await db
      .selectFrom('user_subscriptions')
      .select('user_id')
      .where('user_id', '=', userId)
      .where('category_id', '=', categoryId)
      .where('is_active', '=', 1)
      .executeTakeFirst();

    if (!subscription) {
      const assignment = await db
        .selectFrom('super_user_categories')
        .select('user_id')
        .where('user_id', '=', userId)
        .where('category_id', '=', categoryId)
        .executeTakeFirst();
      if (!assignment) return false;
    }
  }
  return true;
}

export async function isModelEntitledForOrg(
  modelId: string,
  organizationId: number
): Promise<boolean> {
  if (!modelId) return true;
  const db = await getDb();

  // Catalog path: active catalog entry with an enabled org-specific or global deployment.
  const catalogRow = await db
    .selectFrom('model_catalog as mc')
    .innerJoin('organization_deployment as od', 'od.catalog_id', 'mc.id')
    .select('od.org_id')
    .where('mc.id', '=', modelId)
    .where('mc.capability_id', '=', 'llm')
    .where('mc.status', '=', 'active')
    .where('od.enabled', '=', true)
    .where((eb) => eb.or([eb('od.org_id', 'is', organizationId), eb('od.org_id', 'is', null)]))
    .executeTakeFirst();

  if (catalogRow) return true;

  // Legacy fallback: any enabled model when the catalog path is not authoritative.
  const legacyRow = await db
    .selectFrom('enabled_models')
    .select('id')
    .where('id', '=', modelId)
    .where('enabled', '=', 1)
    .executeTakeFirst();

  return !!legacyRow;
}

// ============ Eligibility evaluation ============

export async function evaluateDirectThreadShareEligibility(params: {
  sourceThreadId: string;
  sharedByUserId: number;
  recipientEmail: string;
}): Promise<DirectShareEligibilityResult> {
  const { sourceThreadId, sharedByUserId, recipientEmail } = params;

  const { getUserByEmail } = await import('./users');

  // 1. Shareability pre-check on the source thread (owner-facing, specific).
  const organizationId = await getThreadOrganizationId(sourceThreadId);
  if (organizationId === null) {
    return failure('THREAD_NOT_ORG_SCOPED');
  }

  const categories = await getThreadCategoriesWithOrg(sourceThreadId);
  if (categories.length === 0) {
    return failure('THREAD_NOT_CATEGORIZED');
  }

  for (const category of categories) {
    if (category.organization_id === null || category.organization_id !== organizationId) {
      return failure('THREAD_CATEGORY_ORG_MISMATCH');
    }
  }

  const categoryIds = categories.map((c) => c.id);

  // 2. Resolve recipient (generic failure — no disclosure of recipient details).
  const recipient = await getUserByEmail(recipientEmail);
  if (!recipient) {
    return failure('RECIPIENT_NOT_ELIGIBLE');
  }

  // 3. Active organization membership intersection.
  const [ownerOrgs, recipientOrgs] = await Promise.all([
    getUserActiveOrganizationIds(sharedByUserId),
    getUserActiveOrganizationIds(recipient.id),
  ]);
  if (!ownerOrgs.includes(organizationId) || !recipientOrgs.includes(organizationId)) {
    return failure('RECIPIENT_NOT_ELIGIBLE');
  }

  // 4. Recipient category access for every source category.
  if (!(await userHasCategoryAccess(recipient.id, recipient.role, categoryIds))) {
    return failure('RECIPIENT_NOT_ELIGIBLE');
  }

  // 5. Validate the source model against the recipient org; fall back to default.
  const db = await getDb();
  const sourceThread = await db
    .selectFrom('threads')
    .select('selected_model')
    .where('id', '=', sourceThreadId)
    .executeTakeFirst();
  const sourceModel = sourceThread?.selected_model ?? null;
  const selectedModel =
    sourceModel && (await isModelEntitledForOrg(sourceModel, organizationId))
      ? sourceModel
      : null;

  return {
    ok: true,
    sourceThreadId,
    organizationId,
    categoryIds,
    recipient,
    selectedModel,
  };
}

function failure(code: ShareabilityErrorCode): ShareabilityFailure {
  return { ok: false, code, message: SHAREABILITY_MESSAGES[code] };
}

// ============ Copy service ============

export async function createDirectShareCopy(
  input: CreateDirectShareCopyInput
): Promise<{ recipientThreadId: string; shareId: string }> {
  const {
    sourceThreadId,
    sharedByUserId,
    sharedByName,
    recipientUserId,
    recipientEmail,
    organizationId,
    categoryIds,
    selectedModel,
  } = input;

  const db = await getDb();
  const recipientThreadId = uuidv4();
  const shareId = uuidv4();

  // Load source data (messages, uploads, outputs, latest summary).
  const [sourceMessages, sourceUploads, sourceOutputs, latestSummary] = await Promise.all([
    db.selectFrom('messages').selectAll().where('thread_id', '=', sourceThreadId).execute(),
    db.selectFrom('thread_uploads').selectAll().where('thread_id', '=', sourceThreadId).execute(),
    db.selectFrom('thread_outputs').selectAll().where('thread_id', '=', sourceThreadId).execute(),
    db
      .selectFrom('thread_summaries')
      .selectAll()
      .where('thread_id', '=', sourceThreadId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst(),
  ]);

  // Build the old→new message id map first so payload references can be remapped.
  const messageIdMap = new Map<string, string>();
  for (const msg of sourceMessages) {
    messageIdMap.set(msg.id, uuidv4());
  }

  // Pre-copy artifact files (outside the DB transaction). Track copies for
  // compensating cleanup if the DB transaction later fails.
  const copiedFilePaths: string[] = [];

  const newUploads = new Array<{
    filename: string;
    filepath: string;
    file_size: number;
  }>();
  for (const upload of sourceUploads) {
    try {
      const bytes = await readFileBuffer(upload.filepath);
      const destDir = getThreadUploadsDir(recipientEmail, recipientThreadId);
      const destPath = path.join(destDir, path.basename(upload.filepath));
      await writeFileBuffer(destPath, bytes);
      copiedFilePaths.push(destPath);
      newUploads.push({
        filename: upload.filename,
        filepath: destPath,
        file_size: upload.file_size,
      });
    } catch (err) {
      console.warn(`[DirectShare] Skipping upload ${upload.filename}: missing source file`, err);
    }
  }

  type OutputFileType = 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'md' | 'mp3' | 'wav' | 'html' | 'zip';
  const newOutputs = new Array<{
    message_id: string | null;
    filename: string;
    filepath: string;
    file_type: OutputFileType;
    file_size: number;
    generation_config: string | null;
    expires_at: string | null;
  }>();
  for (const output of sourceOutputs) {
    try {
      const bytes = await readFileBuffer(output.filepath);
      const destPath = path.join(
        getOutputDirectory(),
        `${recipientThreadId}-${path.basename(output.filepath)}`
      );
      await writeFileBuffer(destPath, bytes);
      copiedFilePaths.push(destPath);
      newOutputs.push({
        message_id: output.message_id ? (messageIdMap.get(output.message_id) ?? null) : null,
        filename: output.filename,
        filepath: destPath,
        file_type: output.file_type as OutputFileType,
        file_size: output.file_size,
        generation_config: output.generation_config ?? null,
        expires_at: output.expires_at ?? null,
      });
    } catch (err) {
      console.warn(`[DirectShare] Skipping output ${output.filename}: missing source file`, err);
    }
  }

  try {
    await transaction(async (trx) => {
      // Create the recipient thread with display provenance + org scope.
      const tokenTotal = sourceMessages.reduce((sum, m) => sum + countTokens(m.content), 0);

      await trx
        .insertInto('threads')
        .values({
          id: recipientThreadId,
          user_id: recipientUserId,
          title: `(Shared by ${sharedByName})`,
          selected_model: selectedModel,
          organization_id: organizationId,
          thread_kind: 'shared_copy',
          shared_by_user_id: sharedByUserId,
          shared_at: new Date().toISOString(),
          is_summarized: latestSummary ? 1 : 0,
          total_tokens: tokenTotal,
        })
        .execute();

      if (categoryIds.length > 0) {
        await trx
          .insertInto('thread_categories')
          .values(categoryIds.map((cid) => ({ thread_id: recipientThreadId, category_id: cid })))
          .execute();
      }

      // Copy messages verbatim with fresh ids and remapped payload references.
      for (const msg of sourceMessages) {
        const newId = messageIdMap.get(msg.id)!;
        await trx
          .insertInto('messages')
          .values({
            id: newId,
            thread_id: recipientThreadId,
            role: msg.role,
            content: msg.content,
            sources_json: remapText(msg.sources_json, sourceThreadId, recipientThreadId, messageIdMap),
            attachments_json: remapText(msg.attachments_json, sourceThreadId, recipientThreadId, messageIdMap),
            tool_calls_json: remapText(msg.tool_calls_json, sourceThreadId, recipientThreadId, messageIdMap),
            tool_call_id: msg.tool_call_id,
            tool_name: msg.tool_name,
            created_at: msg.created_at,
            token_count: msg.token_count,
            generated_documents_json: remapText(msg.generated_documents_json, sourceThreadId, recipientThreadId, messageIdMap),
            visualizations_json: remapText(msg.visualizations_json, sourceThreadId, recipientThreadId, messageIdMap),
            generated_images_json: remapText(msg.generated_images_json, sourceThreadId, recipientThreadId, messageIdMap),
            generated_diagrams_json: remapText(msg.generated_diagrams_json, sourceThreadId, recipientThreadId, messageIdMap),
            generated_podcasts_json: remapText(msg.generated_podcasts_json, sourceThreadId, recipientThreadId, messageIdMap),
            mode: msg.mode,
            plan_id: msg.plan_id,
            metadata_json: remapText(msg.metadata_json, sourceThreadId, recipientThreadId, messageIdMap),
          })
          .execute();
      }

      // Insert copied uploads.
      if (newUploads.length > 0) {
        await trx
          .insertInto('thread_uploads')
          .values(newUploads.map((u) => ({ thread_id: recipientThreadId, ...u })))
          .execute();
      }

      // Insert copied outputs with re-pointed message ids.
      if (newOutputs.length > 0) {
        await trx
          .insertInto('thread_outputs')
          .values(newOutputs.map((o) => ({ thread_id: recipientThreadId, ...o })))
          .execute();
      }

      // Copy the latest summary, if any.
      if (latestSummary) {
        await trx
          .insertInto('thread_summaries')
          .values({
            thread_id: recipientThreadId,
            summary: latestSummary.summary,
            messages_summarized: latestSummary.messages_summarized,
            tokens_before: latestSummary.tokens_before,
            tokens_after: latestSummary.tokens_after,
          })
          .execute();
      }

      // Immutable audit row (informational only; never consulted for runtime access).
      await trx
        .insertInto('thread_user_shares')
        .values({
          id: shareId,
          source_thread_id: sourceThreadId,
          recipient_thread_id: recipientThreadId,
          shared_by_user_id: sharedByUserId,
          shared_with_user_id: recipientUserId,
          organization_id: organizationId,
          category_ids_snapshot: categoryIds,
        })
        .execute();
    });
  } catch (err) {
    // Compensating cleanup: remove files copied for the failed share.
    await cleanupCopiedFiles(copiedFilePaths);
    throw err;
  }

  return { recipientThreadId, shareId };
}

async function cleanupCopiedFiles(paths: string[]): Promise<void> {
  const { deleteFile } = await import('../../storage');
  for (const p of paths) {
    try {
      await deleteFile(p);
    } catch {
      // Best-effort cleanup.
    }
  }
}

// ============ Audit queries ============

export async function getDirectSharesForThread(sourceThreadId: string): Promise<DirectShareRecord[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('thread_user_shares as tus')
    .leftJoin('users as u', 'u.id', 'tus.shared_by_user_id')
    .leftJoin('users as ur', 'ur.id', 'tus.shared_with_user_id')
    .select([
      'tus.id',
      'tus.source_thread_id',
      'tus.recipient_thread_id',
      'tus.shared_by_user_id',
      'tus.shared_with_user_id',
      'tus.organization_id',
      'tus.category_ids_snapshot',
      'tus.created_at',
      'u.email as shared_by_email',
      'u.name as shared_by_name',
      'ur.email as shared_with_email',
      'ur.name as shared_with_name',
    ])
    .where('tus.source_thread_id', '=', sourceThreadId)
    .orderBy('tus.created_at', 'desc')
    .execute();

  return rows.map((r) => ({
    id: r.id,
    sourceThreadId: r.source_thread_id,
    recipientThreadId: r.recipient_thread_id,
    sharedByUserId: r.shared_by_user_id,
    sharedWithUserId: r.shared_with_user_id,
    organizationId: r.organization_id,
    categoryIdsSnapshot: r.category_ids_snapshot,
    createdAt: r.created_at,
    sharedByEmail: r.shared_by_email,
    sharedByName: r.shared_by_name,
    sharedWithEmail: r.shared_with_email,
    sharedWithName: r.shared_with_name,
  }));
}

export async function getDirectSharesForRecipient(userId: number): Promise<DirectShareRecord[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('thread_user_shares as tus')
    .leftJoin('users as u', 'u.id', 'tus.shared_by_user_id')
    .select([
      'tus.id',
      'tus.source_thread_id',
      'tus.recipient_thread_id',
      'tus.shared_by_user_id',
      'tus.shared_with_user_id',
      'tus.organization_id',
      'tus.category_ids_snapshot',
      'tus.created_at',
      'u.email as shared_by_email',
      'u.name as shared_by_name',
    ])
    .where('tus.shared_with_user_id', '=', userId)
    .orderBy('tus.created_at', 'desc')
    .execute();

  return rows.map((r) => ({
    id: r.id,
    sourceThreadId: r.source_thread_id,
    recipientThreadId: r.recipient_thread_id,
    sharedByUserId: r.shared_by_user_id,
    sharedWithUserId: r.shared_with_user_id,
    organizationId: r.organization_id,
    categoryIdsSnapshot: r.category_ids_snapshot,
    createdAt: r.created_at,
    sharedByEmail: r.shared_by_email,
    sharedByName: r.shared_by_name,
  }));
}

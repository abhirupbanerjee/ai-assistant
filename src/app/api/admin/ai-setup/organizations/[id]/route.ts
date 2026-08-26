/**
 * PATCH  /api/admin/ai-setup/organizations/[id] — update an organization's name,
 *        credential mode, or archive/unarchive it.
 * DELETE /api/admin/ai-setup/organizations/[id] — delete an organization (except
 *        the DEFAULT organization) together with its categories, documents, and
 *        keys. The organization is resolved server-side, never from the frontend.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/kysely';
import {
  requireAiSetupActor,
  isResponse,
  loadOrgWithAccess,
  jsonError,
} from '../../_service';
import { CREDENTIAL_MODES } from '@/lib/org-admin';
import {
  deleteCategoryWithRelatedData,
  getDocumentIdsForCategory,
  getDocumentCategoriesForDocs,
} from '@/lib/db/compat';
import { deleteDocument } from '@/lib/ingest';
import { getVectorStore, resolveActiveCollectionNames } from '@/lib/vector-store';
import { invalidateCategoryCache } from '@/lib/redis';
import { CATEGORY_MEMORY_COLLECTION } from '@/lib/category-memory';

async function parseOrgId(params: Promise<{ id: string }>): Promise<number> {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NaN;
  return parseInt(id, 10);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const orgId = await parseOrgId(params);
    if (Number.isNaN(orgId)) {
      return jsonError('Invalid organization id', 'INVALID_ID', 400);
    }

    const actorOrResp = await requireAiSetupActor();
    if (isResponse(actorOrResp)) return actorOrResp;
    const actor = actorOrResp;

    const db = await getDb();

    let orgWithAccess;
    try {
      orgWithAccess = await loadOrgWithAccess(db, actor, orgId);
    } catch (error) {
      if (error instanceof Error && error.message === 'NOT_FOUND') {
        return jsonError('Organization not found', 'NOT_FOUND', 404);
      }
      throw error;
    }

    if (!orgWithAccess.canManage) {
      return jsonError('You may only modify your own organization', 'FORBIDDEN', 403);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonError('Invalid request body', 'INVALID_BODY', 400);
    }

    const updates: {
      name?: string;
      credential_mode?: 'PLATFORM_MANAGED' | 'ORGANIZATION_BYOK';
      status?: 'active' | 'archived';
    } = {};

    if (typeof body.name === 'string' && body.name.trim().length > 0) {
      if (body.name.trim().length > 120) {
        return jsonError('Organization name must be 120 characters or fewer', 'VALIDATION', 400);
      }
      updates.name = body.name.trim();
    }
    if (typeof body.credentialMode === 'string') {
      if (!(CREDENTIAL_MODES as readonly string[]).includes(body.credentialMode)) {
        return jsonError('Invalid credential mode', 'VALIDATION', 400);
      }
      updates.credential_mode = body.credentialMode;
    }
    if (body.status === 'archived' || body.status === 'active') {
      if (orgWithAccess.org.isDefault && body.status === 'archived') {
        return jsonError('The default organization cannot be archived', 'FORBIDDEN', 400);
      }
      updates.status = body.status;
    }

    if (Object.keys(updates).length === 0) {
      return jsonError('Nothing to update', 'VALIDATION', 400);
    }

    await db
      .updateTable('organizations')
      .set(updates)
      .where('id', '=', orgId)
      .execute();

    const refreshed = await loadOrgWithAccess(db, actor, orgId);
    return NextResponse.json(refreshed.org);
  } catch (error) {
    console.error('[ai-setup] update organization failed:', error);
    return jsonError('Failed to update organization', 'INTERNAL', 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const orgId = await parseOrgId(params);
    if (Number.isNaN(orgId)) {
      return jsonError('Invalid organization id', 'INVALID_ID', 400);
    }

    const actorOrResp = await requireAiSetupActor();
    if (isResponse(actorOrResp)) return actorOrResp;
    const actor = actorOrResp;

    const db = await getDb();

    let orgWithAccess;
    try {
      orgWithAccess = await loadOrgWithAccess(db, actor, orgId);
    } catch (error) {
      if (error instanceof Error && error.message === 'NOT_FOUND') {
        return jsonError('Organization not found', 'NOT_FOUND', 404);
      }
      throw error;
    }

    if (!orgWithAccess.canManage) {
      return jsonError('You may only modify your own organization', 'FORBIDDEN', 403);
    }
    if (orgWithAccess.org.isDefault) {
      return jsonError('The default organization cannot be deleted', 'FORBIDDEN', 400);
    }

    // Collect the organization's categories before deletion.
    const categories = await db
      .selectFrom('categories')
      .select(['id', 'slug'])
      .where('organization_id', '=', orgId)
      .execute();

    const orgCategoryIds = categories.map((c) => c.id);
    const orgCategoryIdSet = new Set(orgCategoryIds);

    // Collect every document referenced by the org's categories, then decide
    // which are exclusive to this org (documents shared with another category
    // are kept).
    const docIdSet = new Set<number>();
    for (const catId of orgCategoryIds) {
      for (const docId of await getDocumentIdsForCategory(catId)) {
        docIdSet.add(docId);
      }
    }

    const allDocIds = [...docIdSet];
    const docCategoryRows = await getDocumentCategoriesForDocs(allDocIds);
    const categoriesByDoc = new Map<number, number[]>();
    for (const row of docCategoryRows) {
      const list = categoriesByDoc.get(row.documentId) ?? [];
      list.push(row.categoryId);
      categoriesByDoc.set(row.documentId, list);
    }

    const docsToDelete: number[] = [];
    for (const docId of allDocIds) {
      const docCategoryIds = categoriesByDoc.get(docId) ?? [];
      const hasOtherCategory = docCategoryIds.some((cid) => !orgCategoryIdSet.has(cid));
      if (!hasOtherCategory) {
        docsToDelete.push(docId);
      }
    }

    // Delete exclusive documents first (while category links still exist) so
    // vector cleanup resolves the correct per-category collections, files, and
    // document rows.
    const deleteErrors: string[] = [];
    for (const docId of docsToDelete) {
      try {
        await deleteDocument(docId.toString());
      } catch (error) {
        deleteErrors.push(
          `Document ${docId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    // Delete categories (and their related rows) then the organization itself.
    // Memberships, provider credentials, and capability config cascade via FK.
    for (const catId of orgCategoryIds) {
      await deleteCategoryWithRelatedData(catId);
    }
    await db.deleteFrom('organizations').where('id', '=', orgId).execute();

    // Drop category vector collections + category memory and invalidate caches.
    const store = await getVectorStore();
    const collNames = await resolveActiveCollectionNames();
    for (const cat of categories) {
      try {
        await store.deleteCollection(collNames.forCategory(cat.slug));
        await store.deleteDocumentsByFilter(CATEGORY_MEMORY_COLLECTION, { categoryId: cat.id });
        await invalidateCategoryCache(cat.slug);
      } catch (error) {
        deleteErrors.push(
          `Category ${cat.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return NextResponse.json({
      success: true,
      deleted: {
        id: orgId,
        categories: categories.length,
        documents: docsToDelete.length,
        deleteErrors: deleteErrors.length > 0 ? deleteErrors : undefined,
      },
    });
  } catch (error) {
    console.error('[ai-setup] delete organization failed:', error);
    return jsonError('Failed to delete organization', 'INTERNAL', 500);
  }
}

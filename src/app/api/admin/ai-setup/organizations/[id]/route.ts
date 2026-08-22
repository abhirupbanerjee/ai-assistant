/**
 * PATCH /api/admin/ai-setup/organizations/[id] — update an organization's name
 * and credential mode. Only the org's `org_admin` (or `super_admin`) may do so;
 * the organization is resolved server-side, never from the frontend.
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const orgId = parseInt(id, 10);
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

    const updates: { name?: string; credential_mode?: 'PLATFORM_MANAGED' | 'ORGANIZATION_BYOK' } = {};
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

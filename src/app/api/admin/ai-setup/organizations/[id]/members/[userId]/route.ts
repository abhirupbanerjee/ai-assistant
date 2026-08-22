/**
 * PATCH  /api/admin/ai-setup/organizations/[id]/members/[userId] — change role.
 * DELETE /api/admin/ai-setup/organizations/[id]/members/[userId] — remove member.
 *
 * The last active `org_admin` cannot be demoted or removed (plan §4 invariant
 * 4). Promoting a member to `org_admin` demotes the current `org_admin` so
 * exactly one active org_admin remains.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb, transaction } from '@/lib/db/kysely';
import {
  requireAiSetupActor,
  isResponse,
  loadOrgWithAccess,
  jsonError,
} from '../../../../_service';
import {
  canDemoteOrRemoveOrgAdmin,
} from '@/lib/organization';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
): Promise<NextResponse> {
  try {
    const { id, userId: userIdStr } = await params;
    const orgId = parseInt(id, 10);
    const userId = parseInt(userIdStr, 10);
    if (Number.isNaN(orgId) || Number.isNaN(userId)) {
      return jsonError('Invalid id', 'INVALID_ID', 400);
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
    const role = body?.role;
    if (role !== 'org_admin' && role !== 'member') {
      return jsonError('Invalid role (expected org_admin or member)', 'VALIDATION', 400);
    }

    const memberships = await db
      .selectFrom('organization_memberships')
      .select(['user_id', 'role', 'status'])
      .where('organization_id', '=', orgId)
      .execute();

    const existing = memberships.find((m) => m.user_id === userId);
    if (!existing) return jsonError('Member not found', 'NOT_FOUND', 404);

    // Demoting the last active org_admin is blocked.
    if (role === 'member' && existing.role === 'org_admin') {
      const check = canDemoteOrRemoveOrgAdmin(
        memberships.map((m) => ({ userId: m.user_id, role: m.role, status: m.status })),
        userId
      );
      if (!check.allowed) {
        return jsonError(check.reason ?? 'Cannot demote the last org_admin', 'VALIDATION', 400);
      }
    }

    await transaction(async (tx) => {
      if (role === 'org_admin') {
        // Successor swap: demote the current org_admin.
        await tx
          .updateTable('organization_memberships')
          .set({ role: 'member' })
          .where('organization_id', '=', orgId)
          .where('role', '=', 'org_admin')
          .where('status', '=', 'active')
          .execute();
      }
      await tx
        .updateTable('organization_memberships')
        .set({ role, status: 'active' })
        .where('organization_id', '=', orgId)
        .where('user_id', '=', userId)
        .execute();
    });

    return NextResponse.json({ ok: true, userId, role });
  } catch (error) {
    console.error('[ai-setup] update member failed:', error);
    return jsonError('Failed to update member', 'INTERNAL', 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
): Promise<NextResponse> {
  try {
    const { id, userId: userIdStr } = await params;
    const orgId = parseInt(id, 10);
    const userId = parseInt(userIdStr, 10);
    if (Number.isNaN(orgId) || Number.isNaN(userId)) {
      return jsonError('Invalid id', 'INVALID_ID', 400);
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

    const memberships = await db
      .selectFrom('organization_memberships')
      .select(['user_id', 'role', 'status'])
      .where('organization_id', '=', orgId)
      .execute();

    const target = memberships.find((m) => m.user_id === userId);
    if (!target) return jsonError('Member not found', 'NOT_FOUND', 404);

    // Removing the last active org_admin is blocked.
    if (target.role === 'org_admin') {
      const check = canDemoteOrRemoveOrgAdmin(
        memberships.map((m) => ({ userId: m.user_id, role: m.role, status: m.status })),
        userId
      );
      if (!check.allowed) {
        return jsonError(check.reason ?? 'Cannot remove the last org_admin', 'VALIDATION', 400);
      }
    }

    await db
      .deleteFrom('organization_memberships')
      .where('organization_id', '=', orgId)
      .where('user_id', '=', userId)
      .execute();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[ai-setup] remove member failed:', error);
    return jsonError('Failed to remove member', 'INTERNAL', 500);
  }
}

/**
 * GET  /api/admin/ai-setup/organizations/[id]/members — list members.
 * POST /api/admin/ai-setup/organizations/[id]/members — add a member and
 *       optionally delegate `org_admin` (promoting a new admin demotes the
 *       previous one so the exactly-one-active-org_admin invariant holds).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb, transaction } from '@/lib/db/kysely';
import { getUserByEmail } from '@/lib/db/compat/users';
import {
  requireAiSetupActor,
  isResponse,
  loadOrgWithAccess,
  jsonError,
} from '../../../_service';
import { MEMBERSHIP_ROLES } from '@/lib/org-admin';
import { canDemoteOrRemoveOrgAdmin } from '@/lib/organization';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const orgId = parseInt(id, 10);
    if (Number.isNaN(orgId)) return jsonError('Invalid organization id', 'INVALID_ID', 400);

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
    if (!orgWithAccess.canView) {
      return jsonError('You do not have access to this organization', 'FORBIDDEN', 403);
    }

    const rows = await db
      .selectFrom('organization_memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(['m.user_id', 'm.role', 'm.status', 'u.email', 'u.name'])
      .where('m.organization_id', '=', orgId)
      .orderBy('m.role')
      .orderBy('u.email')
      .execute();

    return NextResponse.json({
      members: rows.map((r) => ({
        userId: r.user_id,
        email: r.email,
        name: r.name,
        role: r.role,
        status: r.status,
      })),
    });
  } catch (error) {
    console.error('[ai-setup] list members failed:', error);
    return jsonError('Failed to list members', 'INTERNAL', 500);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const orgId = parseInt(id, 10);
    if (Number.isNaN(orgId)) return jsonError('Invalid organization id', 'INVALID_ID', 400);

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

    if (orgWithAccess.org.type === 'INDIVIDUAL') {
      return jsonError('INDIVIDUAL organizations have exactly one member', 'VALIDATION', 400);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonError('Invalid request body', 'INVALID_BODY', 400);
    }

    let userId: number | null = null;
    if (typeof body.userId === 'number') {
      userId = body.userId;
    } else if (typeof body.email === 'string' && body.email.trim().length > 0) {
      const user = await getUserByEmail(body.email);
      if (!user) return jsonError('User not found', 'NOT_FOUND', 404);
      userId = user.id;
    }
    if (userId == null) {
      return jsonError('userId or email is required', 'VALIDATION', 400);
    }

    const role = body.role === 'org_admin' ? 'org_admin' : 'member';
    if (!(MEMBERSHIP_ROLES as readonly string[]).includes(role)) {
      return jsonError('Invalid membership role', 'VALIDATION', 400);
    }

    // Guard the last-admin invariant: upserting an existing `org_admin` with
    // `role: 'member'` would silently demote the sole admin. Reject before the
    // upsert, mirroring the PATCH/DELETE paths.
    if (role === 'member') {
      const memberships = await db
        .selectFrom('organization_memberships')
        .select(['user_id', 'role', 'status'])
        .where('organization_id', '=', orgId)
        .execute();

      const existing = memberships.find((m) => m.user_id === userId);
      if (existing && existing.role === 'org_admin') {
        const check = canDemoteOrRemoveOrgAdmin(
          memberships.map((m) => ({ userId: m.user_id, role: m.role, status: m.status })),
          userId
        );
        if (!check.allowed) {
          return jsonError(check.reason ?? 'Cannot demote the last org_admin', 'VALIDATION', 400);
        }
      }
    }

    await transaction(async (tx) => {
      // Delegating org_admin to a new member: demote the current org_admin so
      // exactly one active org_admin remains (plan §4 invariant 2/4).
      if (role === 'org_admin') {
        await tx
          .updateTable('organization_memberships')
          .set({ role: 'member' })
          .where('organization_id', '=', orgId)
          .where('role', '=', 'org_admin')
          .where('status', '=', 'active')
          .execute();
      }

      await tx
        .insertInto('organization_memberships')
        .values({
          organization_id: orgId,
          user_id: userId!,
          role,
          status: 'active',
        })
        .onConflict((oc) =>
          oc.columns(['organization_id', 'user_id']).doUpdateSet({
            role,
            status: 'active',
          })
        )
        .execute();
    });

    return NextResponse.json({ ok: true, userId, role }, { status: 201 });
  } catch (error) {
    console.error('[ai-setup] add member failed:', error);
    return jsonError('Failed to add member', 'INTERNAL', 500);
  }
}

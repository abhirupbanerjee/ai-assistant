/**
 * POST /api/admin/ai-setup/organizations — create an ENTITY or INDIVIDUAL org.
 *
 * Enforces the plan §4 invariants: creating an org auto-promotes the first
 * member to `org_admin`; an INDIVIDUAL org's sole member is `org_admin`. The
 * creator's membership org is resolved server-side — the frontend never
 * supplies trusted org ids.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb, transaction } from '@/lib/db/kysely';
import { getUserByEmail } from '@/lib/db/compat/users';
import {
  requireAiSetupActor,
  isResponse,
  jsonError,
} from '../_service';
import {
  validateNewOrganization,
  planOrgCreationMemberships,
} from '@/lib/org-admin';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const actorOrResp = await requireAiSetupActor();
    if (isResponse(actorOrResp)) return actorOrResp;
    const actor = actorOrResp;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonError('Invalid request body', 'INVALID_BODY', 400);
    }

    const validation = validateNewOrganization({
      name: body.name,
      type: body.type,
      credentialMode: body.credentialMode,
    });
    if (!validation.ok) {
      return jsonError(validation.errors.join('; '), 'VALIDATION', 400);
    }

    const db = await getDb();

    // Optional delegated org_admin (super_admin creating an org on someone's
    // behalf). Defaults to the creator, who is auto-promoted to org_admin.
    let delegatedAdminUserId: number | null = null;
    if (body.adminEmail && typeof body.adminEmail === 'string') {
      const delegated = await getUserByEmail(body.adminEmail);
      if (!delegated) {
        return jsonError('Delegated org_admin email does not exist', 'VALIDATION', 400);
      }
      delegatedAdminUserId = delegated.id;
    }

    // INDIVIDUAL orgs are one-user tenants; the sole member must be the creator
    // (or the delegated admin) and is always org_admin.
    const creatorUserId = delegatedAdminUserId ?? actor.userId;
    if (creatorUserId == null) {
      return jsonError('Cannot determine the creating user', 'INTERNAL', 500);
    }

    const memberships = planOrgCreationMemberships(
      validation.type!,
      creatorUserId,
      delegatedAdminUserId
    );

    const orgId = await transaction(async (tx) => {
      const org = await tx
        .insertInto('organizations')
        .values({
          name: body.name.trim(),
          type: validation.type!,
          is_default: false,
          credential_mode: validation.credentialMode!,
          status: 'active',
          isolation_mode: 'SOFT',
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      for (const m of memberships) {
        await tx
          .insertInto('organization_memberships')
          .values({
            organization_id: org.id,
            user_id: m.userId,
            role: m.role,
            status: 'active',
          })
          .onConflict((oc) => oc.columns(['organization_id', 'user_id']).doNothing())
          .execute();
      }

      return org.id;
    });

    return NextResponse.json({ id: orgId, memberships }, { status: 201 });
  } catch (error) {
    console.error('[ai-setup] create organization failed:', error);
    return jsonError('Failed to create organization', 'INTERNAL', 500);
  }
}

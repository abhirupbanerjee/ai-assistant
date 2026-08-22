/**
 * GET  /api/admin/ai-setup/organizations/[id]/credentials — redacted list.
 * POST /api/admin/ai-setup/organizations/[id]/credentials — create (or replace)
 *       a BYOK credential via CredentialVault. Raw keys are never returned and
 *       never logged; the secret is envelope-encrypted (AAD-bound) on write.
 *
 * Authorization: org_admin (own org) or super_admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/kysely';
import {
  requireAiSetupActor,
  isResponse,
  loadOrgWithAccess,
  listOrgCredentialsRedacted,
  jsonError,
} from '../../../_service';
import {
  generateCredentialId,
} from '@/lib/org-admin';
import {
  createOrganizationCredential,
  replaceOrganizationCredential,
} from '@/lib/credential-vault';

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

    const credentials = await listOrgCredentialsRedacted(db, orgId);
    return NextResponse.json({ credentials });
  } catch (error) {
    console.error('[ai-setup] list credentials failed:', error);
    return jsonError('Failed to list credentials', 'INTERNAL', 500);
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

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonError('Invalid request body', 'INVALID_BODY', 400);
    }

    const providerId = body.providerId;
    const secret = body.secret;
    if (typeof providerId !== 'string' || providerId.trim().length === 0) {
      return jsonError('providerId is required', 'VALIDATION', 400);
    }
    if (typeof secret !== 'string' || secret.trim().length === 0) {
      return jsonError('secret is required', 'VALIDATION', 400);
    }

    const provider = await db
      .selectFrom('providers')
      .select('id')
      .where('id', '=', providerId)
      .executeTakeFirst();
    if (!provider) {
      return jsonError(`Unknown provider: ${providerId}`, 'VALIDATION', 400);
    }

    const isDefault = body.isDefault === true;

    // If creating a new default, unset any other default for this org+provider
    // so `selectCredentialForProvider()` never sees two defaults.
    if (isDefault) {
      await db
        .updateTable('organization_provider_credentials')
        .set({ is_default: false })
        .where('organization_id', '=', orgId)
        .where('provider_id', '=', providerId)
        .execute();
    }

    let credentialId: string;
    let action: 'created' | 'replaced';

    if (typeof body.credentialId === 'string' && body.credentialId.trim().length > 0) {
      // Replace path — the credential must already exist for this org.
      credentialId = body.credentialId;
      const existing = await db
        .selectFrom('organization_provider_credentials')
        .select('id')
        .where('organization_id', '=', orgId)
        .where('provider_id', '=', providerId)
        .where('credential_id', '=', credentialId)
        .executeTakeFirst();
      if (!existing) {
        return jsonError('Credential not found', 'NOT_FOUND', 404);
      }
      await replaceOrganizationCredential(db, {
        organizationId: orgId,
        providerId,
        credentialId,
        secret,
        actorUserId: actor.userId,
      });
      action = 'replaced';
    } else {
      credentialId = generateCredentialId(providerId);
      await createOrganizationCredential(db, {
        organizationId: orgId,
        providerId,
        credentialId,
        secret,
        actorUserId: actor.userId,
        isDefault,
      });
      action = 'created';
    }

    return NextResponse.json(
      { ok: true, action, credentialId, providerId },
      { status: action === 'created' ? 201 : 200 }
    );
  } catch (error) {
    console.error('[ai-setup] upsert credential failed:', error);
    return jsonError('Failed to save credential', 'INTERNAL', 500);
  }
}

/**
 * POST /api/admin/ai-setup/organizations/[id]/credentials/[credentialId]
 *
 * Credential actions: test | replace | disable | enable | rotate.
 * "Test Connection" resolves/decrypts the credential server-side and reports
 * availability — the raw key is never returned to the UI. All mutations route
 * through the CredentialVault single write path and bump `credential_version`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/kysely';
import {
  requireAiSetupActor,
  isResponse,
  loadOrgWithAccess,
  jsonError,
} from '../../../../_service';
import {
  replaceOrganizationCredential,
  disableOrganizationCredential,
  enableOrganizationCredential,
  rotateOrganizationCredentialDek,
} from '@/lib/credential-vault';
import { resolveOrganizationCredentialById } from '@/lib/provider-credential';
import { verifyProviderCredential } from '@/lib/provider-verification';

type CredentialAction = 'test' | 'replace' | 'disable' | 'enable' | 'rotate';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; credentialId: string }> }
): Promise<NextResponse> {
  try {
    const { id, credentialId } = await params;
    const orgId = parseInt(id, 10);
    if (Number.isNaN(orgId)) return jsonError('Invalid organization id', 'INVALID_ID', 400);
    if (!credentialId) return jsonError('Invalid credential id', 'INVALID_ID', 400);

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
    if (orgWithAccess.org.credentialMode !== 'ORGANIZATION_BYOK') {
      return jsonError(
        'Organization credential actions are only available in ORGANIZATION_BYOK mode',
        'CREDENTIAL_MODE',
        409
      );
    }

    const body = await request.json().catch(() => null);
    const action: CredentialAction = body?.action;

    if (action === 'test') {
      const cred = await db
        .selectFrom('organization_provider_credentials')
        .select('provider_id')
        .where('organization_id', '=', orgId)
        .where('credential_id', '=', credentialId)
        .executeTakeFirst();
      if (!cred) return jsonError('Credential not found', 'NOT_FOUND', 404);

      const resolved = await resolveOrganizationCredentialById(
        db,
        orgId,
        cred.provider_id,
        credentialId
      );
      const verification = await verifyProviderCredential(resolved);
      if (verification.ok) {
        await db.updateTable('organization_provider_credentials')
          .set({ last_verified_at: new Date().toISOString() })
          .where('organization_id', '=', orgId)
          .where('provider_id', '=', cred.provider_id)
          .where('credential_id', '=', credentialId)
          .execute();
      }

      // Record the test in the audit log (redacted — never the raw key).
      await db
        .insertInto('credential_audit_log')
        .values({
          organization_id: orgId,
          provider_id: cred.provider_id,
          credential_id: credentialId,
          actor_user_id: actor.userId,
          action: 'tested',
          redacted_detail: null,
        })
        .execute();

      return NextResponse.json({
        ok: verification.ok,
        providerId: cred.provider_id,
        message: verification.message,
        verification: {
          status: verification.status,
          httpStatus: verification.httpStatus,
          errorCode: verification.errorCode,
          modelCount: verification.modelCount,
        },
      });
    }

    if (!orgWithAccess.canManage) {
      return jsonError('You may only modify your own organization', 'FORBIDDEN', 403);
    }

    const cred = await db
      .selectFrom('organization_provider_credentials')
      .select(['provider_id', 'credential_id'])
      .where('organization_id', '=', orgId)
      .where('credential_id', '=', credentialId)
      .executeTakeFirst();
    if (!cred) return jsonError('Credential not found', 'NOT_FOUND', 404);
    if (action === 'replace' || action === 'enable') {
      const activeCredential = await db.selectFrom('organization_provider_credentials')
        .select('credential_id')
        .where('organization_id', '=', orgId)
        .where('provider_id', '=', cred.provider_id)
        .where('status', '=', 'active')
        .where('credential_id', '!=', credentialId)
        .executeTakeFirst();
      if (activeCredential) {
        return jsonError(
          `Another active ${cred.provider_id} credential exists; replace or disable it first`,
          'ACTIVE_CREDENTIAL_EXISTS',
          409
        );
      }

    }
    let updated = false;
    switch (action) {
      case 'replace': {
        const secret = body?.secret;
        if (typeof secret !== 'string' || secret.trim().length === 0) {
          return jsonError('secret is required to replace a credential', 'VALIDATION', 400);
        }
        updated = await replaceOrganizationCredential(db, {
          organizationId: orgId,
          providerId: cred.provider_id,
          credentialId,
          secret,
          actorUserId: actor.userId,
        });
        break;
      }
      case 'disable':
        updated = await disableOrganizationCredential(db, {
          organizationId: orgId,
          providerId: cred.provider_id,
          credentialId,
          actorUserId: actor.userId,
        });
        break;
      case 'enable':
        updated = await enableOrganizationCredential(db, {
          organizationId: orgId,
          providerId: cred.provider_id,
          credentialId,
          actorUserId: actor.userId,
        });
        break;
      case 'rotate':
        updated = await rotateOrganizationCredentialDek(db, {
          organizationId: orgId,
          providerId: cred.provider_id,
          credentialId,
          actorUserId: actor.userId,
        });
        break;
      default:
        return jsonError('Unknown action', 'VALIDATION', 400);
    }

    if (!updated) return jsonError('Credential not found', 'NOT_FOUND', 404);
    return NextResponse.json({ ok: true, action });
  } catch (error) {
    console.error('[ai-setup] credential action failed:', error);
    if (
      typeof error === 'object' && error !== null && 'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      return jsonError('An active credential already exists for this provider', 'ACTIVE_CREDENTIAL_EXISTS', 409);
    }
    return jsonError('Failed to perform credential action', 'INTERNAL', 500);
  }
}

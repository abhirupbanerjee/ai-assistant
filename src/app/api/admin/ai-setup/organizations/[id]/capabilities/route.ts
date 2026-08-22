/**
 * PUT /api/admin/ai-setup/organizations/[id]/capabilities — save the org's
 * capability → provider/model configuration. One credential is entered once per
 * provider; capabilities reference providers/models without duplicate keys.
 *
 * Authorization: only the org's `org_admin` (or `super_admin`) may write.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb, transaction } from '@/lib/db/kysely';
import {
  requireAiSetupActor,
  isResponse,
  loadOrgWithAccess,
  jsonError,
} from '../../../_service';

interface CapabilityInput {
  capabilityId: string;
  providerId: string;
  modelOrServiceId?: string | null;
  credentialId?: string | null;
  enabled: boolean;
}

export async function PUT(
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
    if (!body || !Array.isArray(body.capabilities)) {
      return jsonError('Invalid request body (expected { capabilities: [...] })', 'INVALID_BODY', 400);
    }

    const capabilities: CapabilityInput[] = body.capabilities;

    // Validate provider ids against the registry (server-side source of truth).
    const providerIds = await db
      .selectFrom('providers')
      .select('id')
      .execute()
      .then((rows) => new Set(rows.map((r) => r.id)));

    const valid: CapabilityInput[] = [];
    const clear: string[] = []; // capability ids whose provider was unset → delete row
    for (const cap of capabilities) {
      if (!cap || typeof cap.capabilityId !== 'string' || typeof cap.providerId !== 'string') {
        return jsonError('Each capability requires capabilityId and providerId', 'VALIDATION', 400);
      }
      if (cap.providerId.trim() === '') {
        clear.push(cap.capabilityId);
        continue;
      }
      if (!providerIds.has(cap.providerId)) {
        return jsonError(`Unknown provider: ${cap.providerId}`, 'VALIDATION', 400);
      }
      valid.push({
        capabilityId: cap.capabilityId,
        providerId: cap.providerId,
        modelOrServiceId: cap.modelOrServiceId ?? null,
        credentialId: cap.credentialId ?? null,
        enabled: cap.enabled !== false,
      });
    }

    await transaction(async (tx) => {
      for (const cap of valid) {
        await tx
          .insertInto('organization_capability_config')
          .values({
            organization_id: orgId,
            capability_id: cap.capabilityId,
            provider_id: cap.providerId,
            credential_id: cap.credentialId,
            model_or_service_id: cap.modelOrServiceId,
            enabled: cap.enabled,
            configuration: {},
          })
          .onConflict((oc) =>
            oc.columns(['organization_id', 'capability_id']).doUpdateSet({
              provider_id: cap.providerId,
              credential_id: cap.credentialId,
              model_or_service_id: cap.modelOrServiceId,
              enabled: cap.enabled,
            })
          )
          .execute();
      }
      for (const capabilityId of clear) {
        await tx
          .deleteFrom('organization_capability_config')
          .where('organization_id', '=', orgId)
          .where('capability_id', '=', capabilityId)
          .execute();
      }
    });

    return NextResponse.json({ ok: true, saved: valid.length, cleared: clear.length });
  } catch (error) {
    console.error('[ai-setup] save capabilities failed:', error);
    return jsonError('Failed to save capability configuration', 'INTERNAL', 500);
  }
}

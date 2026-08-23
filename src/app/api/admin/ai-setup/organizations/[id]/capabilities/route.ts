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
import {
  buildSupportedProviderCapabilitySet,
  isProviderCapabilitySupported,
  providerCapabilityKey,
  validateCapabilitySelection,
  type ProviderCapabilitySelectionRule,
} from '@/lib/provider-registry';

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

    // Validate capability ids and provider/capability pairs against the
    // registry (server-side source of truth). A provider merely existing is not
    // enough: it must be enabled and explicitly support the capability.
    const [capabilityRows, mappingRows, enabledModelRows, credentialRows] = await Promise.all([
      db.selectFrom('capabilities').select('id').execute(),
      db
        .selectFrom('provider_capabilities as pc')
        .innerJoin('providers as p', 'p.id', 'pc.provider_id')
        .select(['pc.provider_id', 'pc.capability_id', 'pc.is_supported', 'pc.model_or_service_ids', 'pc.selection_mode'])
        .where('p.enabled', '=', true)
        .execute(),
      db
        .selectFrom('enabled_models')
        .select(['id', 'provider_id'])
        .where('enabled', '=', 1)
        .execute(),
      db
        .selectFrom('organization_provider_credentials')
        .select(['provider_id', 'credential_id', 'status'])
        .where('organization_id', '=', orgId)
        .execute(),
    ]);
    const capabilityIds = new Set(capabilityRows.map((row) => row.id));
    const supportedPairs = buildSupportedProviderCapabilitySet(
      mappingRows.map((row) => ({
        providerId: row.provider_id,
        capabilityId: row.capability_id,
        isSupported: row.is_supported,
      }))
    );
    const selectionRules = new Map<string, ProviderCapabilitySelectionRule>();
    for (const row of mappingRows) {
      selectionRules.set(providerCapabilityKey(row.provider_id, row.capability_id), {
        selectionMode: row.selection_mode,
        modelOrServiceIds: row.model_or_service_ids,
      });
    }
    const enabledModelsByProvider = new Map<string, Set<string>>();
    for (const row of enabledModelRows) {
      const ids = enabledModelsByProvider.get(row.provider_id) ?? new Set<string>();
      ids.add(row.id);
      enabledModelsByProvider.set(row.provider_id, ids);
    }
    const activeCredentialKeys = new Set(
      credentialRows
        .filter((row) => row.status === 'active')
        .map((row) => `${row.provider_id}\u0000${row.credential_id}`)
    );


    const valid: CapabilityInput[] = [];
    const clear: string[] = []; // capability ids whose provider was unset → delete row
    for (const cap of capabilities) {
      if (!cap || typeof cap.capabilityId !== 'string' || typeof cap.providerId !== 'string') {
        return jsonError('Each capability requires capabilityId and providerId', 'VALIDATION', 400);
      }
      if (!capabilityIds.has(cap.capabilityId)) {
        return jsonError(`Unknown capability: ${cap.capabilityId}`, 'VALIDATION', 400);
      }
      if (cap.providerId.trim() === '') {
        clear.push(cap.capabilityId);
        continue;
      }
      if (!isProviderCapabilitySupported(supportedPairs, cap.providerId, cap.capabilityId)) {
        return jsonError(
          `Provider ${cap.providerId} does not support capability ${cap.capabilityId}`,
          'VALIDATION',
          400
        );
      }
      const rule = selectionRules.get(providerCapabilityKey(cap.providerId, cap.capabilityId));
      if (!rule) {
        return jsonError('Provider capability metadata is missing', 'VALIDATION', 400);
      }
      const selection = validateCapabilitySelection(
        rule,
        cap.modelOrServiceId,
        enabledModelsByProvider.get(cap.providerId) ?? new Set()
      );
      if (!selection.valid) {
        const detail = selection.reason === 'SELECTION_NOT_ALLOWED'
          ? `Capability ${cap.capabilityId} does not accept a model or service selection`
          : `Model or service ${cap.modelOrServiceId} is not supported by ${cap.providerId} for ${cap.capabilityId}`;
        return jsonError(detail, 'VALIDATION', 400);
      }
      const credentialId = typeof cap.credentialId === 'string' && cap.credentialId.trim()
        ? cap.credentialId.trim()
        : null;
      if (credentialId && !activeCredentialKeys.has(`${cap.providerId}\u0000${credentialId}`)) {
        return jsonError(
          `Credential ${credentialId} is not an active ${cap.providerId} credential for this organization`,
          'VALIDATION',
          400
        );
      }
      valid.push({
        capabilityId: cap.capabilityId,
        providerId: cap.providerId,
        modelOrServiceId: cap.modelOrServiceId?.trim() || null,
        credentialId,
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

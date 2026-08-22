/**
 * GET /api/admin/ai-setup — consolidated AI & API Setup overview.
 *
 * Returns the server-side provider/capability registry, the actor's org scope,
 * the selected organization's configuration health, redacted credentials, and
 * capability config. Raw keys are never returned.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/kysely';
import { readFeatureFlagCombinations } from '@/lib/feature-flag-combinations';
import type { HealthReport } from '@/lib/health-evaluator';
import {
  requireAiSetupActor,
  isResponse,
  listOrganizationsForActor,
  loadRegistry,
  buildHealthReport,
  listOrgCredentialsRedacted,
  activeOrgCredentialCount,
  jsonError,
  type RedactedCredential,
} from './_service';

export interface CapabilityConfigPayload {
  capabilityId: string;
  providerId: string;
  credentialId: string | null;
  modelOrServiceId: string | null;
  enabled: boolean;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const actorOrResp = await requireAiSetupActor();
    if (isResponse(actorOrResp)) return actorOrResp;
    const actor = actorOrResp;

    const db = await getDb();
    const flags = await readFeatureFlagCombinations(db);

    const organizations = await listOrganizationsForActor(db, actor);

    // Determine the selected organization (server-side; the frontend org id is
    // only a display hint and is re-validated against the actor's access).
    const url = new URL(request.url);
    const requestedOrgId = url.searchParams.get('orgId')
      ? parseInt(url.searchParams.get('orgId')!, 10)
      : null;

    let selectedOrgId: number | null = null;
    if (requestedOrgId != null && organizations.some((o) => o.id === requestedOrgId)) {
      selectedOrgId = requestedOrgId;
    } else if (actor.isSuperAdmin) {
      selectedOrgId = organizations.find((o) => o.isDefault)?.id ?? organizations[0]?.id ?? null;
    } else {
      selectedOrgId = actor.organizationId;
    }

    let health: HealthReport | null = null;
    let credentials: RedactedCredential[] = [];
    let capabilityConfig: CapabilityConfigPayload[] = [];
    let activeCredentialCount = 0;

    if (selectedOrgId != null) {
      const [healthReport, creds, cfgRows, credCount] = await Promise.all([
        buildHealthReport(db, selectedOrgId),
        listOrgCredentialsRedacted(db, selectedOrgId),
        db
          .selectFrom('organization_capability_config')
          .select(['capability_id', 'provider_id', 'credential_id', 'model_or_service_id', 'enabled'])
          .where('organization_id', '=', selectedOrgId)
          .execute(),
        activeOrgCredentialCount(db, selectedOrgId),
      ]);
      health = healthReport;
      credentials = creds;
      activeCredentialCount = credCount;
      capabilityConfig = cfgRows.map((r) => ({
        capabilityId: r.capability_id,
        providerId: r.provider_id,
        credentialId: r.credential_id,
        modelOrServiceId: r.model_or_service_id,
        enabled: r.enabled,
      }));
    }

    return NextResponse.json({
      flag: { aiApiSetupUiEnabled: flags.aiApiSetupUiEnabled },
      viewer: {
        role: actor.role,
        isSuperAdmin: actor.isSuperAdmin,
        userId: actor.userId,
        organizationId: actor.organizationId,
        membershipRole: actor.membershipRole,
      },
      selectedOrgId,
      organizations,
      registry: await loadRegistry(db),
      health,
      credentials,
      activeCredentialCount,
      capabilityConfig,
    });
  } catch (error) {
    console.error('[ai-setup] overview failed:', error);
    return jsonError('Failed to load AI & API setup', 'INTERNAL', 500);
  }
}

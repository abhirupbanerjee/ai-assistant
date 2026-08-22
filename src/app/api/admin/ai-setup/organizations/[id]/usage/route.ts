/**
 * GET /api/admin/ai-setup/organizations/[id]/usage — org-scoped usage/cost.
 *
 * Cost attribution (Decision 9): PLATFORM_MANAGED cost is super_admin-only;
 * ORGANIZATION_BYOK cost is visible to the org's org_admin; a BYOK org without
 * a key reports cost UNAVAILABLE. Usage rows carry `organization_id` +
 * `credential_id`; the vault never returns key material to this pipeline.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/kysely';
import {
  requireAiSetupActor,
  isResponse,
  loadOrgWithAccess,
  getOrgUsage,
  activeOrgCredentialCount,
  jsonError,
} from '../../../_service';
import { canViewOrganizationCost } from '@/lib/org-admin';

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

    const url = new URL(request.url);
    const rawDays = parseInt(url.searchParams.get('days') || '30', 10);

    // Reject non-finite/NaN before querying; clamp the rest to 1–365 so a
    // malicious or accidental value cannot fan out into unbounded SQL intervals.
    if (Number.isNaN(rawDays) || !Number.isFinite(rawDays)) {
      return jsonError('Invalid days parameter', 'INVALID_DAYS', 400);
    }
    const days = Math.min(365, Math.max(1, Math.floor(rawDays)));

    const hasActiveOrgCredential = (await activeOrgCredentialCount(db, orgId)) > 0;
    const costVisibility = canViewOrganizationCost(
      actor,
      { id: orgId, credentialMode: orgWithAccess.org.credentialMode as 'PLATFORM_MANAGED' | 'ORGANIZATION_BYOK' },
      hasActiveOrgCredential
    );

    const usage = await getOrgUsage(db, orgId, days);

    // Cost fields are zeroed out (never the raw cost) when the actor may not
    // view them, matching the admin usage dashboard's stripCostData pattern.
    if (!costVisibility.canView) {
      usage.totalCost = 0;
      usage.byCredential = usage.byCredential.map((c) => ({ ...c, totalCost: 0 }));
    }

    return NextResponse.json({
      org: orgWithAccess.org,
      cost: {
        canView: costVisibility.canView,
        reason: costVisibility.reason,
      },
      usage,
    });
  } catch (error) {
    console.error('[ai-setup] org usage failed:', error);
    return jsonError('Failed to load usage', 'INTERNAL', 500);
  }
}

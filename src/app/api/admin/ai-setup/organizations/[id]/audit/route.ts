/**
 * GET /api/admin/ai-setup/organizations/[id]/audit — per-organization credential
 * key-change page (org_admin own org, or super_admin). All entries are redacted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/kysely';
import {
  requireAiSetupActor,
  isResponse,
  loadOrgWithAccess,
  listCredentialAudit,
  jsonError,
} from '../../../_service';

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

    const entries = await listCredentialAudit(db, orgId);
    return NextResponse.json({ entries });
  } catch (error) {
    console.error('[ai-setup] per-org audit failed:', error);
    return jsonError('Failed to load audit log', 'INTERNAL', 500);
  }
}

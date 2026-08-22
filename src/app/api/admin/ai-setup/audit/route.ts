/**
 * GET /api/admin/ai-setup/audit — global credential audit (super_admin only).
 * Every entry is redacted by construction: the vault writes only `redactSecret()`
 * output to `redacted_detail`, never raw key material.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/kysely';
import {
  requireAiSetupActor,
  isResponse,
  listCredentialAudit,
  jsonError,
} from '../_service';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const actorOrResp = await requireAiSetupActor();
    if (isResponse(actorOrResp)) return actorOrResp;
    const actor = actorOrResp;

    if (!actor.isSuperAdmin) {
      return jsonError('Super admin access required for the global audit', 'FORBIDDEN', 403);
    }

    const db = await getDb();
    const entries = await listCredentialAudit(db, null);
    return NextResponse.json({ entries });
  } catch (error) {
    console.error('[ai-setup] global audit failed:', error);
    return jsonError('Failed to load audit log', 'INTERNAL', 500);
  }
}

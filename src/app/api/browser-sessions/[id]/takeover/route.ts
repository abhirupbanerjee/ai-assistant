/**
 * POST /api/browser-sessions/[id]/takeover — user takes over the session.
 * Suspends agent observation/control.
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateBrowserSession } from '@/lib/db/compat';
import { getBrowserWorkerClient } from '@/lib/browser/client';
import { requireOwnedSession, toErrorResponse } from '../../_helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireOwnedSession(id);

    await getBrowserWorkerClient().takeover(id);
    await updateBrowserSession(id, { state: 'takeover', pendingCheckpoint: 'takeover' });

    return NextResponse.json({ success: true, state: 'takeover', checkpoint: 'takeover' });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

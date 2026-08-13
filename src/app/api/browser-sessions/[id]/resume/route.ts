/**
 * POST /api/browser-sessions/[id]/resume — user returns control to the agent.
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

    await getBrowserWorkerClient().resume(id);
    await updateBrowserSession(id, { state: 'observing', pendingCheckpoint: null });

    return NextResponse.json({ success: true, state: 'observing', checkpoint: null });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

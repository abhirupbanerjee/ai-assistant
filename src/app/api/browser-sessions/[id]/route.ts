/**
 * GET    /api/browser-sessions/[id] — session state (+ optional live screenshot)
 * DELETE /api/browser-sessions/[id] — terminate the session
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBrowserSessionForUser, terminateBrowserSession } from '@/lib/db/compat';
import { getBrowserWorkerClient } from '@/lib/browser/client';
import { requireDbUserId, toErrorResponse } from '../_helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const userId = await requireDbUserId();
    const session = await getBrowserSessionForUser(id, userId);
    if (!session) {
      return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const url = new URL(request.url);
    if (url.searchParams.get('screenshot') === '1') {
      const observation = await getBrowserWorkerClient().observe(id, true);
      return NextResponse.json({ session, observation });
    }

    return NextResponse.json({ session });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const userId = await requireDbUserId();
    const session = await getBrowserSessionForUser(id, userId);
    if (!session) {
      return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    await getBrowserWorkerClient().terminate(id);
    await terminateBrowserSession(id, userId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

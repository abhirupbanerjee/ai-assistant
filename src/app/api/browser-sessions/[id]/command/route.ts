/**
 * POST /api/browser-sessions/[id]/command — issue a user command to the live session.
 *
 * Body: { action: { type: 'navigate'|'click'|'fill'|'select', ... }, confirmToken? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateBrowserSession } from '@/lib/db/compat';
import { getBrowserWorkerClient } from '@/lib/browser/client';
import type { BrowserAction } from '@/types/browser';
import { requireOwnedSession, toErrorResponse } from '../../_helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireOwnedSession(id);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = body.action as BrowserAction | undefined;
    if (!action || typeof action.type !== 'string') {
      return NextResponse.json(
        { error: 'A valid action object is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const confirmToken = typeof body.confirmToken === 'string' ? body.confirmToken : undefined;
    const result = await getBrowserWorkerClient().executeAction(id, action, confirmToken);

    await updateBrowserSession(id, {
      state: result.state,
      pendingCheckpoint: result.checkpoint,
      currentUrl: result.observation?.url ?? null,
      pageTitle: result.observation?.title ?? null,
      lastAriaJson: result.observation ? JSON.stringify(result.observation.aria) : undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

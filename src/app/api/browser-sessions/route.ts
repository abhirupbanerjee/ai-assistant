/**
 * POST /api/browser-sessions — create a browser session (manual/panel entry point).
 *
 * The model-driven path goes through the `browser_task_start` tool; this route
 * exists so the UI can create a session directly and for testing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  createBrowserSession,
  expireStaleBrowserSessions,
  getBrowserSession,
  getUserByEmail,
  updateBrowserSession,
} from '@/lib/db/compat';
import { getToolConfig } from '@/lib/db/compat/tool-config';
import { getBrowserWorkerClient, isBrowserWorkerConfigured } from '@/lib/browser/client';
import { toErrorResponse } from './_helpers';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    // Lazy expiry: opportunistically mark TTL-expired sessions before creating a new one.
    void expireStaleBrowserSessions().catch(() => undefined);

    const user = await getCurrentUser();
    if (!user?.email) {
      return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    }
    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, { status: 404 });
    }

    if (!isBrowserWorkerConfigured()) {
      return NextResponse.json(
        { error: 'Browser worker is not configured', code: 'BROWSER_NOT_CONFIGURED' },
        { status: 503 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const threadId = typeof body.threadId === 'string' ? body.threadId : null;
    const startUrl = typeof body.startUrl === 'string' ? body.startUrl : undefined;

    let allowlist = Array.isArray(body.allowlist)
      ? (body.allowlist as unknown[]).map(String)
      : [];
    if (allowlist.length === 0) {
      const cfg = await getToolConfig('browser_task_start');
      const cfgList = (cfg?.config as Record<string, unknown> | undefined)?.allowlist;
      if (Array.isArray(cfgList)) allowlist = cfgList.map(String);
    }
    if (allowlist.length === 0) {
      return NextResponse.json(
        { error: 'No allowed domains configured for browser automation', code: 'DOMAIN_ALLOWLIST_EMPTY' },
        { status: 400 }
      );
    }

    const session = await createBrowserSession({
      userId: dbUser.id,
      threadId,
      allowlist,
      expiresInMs: DEFAULT_TTL_MS,
    });

    const client = getBrowserWorkerClient();
    const snap = await client.createSession(session.sessionId, allowlist);
    await updateBrowserSession(session.sessionId, { workerSessionId: snap.workerSessionId });

    if (startUrl) {
      const nav = await client.executeAction(session.sessionId, { type: 'navigate', url: startUrl });
      await updateBrowserSession(session.sessionId, {
        state: nav.state,
        pendingCheckpoint: nav.checkpoint,
        currentUrl: nav.observation?.url ?? null,
        pageTitle: nav.observation?.title ?? null,
      });
    }

    const observation = await client.observe(session.sessionId, true);
    await updateBrowserSession(session.sessionId, {
      state: observation.state,
      currentUrl: observation.url,
      pageTitle: observation.title,
      pendingCheckpoint: observation.checkpoint,
      lastAriaJson: JSON.stringify(observation.aria),
    });

    const info = await getBrowserSession(session.sessionId);
    return NextResponse.json({ session: info, observation }, { status: 201 });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

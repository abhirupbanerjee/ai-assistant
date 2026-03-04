/**
 * Workspace Threads API
 *
 * Manages threads for standalone workspace mode.
 * Threads group messages into conversations within a session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail } from '@/lib/db/compat';
import {
  validateWorkspaceRequest,
  extractOrigin,
} from '@/lib/workspace/validator';
import {
  getSession,
  isSessionValid,
  createWorkspaceThread as createThread,
  getSessionThreads,
  getSessionThreadCount,
  type CreateWorkspaceThreadInput,
} from '@/lib/db/compat';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

interface CreateThreadRequest {
  sessionId: string;
  title?: string;
}

interface ListThreadsQuery {
  sessionId: string;
  includeArchived?: string;
  limit?: string;
  offset?: string;
}

/**
 * GET /api/w/[slug]/threads
 *
 * List threads for a session.
 * Only available for standalone workspaces.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { slug } = await context.params;
    const origin = extractOrigin(request.headers);
    const searchParams = request.nextUrl.searchParams;

    // Accept sessionId from header OR query parameter
    const sessionId = request.headers.get('X-Session-Id') || searchParams.get('sessionId');
    const includeArchived = searchParams.get('includeArchived') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Validate workspace
    const validation = await validateWorkspaceRequest(slug, {
      origin: origin || undefined,
      checkEnabled: true,
    });

    if (!validation.valid || !validation.workspace) {
      return NextResponse.json(
        { error: validation.error, code: validation.errorCode },
        { status: 404 }
      );
    }

    const workspace = validation.workspace;

    // Threads only available for standalone mode
    if (workspace.type !== 'standalone') {
      return NextResponse.json(
        { error: 'Threads not available for embed workspaces', code: 'NOT_SUPPORTED' },
        { status: 400 }
      );
    }

    // Validate session
    if (!(await isSessionValid(sessionId))) {
      return NextResponse.json(
        { error: 'Session expired', code: 'SESSION_EXPIRED' },
        { status: 401 }
      );
    }

    const session = await getSession(sessionId);
    if (!session || session.workspace_id !== workspace.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'SESSION_INVALID' },
        { status: 401 }
      );
    }

    // Get threads
    const threads = await getSessionThreads(sessionId, {
      includeArchived,
      limit,
      offset,
    });

    const total = await getSessionThreadCount(sessionId, includeArchived);

    return NextResponse.json({
      threads,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + threads.length < total,
      },
    });
  } catch (error) {
    console.error('List threads error:', error);
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/w/[slug]/threads
 *
 * Create a new thread.
 * Only available for standalone workspaces.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { slug } = await context.params;
    const origin = extractOrigin(request.headers);

    const body = await request.json() as CreateThreadRequest;
    // Accept sessionId from header OR body
    const sessionId = request.headers.get('X-Session-Id') || body.sessionId;
    const { title } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Validate workspace
    const validation = await validateWorkspaceRequest(slug, {
      origin: origin || undefined,
      checkEnabled: true,
    });

    if (!validation.valid || !validation.workspace) {
      return NextResponse.json(
        { error: validation.error, code: validation.errorCode },
        { status: 404 }
      );
    }

    const workspace = validation.workspace;

    // Threads only available for standalone mode
    if (workspace.type !== 'standalone') {
      return NextResponse.json(
        { error: 'Threads not available for embed workspaces', code: 'NOT_SUPPORTED' },
        { status: 400 }
      );
    }

    // Validate session
    if (!(await isSessionValid(sessionId))) {
      return NextResponse.json(
        { error: 'Session expired', code: 'SESSION_EXPIRED' },
        { status: 401 }
      );
    }

    const session = await getSession(sessionId);
    if (!session || session.workspace_id !== workspace.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'SESSION_INVALID' },
        { status: 401 }
      );
    }

    // Create thread
    const input: CreateWorkspaceThreadInput = {};
    if (title) {
      input.title = title;
    }

    const thread = await createThread(workspace.id, sessionId, input);

    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    console.error('Create thread error:', error);
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

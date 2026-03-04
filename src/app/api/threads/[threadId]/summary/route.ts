import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail, getThreadOwner } from '@/lib/db/compat';
import {
  getThreadSummary,
  getThreadSummaryHistory,
  summarizeThread,
} from '@/lib/summarization';
import type { ApiError } from '@/types';

/**
 * GET /api/threads/[threadId]/summary
 * Get summary details for a thread
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { threadId } = await params;

    // Verify thread ownership
    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const thread = await getThreadOwner(threadId);

    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    if (thread.user_id !== dbUser.id && !user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Get current summary
    const summary = await getThreadSummary(threadId);

    // Get summary history
    const history = await getThreadSummaryHistory(threadId);

    return NextResponse.json({
      hasSummary: !!summary,
      summary: summary || null,
      history,
    });
  } catch (error) {
    console.error('Get thread summary error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to get thread summary',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/threads/[threadId]/summary
 * Manually trigger summarization for a thread
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { threadId } = await params;

    // Verify thread ownership
    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const thread = await getThreadOwner(threadId);

    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    if (thread.user_id !== dbUser.id && !user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Trigger summarization
    const summary = await summarizeThread(threadId);

    if (!summary) {
      return NextResponse.json<ApiError>(
        { error: 'Unable to summarize thread (not enough messages or summarization disabled)', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error('Summarize thread error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to summarize thread',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

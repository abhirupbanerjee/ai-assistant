import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getThread, deleteThread, updateThreadTitle, setThreadCategories } from '@/lib/threads';
import { getTaskPlansByThread } from '@/lib/db/compat/task-plans';
import type { ThreadWithMessages, DeleteThreadResponse, UpdateThreadRequest, ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ threadId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { threadId } = await params;
    const thread = await getThread(user.id, threadId);

    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get task plans for this thread (most recent completed/active plan for autonomous mode)
    const taskPlans = await getTaskPlansByThread(threadId);
    const completedPlan = taskPlans.find(p =>
      p.status === 'completed' || p.status === 'failed' || p.status === 'active'
    );

    return NextResponse.json({
      ...thread,
      taskPlan: completedPlan || null,
    });
  } catch (error) {
    console.error('Get thread error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to get thread', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { threadId } = await params;
    const result = await deleteThread(user.id, threadId);

    if (!result) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json<DeleteThreadResponse>({
      success: true,
      deleted: {
        threadId,
        messageCount: result.messageCount,
        uploadCount: result.uploadCount,
      },
    });
  } catch (error) {
    console.error('Delete thread error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to delete thread', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { threadId } = await params;
    const body = await request.json() as UpdateThreadRequest;

    // Need at least one field to update
    if (!body.title && !body.categoryIds) {
      return NextResponse.json<ApiError>(
        { error: 'Title or categoryIds required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Verify thread exists and belongs to user
    let thread = await getThread(user.id, threadId);
    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Update title if provided
    if (body.title) {
      const updatedThread = await updateThreadTitle(user.id, threadId, body.title);
      if (updatedThread) {
        thread = { ...thread, title: updatedThread.title, updatedAt: updatedThread.updatedAt };
      }
    }

    // Update categories if provided
    if (body.categoryIds !== undefined) {
      await setThreadCategories(user.id, threadId, body.categoryIds);
      // Refresh thread to get updated categories
      const refreshedThread = await getThread(user.id, threadId);
      if (refreshedThread) {
        thread = refreshedThread;
      }
    }

    return NextResponse.json({
      id: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      categories: thread.categories,
    });
  } catch (error) {
    console.error('Update thread error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to update thread', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * Skip Task API
 *
 * POST /api/autonomous/[planId]/tasks/[taskId]/skip
 * Skips a specific pending task in an autonomous plan.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getTaskPlan, skipTask } from '@/lib/db/compat/task-plans';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ planId: string; taskId: string }>;
}

interface SkipRequest {
  reason?: string;
}

interface SkipResponse {
  success: boolean;
  task_id: number;
  status: string;
  message: string;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { planId, taskId } = await params;
    const taskIdNum = parseInt(taskId, 10);

    if (isNaN(taskIdNum)) {
      return NextResponse.json<ApiError>(
        { error: 'Invalid task ID', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Verify plan exists and belongs to user
    const plan = await getTaskPlan(planId);
    if (!plan) {
      return NextResponse.json<ApiError>(
        { error: 'Plan not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    if (plan.userId !== String(user.id)) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 403 }
      );
    }

    // Verify task exists
    const task = plan.tasks.find((t) => t.id === taskIdNum);
    if (!task) {
      return NextResponse.json<ApiError>(
        { error: 'Task not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Parse request body
    let body: SkipRequest = {};
    try {
      body = await request.json();
    } catch {
      // No body is OK
    }

    // Skip the task
    const updatedPlan = await skipTask(planId, taskIdNum, body.reason);
    if (!updatedPlan) {
      return NextResponse.json<ApiError>(
        { error: `Cannot skip task with status '${task.status}'`, code: 'INVALID_STATE' },
        { status: 400 }
      );
    }

    return NextResponse.json<SkipResponse>({
      success: true,
      task_id: taskIdNum,
      status: 'skipped',
      message: `Task ${taskIdNum} skipped${body.reason ? `: ${body.reason}` : ''}`,
    });
  } catch (error) {
    console.error('Skip task error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to skip task', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

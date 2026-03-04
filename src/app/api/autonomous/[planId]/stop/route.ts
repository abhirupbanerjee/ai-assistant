/**
 * Stop Autonomous Plan API
 *
 * POST /api/autonomous/[planId]/stop
 * Gracefully stops an autonomous plan, keeping all completed work.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getTaskPlan, stopPlan } from '@/lib/db/compat/task-plans';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

interface StopRequest {
  reason?: string;
}

interface StopResponse {
  success: boolean;
  status: string;
  completed_tasks: number;
  skipped_tasks: number;
  total_tasks: number;
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

    const { planId } = await params;

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

    // Parse request body
    let body: StopRequest = {};
    try {
      body = await request.json();
    } catch {
      // No body is OK
    }

    // Stop the plan
    const updatedPlan = await stopPlan(planId, body.reason);
    if (!updatedPlan) {
      return NextResponse.json<ApiError>(
        { error: `Cannot stop plan with status '${plan.status}'`, code: 'INVALID_STATE' },
        { status: 400 }
      );
    }

    const completedTasks = updatedPlan.tasks.filter(
      (t) => t.status === 'complete'
    ).length;
    const skippedTasks = updatedPlan.tasks.filter((t) => t.status === 'skipped').length;

    return NextResponse.json<StopResponse>({
      success: true,
      status: 'stopped',
      completed_tasks: completedTasks,
      skipped_tasks: skippedTasks,
      total_tasks: updatedPlan.totalTasks,
      message: `Plan stopped at ${completedTasks}/${updatedPlan.totalTasks} tasks. ${skippedTasks} tasks skipped.`,
    });
  } catch (error) {
    console.error('Stop plan error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to stop plan', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * Pause Autonomous Plan API
 *
 * POST /api/autonomous/[planId]/pause
 * Pauses an active autonomous plan after the current task completes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getTaskPlan, pausePlan } from '@/lib/db/compat/task-plans';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

interface PauseRequest {
  reason?: string;
}

interface PauseResponse {
  success: boolean;
  status: string;
  completed_tasks: number;
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
    let body: PauseRequest = {};
    try {
      body = await request.json();
    } catch {
      // No body is OK
    }

    // Pause the plan
    const updatedPlan = await pausePlan(planId, body.reason);
    if (!updatedPlan) {
      return NextResponse.json<ApiError>(
        { error: `Cannot pause plan with status '${plan.status}'`, code: 'INVALID_STATE' },
        { status: 400 }
      );
    }

    const completedTasks = updatedPlan.tasks.filter(
      (t) => t.status === 'complete'
    ).length;

    return NextResponse.json<PauseResponse>({
      success: true,
      status: 'paused',
      completed_tasks: completedTasks,
      total_tasks: updatedPlan.totalTasks,
      message: `Plan paused at ${completedTasks}/${updatedPlan.totalTasks} tasks`,
    });
  } catch (error) {
    console.error('Pause plan error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to pause plan', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

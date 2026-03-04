/**
 * Resume Autonomous Plan API
 *
 * POST /api/autonomous/[planId]/resume
 * Resumes a paused autonomous plan and continues execution.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getTaskPlan, resumePlan } from '@/lib/db/compat/task-plans';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

interface ResumeResponse {
  success: boolean;
  status: string;
  remaining_tasks: number;
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

    // Resume the plan
    const updatedPlan = await resumePlan(planId);
    if (!updatedPlan) {
      return NextResponse.json<ApiError>(
        { error: `Cannot resume plan with status '${plan.status}'`, code: 'INVALID_STATE' },
        { status: 400 }
      );
    }

    const remainingTasks = updatedPlan.tasks.filter((t) => t.status === 'pending').length;

    return NextResponse.json<ResumeResponse>({
      success: true,
      status: 'active',
      remaining_tasks: remainingTasks,
      total_tasks: updatedPlan.totalTasks,
      message: `Plan resumed with ${remainingTasks} remaining tasks`,
    });
  } catch (error) {
    console.error('Resume plan error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to resume plan', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

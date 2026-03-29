/**
 * Approve/Reject Autonomous Plan API
 *
 * POST /api/autonomous/[planId]/approve
 * Resolves the plan approval pause, allowing execution to proceed or cancel.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getTaskPlan } from '@/lib/db/compat/task-plans';
import { resolvePlanApprovalById } from '@/lib/streaming/plan-approval-resolver';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

interface ApproveRequest {
  approved: boolean;
  feedback?: string;
}

interface ApproveResponse {
  success: boolean;
  resolved: boolean;
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
    let body: ApproveRequest;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<ApiError>(
        { error: 'Invalid request body', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    if (typeof body.approved !== 'boolean') {
      return NextResponse.json<ApiError>(
        { error: 'approved field is required (boolean)', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Resolve the pending approval
    const resolved = resolvePlanApprovalById(planId, {
      approved: body.approved,
      feedback: body.feedback,
    });

    return NextResponse.json<ApproveResponse>({
      success: true,
      resolved,
    });
  } catch (error) {
    console.error('Approve plan error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to process plan approval', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

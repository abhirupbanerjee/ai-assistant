/**
 * Subagent Tool Approval API
 *
 * POST /api/agent/subagent/approve
 * Resolves a pending subagent tool execution approval, allowing the loop to proceed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { resolveSubagentApproval } from '@/lib/streaming/subagent-approval-resolver';
import { getTaskPlan } from '@/lib/db/compat/task-plans';
import type { ApiError } from '@/types';

interface ApproveRequest {
  task_id: number;
  plan_id: string;
  action: 'approve' | 'deny' | 'modify';
  modified_args?: Record<string, unknown>;
}

interface ApproveResponse {
  success: boolean;
  resolved: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    let body: ApproveRequest;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<ApiError>(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const { task_id, plan_id, action, modified_args } = body;
    if (typeof task_id !== 'number' || typeof plan_id !== 'string') {
      return NextResponse.json<ApiError>(
        { error: 'task_id and plan_id are required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Verify plan exists and belongs to user
    const plan = await getTaskPlan(plan_id);
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

    const result = action === 'approve'
      ? { approved: true, modifiedArgs: modified_args }
      : { approved: false };

    const resolved = resolveSubagentApproval(task_id, result);

    return NextResponse.json<ApproveResponse>({
      success: true,
      resolved,
    });
  } catch (error) {
    console.error('[Subagent Approval] Error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to process approval',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * Single Agent Registry API
 *
 * GET    - Get agent details
 * PUT    - Update agent (name, role, model, prompt, tools, config, enabled)
 * DELETE - Remove agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getAgentById,
  updateAgent,
  deleteAgent,
  type AgentRoleFamily,
  type UpdateAgentInput,
} from '@/lib/db/compat';
import type { ApiError } from '@/types';

const VALID_ROLES: AgentRoleFamily[] = [
  'planner',
  'executor',
  'critic',
  'researcher',
  'presenter',
];

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/admin/agents/[id]
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const agent = await getAgentById(id);

    if (!agent) {
      return NextResponse.json<ApiError>(
        { error: 'Agent not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json({ agent });
  } catch (error) {
    console.error('[Agent Registry] GET item error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to fetch agent',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// PUT /api/admin/agents/[id]
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = (await request.json()) as UpdateAgentInput;

    if (body.roleFamily !== undefined && !VALID_ROLES.includes(body.roleFamily)) {
      return NextResponse.json<ApiError>(
        {
          error: `roleFamily must be one of: ${VALID_ROLES.join(', ')}`,
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    const agent = await updateAgent(id, body);

    if (!agent) {
      return NextResponse.json<ApiError>(
        { error: 'Agent not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json({ agent });
  } catch (error) {
    console.error('[Agent Registry] PUT error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to update agent',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/agents/[id]
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const deleted = await deleteAgent(id);

    if (!deleted) {
      return NextResponse.json<ApiError>(
        { error: 'Agent not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Agent Registry] DELETE error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to delete agent',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

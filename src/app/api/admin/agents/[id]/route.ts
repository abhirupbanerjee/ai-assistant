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
import { getEnabledModel } from '@/lib/db/compat/enabled-models';
import { AVAILABLE_TOOLS } from '@/lib/tools';
import type { ApiError } from '@/types';

/**
 * Validate that the bound model satisfies tool capability requirements.
 * Returns an array of warning strings (empty if all checks pass).
 * This is a soft guard — warnings are returned alongside the agent but
 * do not block creation/update.
 */
async function validateModelCapabilities(
  toolAllowlist: string[] | undefined,
  modelId: string | null | undefined
): Promise<string[]> {
  const warnings: string[] = [];
  if (!toolAllowlist || toolAllowlist.length === 0 || !modelId) return warnings;

  let minContext = 0;
  for (const toolName of toolAllowlist) {
    const tool = AVAILABLE_TOOLS[toolName];
    if (tool?.modelRequirements?.minimumContextTokens) {
      minContext = Math.max(minContext, tool.modelRequirements.minimumContextTokens);
    }
  }

  if (minContext > 0) {
    const model = await getEnabledModel(modelId);
    if (model && model.maxInputTokens != null && model.maxInputTokens < minContext) {
      warnings.push(
        `Model "${model.displayName}" has max input ${model.maxInputTokens.toLocaleString()} tokens, but selected tools require at least ${minContext.toLocaleString()}. Consider a larger-context model.`
      );
    }
  }

  return warnings;
}

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

    // Soft capability validation — warns if bound model can't satisfy tool requirements.
    // When modelId is not provided in the update, fall back to the existing agent's bound model.
    let modelIdToCheck = body.modelId;
    if (modelIdToCheck === undefined || modelIdToCheck === null) {
      const existing = await getAgentById(id);
      modelIdToCheck = existing?.modelId ?? null;
    }
    const warnings = await validateModelCapabilities(body.toolAllowlist, modelIdToCheck);

    const agent = await updateAgent(id, body);

    if (!agent) {
      return NextResponse.json<ApiError>(
        { error: 'Agent not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json({ agent, warnings: warnings.length > 0 ? warnings : undefined });
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

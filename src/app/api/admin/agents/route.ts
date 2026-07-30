/**
 * Agent Registry API
 *
 * GET  - List all registered agents (optionally filtered by category or role)
 * POST - Create a new agent
 *
 * Phase 1 Agent System foundations (see
 * plans/agent_system_architecture___implementation_plan.md).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  listAgents,
  getAgentsForCategory,
  getAgentsByRoleFamily,
  createAgent,
  type AgentRoleFamily,
  type CreateAgentInput,
} from '@/lib/db/compat';
import { getEnabledModel } from '@/lib/db/compat/enabled-models';
import { AVAILABLE_TOOLS } from '@/lib/tools';
import type { ApiError } from '@/types';

const VALID_ROLES: AgentRoleFamily[] = [
  'planner',
  'executor',
  'critic',
  'researcher',
  'presenter',
];

/**
 * Agent ids become OpenAI function tool names via `agent__<id>` (see
 * src/lib/agent-registry/agent-tools.ts). OpenAI requires function names to
 * match `^[a-zA-Z0-9_-]+$` and be ≤64 chars. The `agent__` prefix is 7 chars,
 * so the id itself must be ≤57 chars and match the same charset.
 */
const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const AGENT_ID_MAX_LENGTH = 57;

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

  // Compute union of minimumContextTokens across selected tools
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

// GET /api/admin/agents
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const categoryIdParam = searchParams.get('categoryId');
    const roleParam = searchParams.get('role');

    if (categoryIdParam) {
      const categoryId = parseInt(categoryIdParam, 10);
      if (Number.isNaN(categoryId)) {
        return NextResponse.json<ApiError>(
          { error: 'categoryId must be a number', code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }
      const agents = await getAgentsForCategory(categoryId);
      return NextResponse.json({ agents });
    }

    if (roleParam) {
      if (!VALID_ROLES.includes(roleParam as AgentRoleFamily)) {
        return NextResponse.json<ApiError>(
          {
            error: `role must be one of: ${VALID_ROLES.join(', ')}`,
            code: 'VALIDATION_ERROR',
          },
          { status: 400 }
        );
      }
      const agents = await getAgentsByRoleFamily(roleParam as AgentRoleFamily);
      return NextResponse.json({ agents });
    }

    const agents = await listAgents();
    return NextResponse.json({ agents });
  } catch (error) {
    console.error('[Agent Registry] GET error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to fetch agents',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// POST /api/admin/agents
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const body = (await request.json()) as CreateAgentInput;

    if (!body.id || !body.name || !body.roleFamily) {
      return NextResponse.json<ApiError>(
        {
          error: 'id, name, and roleFamily are required',
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    if (!VALID_ROLES.includes(body.roleFamily)) {
      return NextResponse.json<ApiError>(
        {
          error: `roleFamily must be one of: ${VALID_ROLES.join(', ')}`,
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    // Agent ids are used to build OpenAI function tool names (`agent__<id>`),
    // so they must match the function-name charset and length budget.
    if (
      typeof body.id !== 'string' ||
      !AGENT_ID_PATTERN.test(body.id) ||
      body.id.length > AGENT_ID_MAX_LENGTH
    ) {
      return NextResponse.json<ApiError>(
        {
          error: `id must match ${AGENT_ID_PATTERN} and be ≤${AGENT_ID_MAX_LENGTH} chars (used to build the agent__<id> OpenAI function name)`,
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    // Soft capability validation — warns if bound model can't satisfy tool requirements
    const warnings = await validateModelCapabilities(body.toolAllowlist, body.modelId);

    const agent = await createAgent(body);

    return NextResponse.json({ agent, warnings: warnings.length > 0 ? warnings : undefined }, { status: 201 });
  } catch (error) {
    console.error('[Agent Registry] POST error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to create agent',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

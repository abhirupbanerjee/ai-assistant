/**
 * Public Agent List API — @ mention autocomplete
 *
 * GET /api/chat/agents?categoryId= - List enabled agents for the chat mention menu
 *
 * Category-scoped when categoryId is provided (matches the runtime tool-list
 * scoping in tools.ts:getToolDefinitions). No MAX_AGENT_TOOLS cap — the menu
 * is UI, not the LLM function-tool list.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listEnabledAgents, getAgentsForCategory } from '@/lib/db/compat';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const categoryIdParam = searchParams.get('categoryId');

    let agents;
    if (categoryIdParam) {
      const categoryId = parseInt(categoryIdParam, 10);
      if (Number.isNaN(categoryId)) {
        return NextResponse.json(
          { error: 'categoryId must be a number', code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }
      agents = await getAgentsForCategory(categoryId);
    } else {
      agents = await listEnabledAgents();
    }

    // Only expose safe fields — id, name, roleFamily, and categoryId for scoping
    const result = agents.map((a) => ({
      id: a.id,
      name: a.name,
      roleFamily: a.roleFamily,
      categoryId: a.categoryId,
    }));

    return NextResponse.json({ agents: result });
  } catch (error) {
    console.error('[Agent Mention API] Failed to fetch agents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}

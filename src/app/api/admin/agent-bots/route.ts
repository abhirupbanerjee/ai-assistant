/**
 * Admin Agent Bots API
 *
 * GET /api/admin/agent-bots - List all agent bots
 * POST /api/admin/agent-bots - Create new agent bot
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  listAgentBots,
  createAgentBot,
  agentBotSlugExists as slugExists,
  agentBotNameExists as nameExists,
} from '@/lib/db/compat';
import { requireElevated } from '@/lib/auth';
import type { AgentBot } from '@/types/agent-bot';

// ============================================================================
// GET - List Agent Bots
// ============================================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireElevated();
    const agentBots = await listAgentBots();
    return NextResponse.json({ agentBots });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error listing agent bots:', error);
    return NextResponse.json(
      { error: 'Failed to list agent bots' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Create Agent Bot
// ============================================================================

interface CreateAgentBotRequest {
  name: string;
  slug?: string;
  description?: string;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireElevated();
    const body: CreateAgentBotRequest = await request.json();

    // Validate required fields
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }

    const name = body.name.trim();
    if (name.length < 2 || name.length > 100) {
      return NextResponse.json(
        { error: 'Name must be between 2 and 100 characters' },
        { status: 400 }
      );
    }

    // Check if name already exists
    if (await nameExists(name)) {
      return NextResponse.json(
        { error: 'An agent bot with this name already exists' },
        { status: 409 }
      );
    }

    // Generate or validate slug
    const slug = body.slug?.trim() || generateSlug(name);
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug)) {
      return NextResponse.json(
        { error: 'Slug must be lowercase alphanumeric with hyphens, not starting or ending with hyphen' },
        { status: 400 }
      );
    }

    // Check if slug already exists
    if (await slugExists(slug)) {
      return NextResponse.json(
        { error: 'An agent bot with this slug already exists' },
        { status: 409 }
      );
    }

    // Create the agent bot
    const agentBot = await createAgentBot(
      {
        name,
        slug,
        description: body.description?.trim() || undefined,
      },
      user.email,
      user.role
    );

    return NextResponse.json({ agentBot }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error creating agent bot:', error);
    return NextResponse.json(
      { error: 'Failed to create agent bot' },
      { status: 500 }
    );
  }
}

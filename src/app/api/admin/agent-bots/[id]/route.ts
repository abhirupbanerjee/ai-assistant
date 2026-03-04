/**
 * Admin Agent Bot API
 *
 * GET /api/admin/agent-bots/[id] - Get agent bot details
 * PATCH /api/admin/agent-bots/[id] - Update agent bot
 * DELETE /api/admin/agent-bots/[id] - Delete agent bot
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAgentBotById,
  updateAgentBot,
  deleteAgentBot,
  agentBotSlugExists as slugExists,
  agentBotNameExists as nameExists,
  listVersions,
  listApiKeys,
} from '@/lib/db/compat';
import { requireElevated } from '@/lib/auth';

// ============================================================================
// GET - Get Agent Bot Details
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    await requireElevated();
    const { id } = await params;

    const agentBot = await getAgentBotById(id);
    if (!agentBot) {
      return NextResponse.json(
        { error: 'Agent bot not found' },
        { status: 404 }
      );
    }

    // Get associated data
    const versions = await listVersions(id);
    const apiKeys = await listApiKeys(id);

    return NextResponse.json({
      agentBot,
      versions,
      apiKeys: apiKeys.map((key) => ({
        ...key,
        // Don't expose the hash
        key_hash: undefined,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error getting agent bot:', error);
    return NextResponse.json(
      { error: 'Failed to get agent bot' },
      { status: 500 }
    );
  }
}

// ============================================================================
// PATCH - Update Agent Bot
// ============================================================================

interface UpdateAgentBotRequest {
  name?: string;
  slug?: string;
  description?: string;
  is_active?: boolean;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    await requireElevated();
    const { id } = await params;

    const agentBot = await getAgentBotById(id);
    if (!agentBot) {
      return NextResponse.json(
        { error: 'Agent bot not found' },
        { status: 404 }
      );
    }

    const body: UpdateAgentBotRequest = await request.json();
    const updates: {
      name?: string;
      slug?: string;
      description?: string;
      is_active?: boolean;
    } = {};

    // Validate and set name
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (name.length < 2 || name.length > 100) {
        return NextResponse.json(
          { error: 'Name must be between 2 and 100 characters' },
          { status: 400 }
        );
      }
      // Check for duplicates (excluding current)
      if (await nameExists(name, id)) {
        return NextResponse.json(
          { error: 'An agent bot with this name already exists' },
          { status: 409 }
        );
      }
      updates.name = name;
    }

    // Validate and set slug
    if (body.slug !== undefined) {
      const slug = body.slug.trim();
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug)) {
        return NextResponse.json(
          { error: 'Slug must be lowercase alphanumeric with hyphens' },
          { status: 400 }
        );
      }
      // Check for duplicates (excluding current)
      if (await slugExists(slug, id)) {
        return NextResponse.json(
          { error: 'An agent bot with this slug already exists' },
          { status: 409 }
        );
      }
      updates.slug = slug;
    }

    // Set description
    if (body.description !== undefined) {
      updates.description = body.description.trim() || undefined;
    }

    // Set active status
    if (body.is_active !== undefined) {
      updates.is_active = body.is_active;
    }

    // Update the agent bot
    const updated = await updateAgentBot(id, updates);
    if (!updated) {
      return NextResponse.json(
        { error: 'Failed to update agent bot' },
        { status: 500 }
      );
    }

    return NextResponse.json({ agentBot: updated });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error updating agent bot:', error);
    return NextResponse.json(
      { error: 'Failed to update agent bot' },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE - Delete Agent Bot
// ============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    await requireElevated();
    const { id } = await params;

    const agentBot = await getAgentBotById(id);
    if (!agentBot) {
      return NextResponse.json(
        { error: 'Agent bot not found' },
        { status: 404 }
      );
    }

    // Delete the agent bot (cascades to versions, api keys, jobs)
    const deleted = await deleteAgentBot(id);
    if (!deleted) {
      return NextResponse.json(
        { error: 'Failed to delete agent bot' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error deleting agent bot:', error);
    return NextResponse.json(
      { error: 'Failed to delete agent bot' },
      { status: 500 }
    );
  }
}

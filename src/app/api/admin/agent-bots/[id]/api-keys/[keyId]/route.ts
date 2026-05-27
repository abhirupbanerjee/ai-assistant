/**
 * Admin Agent Bot API Key API
 *
 * GET    /api/admin/agent-bots/[id]/api-keys/[keyId] - Reveal API key
 * DELETE /api/admin/agent-bots/[id]/api-keys/[keyId] - Revoke API key
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAgentBotById,
  getApiKeyById,
  revokeApiKey,
  getRevealedApiKey,
} from '@/lib/db/compat';
import { requireElevated } from '@/lib/auth';

// ============================================================================
// GET - Reveal API Key (decrypt and return full key)
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> }
): Promise<NextResponse> {
  try {
    const user = await requireElevated();
    const { id, keyId } = await params;

    const agentBot = await getAgentBotById(id);
    if (!agentBot) {
      return NextResponse.json(
        { error: 'Agent bot not found' },
        { status: 404 }
      );
    }

    const result = await getRevealedApiKey(keyId, id, user.email);

    if ('error' in result) {
      const status = result.code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status }
      );
    }

    return NextResponse.json({
      fullKey: result.fullKey,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error revealing API key:', error);
    return NextResponse.json(
      { error: 'Failed to reveal API key' },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE - Revoke API Key
// ============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> }
): Promise<NextResponse> {
  try {
    await requireElevated();
    const { id, keyId } = await params;

    const agentBot = await getAgentBotById(id);
    if (!agentBot) {
      return NextResponse.json(
        { error: 'Agent bot not found' },
        { status: 404 }
      );
    }

    const apiKey = await getApiKeyById(keyId);
    if (!apiKey || apiKey.agent_bot_id !== id) {
      return NextResponse.json(
        { error: 'API key not found' },
        { status: 404 }
      );
    }

    if (!apiKey.is_active) {
      return NextResponse.json(
        { error: 'API key is already revoked' },
        { status: 400 }
      );
    }

    const revoked = await revokeApiKey(keyId);
    if (!revoked) {
      return NextResponse.json(
        { error: 'Failed to revoke API key' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error revoking API key:', error);
    return NextResponse.json(
      { error: 'Failed to revoke API key' },
      { status: 500 }
    );
  }
}

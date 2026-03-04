/**
 * Admin Agent Bot API Keys API
 *
 * GET /api/admin/agent-bots/[id]/api-keys - List API keys
 * POST /api/admin/agent-bots/[id]/api-keys - Create new API key
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentBotById, listApiKeys, createApiKey } from '@/lib/db/compat';
import { requireElevated } from '@/lib/auth';

// ============================================================================
// GET - List API Keys
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

    const apiKeys = await listApiKeys(id);

    // Don't expose key hashes
    const safeKeys = apiKeys.map((key) => ({
      id: key.id,
      agent_bot_id: key.agent_bot_id,
      name: key.name,
      key_prefix: key.key_prefix,
      permissions: key.permissions,
      rate_limit_rpm: key.rate_limit_rpm,
      rate_limit_rpd: key.rate_limit_rpd,
      expires_at: key.expires_at,
      last_used_at: key.last_used_at,
      is_active: key.is_active,
      created_by: key.created_by,
      created_at: key.created_at,
      revoked_at: key.revoked_at,
    }));

    return NextResponse.json({ apiKeys: safeKeys });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error listing API keys:', error);
    return NextResponse.json(
      { error: 'Failed to list API keys' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Create API Key
// ============================================================================

interface CreateApiKeyRequest {
  name: string;
  permissions?: string[];
  rate_limit_rpm?: number;
  rate_limit_rpd?: number;
  expires_in_days?: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await requireElevated();
    const { id } = await params;

    const agentBot = await getAgentBotById(id);
    if (!agentBot) {
      return NextResponse.json(
        { error: 'Agent bot not found' },
        { status: 404 }
      );
    }

    const body: CreateApiKeyRequest = await request.json();

    // Validate name
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

    // Validate rate limits
    const rateLimitRpm = body.rate_limit_rpm ?? 60;
    const rateLimitRpd = body.rate_limit_rpd ?? 1000;

    if (rateLimitRpm < 1 || rateLimitRpm > 1000) {
      return NextResponse.json(
        { error: 'Rate limit per minute must be between 1 and 1000' },
        { status: 400 }
      );
    }

    if (rateLimitRpd < 1 || rateLimitRpd > 100000) {
      return NextResponse.json(
        { error: 'Rate limit per day must be between 1 and 100000' },
        { status: 400 }
      );
    }

    // Create the API key
    const result = await createApiKey(
      id,
      {
        name,
        rate_limit_rpm: rateLimitRpm,
        rate_limit_rpd: rateLimitRpd,
        expires_in_days: body.expires_in_days,
      },
      user.email
    );

    // Return the full key - this is the only time it's shown
    return NextResponse.json(
      {
        apiKey: {
          id: result.apiKey.id,
          agent_bot_id: result.apiKey.agent_bot_id,
          name: result.apiKey.name,
          key_prefix: result.apiKey.key_prefix,
          permissions: result.apiKey.permissions,
          rate_limit_rpm: result.apiKey.rate_limit_rpm,
          rate_limit_rpd: result.apiKey.rate_limit_rpd,
          expires_at: result.apiKey.expires_at,
          is_active: result.apiKey.is_active,
          created_by: result.apiKey.created_by,
          created_at: result.apiKey.created_at,
        },
        fullKey: result.fullKey,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error creating API key:', error);
    return NextResponse.json(
      { error: 'Failed to create API key' },
      { status: 500 }
    );
  }
}

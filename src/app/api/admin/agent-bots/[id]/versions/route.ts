/**
 * Admin Agent Bot Versions API
 *
 * GET /api/admin/agent-bots/[id]/versions - List versions
 * POST /api/admin/agent-bots/[id]/versions - Create new version
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentBotById, listVersions, createVersion } from '@/lib/db/compat';
import { requireElevated } from '@/lib/auth';
import type { InputSchema, OutputConfig } from '@/types/agent-bot';

// ============================================================================
// GET - List Versions
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

    const versions = await listVersions(id);
    return NextResponse.json({ versions });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error listing versions:', error);
    return NextResponse.json(
      { error: 'Failed to list versions' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Create Version
// ============================================================================

interface CreateVersionRequest {
  version_label?: string;
  is_default?: boolean;
  input_schema: InputSchema;
  output_config: OutputConfig;
  system_prompt?: string;
  llm_model?: string;
  temperature?: number;
  max_tokens?: number;
  category_ids?: number[];
  skill_ids?: number[];
  tools?: Array<{
    tool_name: string;
    is_enabled: boolean;
    config_override?: Record<string, unknown>;
  }>;
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

    const body: CreateVersionRequest = await request.json();

    // Validate input schema
    if (!body.input_schema || !body.input_schema.parameters) {
      return NextResponse.json(
        { error: 'Input schema with parameters is required' },
        { status: 400 }
      );
    }

    // Validate output config
    if (!body.output_config || !body.output_config.enabledTypes || !body.output_config.defaultType) {
      return NextResponse.json(
        { error: 'Output config with enabledTypes and defaultType is required' },
        { status: 400 }
      );
    }

    // Ensure default type is in enabled types
    if (!body.output_config.enabledTypes.includes(body.output_config.defaultType)) {
      return NextResponse.json(
        { error: 'Default output type must be in enabled types' },
        { status: 400 }
      );
    }

    // Create the version
    const version = await createVersion(
      id,
      {
        version_label: body.version_label,
        is_default: body.is_default,
        input_schema: body.input_schema,
        output_config: body.output_config,
        system_prompt: body.system_prompt,
        llm_model: body.llm_model,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
        category_ids: body.category_ids || [],
        skill_ids: body.skill_ids || [],
        tools: body.tools || [],
      },
      user.email
    );

    return NextResponse.json({ version }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error creating version:', error);
    return NextResponse.json(
      { error: 'Failed to create version' },
      { status: 500 }
    );
  }
}

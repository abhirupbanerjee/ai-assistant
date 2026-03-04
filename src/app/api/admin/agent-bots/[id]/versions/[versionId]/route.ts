/**
 * Admin Agent Bot Version API
 *
 * GET /api/admin/agent-bots/[id]/versions/[versionId] - Get version details
 * PATCH /api/admin/agent-bots/[id]/versions/[versionId] - Update version
 * DELETE /api/admin/agent-bots/[id]/versions/[versionId] - Delete version
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAgentBotById,
  getVersionById,
  getVersionWithRelations,
  updateVersion,
  deleteVersion,
  setDefaultVersion,
} from '@/lib/db/compat';
import { requireElevated } from '@/lib/auth';
import type { InputSchema, OutputConfig } from '@/types/agent-bot';

// ============================================================================
// GET - Get Version Details
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
): Promise<NextResponse> {
  try {
    await requireElevated();
    const { id, versionId } = await params;

    const agentBot = await getAgentBotById(id);
    if (!agentBot) {
      return NextResponse.json(
        { error: 'Agent bot not found' },
        { status: 404 }
      );
    }

    const version = await getVersionWithRelations(versionId);
    if (!version || version.agent_bot_id !== id) {
      return NextResponse.json(
        { error: 'Version not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ version });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error getting version:', error);
    return NextResponse.json(
      { error: 'Failed to get version' },
      { status: 500 }
    );
  }
}

// ============================================================================
// PATCH - Update Version
// ============================================================================

interface UpdateVersionRequest {
  version_label?: string;
  is_default?: boolean;
  is_active?: boolean;
  input_schema?: InputSchema;
  output_config?: OutputConfig;
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
): Promise<NextResponse> {
  try {
    await requireElevated();
    const { id, versionId } = await params;

    const agentBot = await getAgentBotById(id);
    if (!agentBot) {
      return NextResponse.json(
        { error: 'Agent bot not found' },
        { status: 404 }
      );
    }

    const version = await getVersionById(versionId);
    if (!version || version.agent_bot_id !== id) {
      return NextResponse.json(
        { error: 'Version not found' },
        { status: 404 }
      );
    }

    const body: UpdateVersionRequest = await request.json();

    // Validate output config if provided
    if (body.output_config) {
      if (!body.output_config.enabledTypes || !body.output_config.defaultType) {
        return NextResponse.json(
          { error: 'Output config must have enabledTypes and defaultType' },
          { status: 400 }
        );
      }
      if (!body.output_config.enabledTypes.includes(body.output_config.defaultType)) {
        return NextResponse.json(
          { error: 'Default output type must be in enabled types' },
          { status: 400 }
        );
      }
    }

    // Handle setting as default
    if (body.is_default === true) {
      await setDefaultVersion(versionId);
    }

    // Update the version
    const updated = await updateVersion(versionId, {
      version_label: body.version_label,
      is_active: body.is_active,
      input_schema: body.input_schema,
      output_config: body.output_config,
      system_prompt: body.system_prompt,
      llm_model: body.llm_model,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      category_ids: body.category_ids,
      skill_ids: body.skill_ids,
      tools: body.tools,
    });

    if (!updated) {
      return NextResponse.json(
        { error: 'Failed to update version' },
        { status: 500 }
      );
    }

    // Get full version with relations
    const fullVersion = await getVersionWithRelations(versionId);

    return NextResponse.json({ version: fullVersion });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error updating version:', error);
    return NextResponse.json(
      { error: 'Failed to update version' },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE - Delete Version
// ============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
): Promise<NextResponse> {
  try {
    await requireElevated();
    const { id, versionId } = await params;

    const agentBot = await getAgentBotById(id);
    if (!agentBot) {
      return NextResponse.json(
        { error: 'Agent bot not found' },
        { status: 404 }
      );
    }

    const version = await getVersionById(versionId);
    if (!version || version.agent_bot_id !== id) {
      return NextResponse.json(
        { error: 'Version not found' },
        { status: 404 }
      );
    }

    // Don't allow deleting the default version if it's the only one
    if (version.is_default) {
      return NextResponse.json(
        { error: 'Cannot delete the default version. Set another version as default first.' },
        { status: 400 }
      );
    }

    const deleted = await deleteVersion(versionId);
    if (!deleted) {
      return NextResponse.json(
        { error: 'Failed to delete version' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error deleting version:', error);
    return NextResponse.json(
      { error: 'Failed to delete version' },
      { status: 500 }
    );
  }
}

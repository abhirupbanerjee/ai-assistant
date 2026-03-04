/**
 * Admin Workspace CRUD API
 *
 * GET    /api/admin/workspaces/[id] - Get workspace details
 * PATCH  /api/admin/workspaces/[id] - Update workspace
 * DELETE /api/admin/workspaces/[id] - Delete workspace
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  getWorkspaceById,
  updateWorkspace,
  deleteWorkspace,
} from '@/lib/db/compat';
import { isWorkspacesFeatureEnabled } from '@/lib/workspace/validator';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { id } = await params;

    if (!(await isWorkspacesFeatureEnabled())) {
      return NextResponse.json(
        { error: 'Workspaces feature is disabled' },
        { status: 403 }
      );
    }

    const workspace = await getWorkspaceById(id);
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ workspace });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error fetching workspace:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workspace' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { id } = await params;

    if (!(await isWorkspacesFeatureEnabled())) {
      return NextResponse.json(
        { error: 'Workspaces feature is disabled' },
        { status: 403 }
      );
    }

    const workspace = await getWorkspaceById(id);
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const {
      name,
      isEnabled,
      categoryIds,
      // Branding
      primaryColor,
      logoUrl,
      chatTitle,
      greetingMessage,
      suggestedPrompts,
      footerText,
      // LLM overrides
      llmProvider,
      llmModel,
      temperature,
      systemPrompt,
      // Embed settings
      allowedDomains,
      dailyLimit,
      sessionLimit,
      // Features
      voiceEnabled,
      fileUploadEnabled,
      maxFileSizeMb,
      webSearchEnabled,
      // Authentication (embed only)
      authRequired,
      // Access mode
      accessMode,
    } = body;

    const updates: Record<string, unknown> = {};

    if (name !== undefined) updates.name = name;
    if (isEnabled !== undefined) updates.is_enabled = isEnabled;
    if (categoryIds !== undefined) updates.category_ids = categoryIds;
    if (primaryColor !== undefined) updates.primary_color = primaryColor;
    if (logoUrl !== undefined) updates.logo_url = logoUrl;
    if (chatTitle !== undefined) updates.chat_title = chatTitle;
    if (greetingMessage !== undefined) updates.greeting_message = greetingMessage;
    if (suggestedPrompts !== undefined) updates.suggested_prompts = suggestedPrompts;
    if (footerText !== undefined) updates.footer_text = footerText;
    if (llmProvider !== undefined) updates.llm_provider = llmProvider;
    if (llmModel !== undefined) updates.llm_model = llmModel;
    if (temperature !== undefined) updates.temperature = temperature;
    if (systemPrompt !== undefined) updates.system_prompt = systemPrompt;
    if (allowedDomains !== undefined) updates.allowed_domains = allowedDomains;
    if (dailyLimit !== undefined) updates.daily_limit = dailyLimit;
    if (sessionLimit !== undefined) updates.session_limit = sessionLimit;
    if (voiceEnabled !== undefined) updates.voice_enabled = voiceEnabled;
    if (fileUploadEnabled !== undefined) updates.file_upload_enabled = fileUploadEnabled;
    if (maxFileSizeMb !== undefined) updates.max_file_size_mb = maxFileSizeMb;
    if (webSearchEnabled !== undefined) updates.web_search_enabled = webSearchEnabled;
    if (authRequired !== undefined) updates.auth_required = authRequired;
    if (accessMode !== undefined) updates.access_mode = accessMode;

    const updatedWorkspace = await updateWorkspace(id, updates);

    return NextResponse.json({ workspace: updatedWorkspace });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error updating workspace:', error);
    return NextResponse.json(
      { error: 'Failed to update workspace' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { id } = await params;

    if (!(await isWorkspacesFeatureEnabled())) {
      return NextResponse.json(
        { error: 'Workspaces feature is disabled' },
        { status: 403 }
      );
    }

    const workspace = await getWorkspaceById(id);
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    await deleteWorkspace(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error deleting workspace:', error);
    return NextResponse.json(
      { error: 'Failed to delete workspace' },
      { status: 500 }
    );
  }
}

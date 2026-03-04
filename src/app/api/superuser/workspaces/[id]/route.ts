/**
 * SuperUser Workspace CRUD API
 *
 * GET    /api/superuser/workspaces/[id] - Get workspace details (only if created by superuser)
 * PATCH  /api/superuser/workspaces/[id] - Update workspace (only if created by superuser)
 * DELETE /api/superuser/workspaces/[id] - Delete workspace (only if created by superuser)
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserCategories } from '@/lib/db/compat';
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
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Super user access required' }, { status: 403 });
    }

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

    // Verify superuser created this workspace
    if (workspace.created_by !== user.email || workspace.created_by_role !== 'superuser') {
      return NextResponse.json(
        { error: 'You can only access workspaces you created' },
        { status: 403 }
      );
    }

    return NextResponse.json({ workspace });
  } catch (error) {
    console.error('Error fetching workspace:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workspace' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Super user access required' }, { status: 403 });
    }

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

    // Verify superuser created this workspace
    if (workspace.created_by !== user.email || workspace.created_by_role !== 'superuser') {
      return NextResponse.json(
        { error: 'You can only update workspaces you created' },
        { status: 403 }
      );
    }

    const userId = await getUserId(user.email);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get superuser's assigned categories for validation
    const assignedCategoryIds = await getSuperUserCategories(userId);

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
      // Access mode
      accessMode,
    } = body;

    // Validate category IDs if provided
    if (categoryIds !== undefined) {
      const invalidCategories = categoryIds.filter(
        (catId: number) => !assignedCategoryIds.includes(catId)
      );
      if (invalidCategories.length > 0) {
        return NextResponse.json(
          { error: 'You can only use categories assigned to you' },
          { status: 403 }
        );
      }
    }

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
    if (accessMode !== undefined) updates.access_mode = accessMode;

    const updatedWorkspace = await updateWorkspace(id, updates);

    return NextResponse.json({ workspace: updatedWorkspace });
  } catch (error) {
    console.error('Error updating workspace:', error);
    return NextResponse.json(
      { error: 'Failed to update workspace' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Super user access required' }, { status: 403 });
    }

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

    // Verify superuser created this workspace
    if (workspace.created_by !== user.email || workspace.created_by_role !== 'superuser') {
      return NextResponse.json(
        { error: 'You can only delete workspaces you created' },
        { status: 403 }
      );
    }

    await deleteWorkspace(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting workspace:', error);
    return NextResponse.json(
      { error: 'Failed to delete workspace' },
      { status: 500 }
    );
  }
}

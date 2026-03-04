/**
 * SuperUser Workspaces API
 *
 * GET  /api/superuser/workspaces - List workspaces (scoped to superuser's categories)
 * POST /api/superuser/workspaces - Create a new workspace (with superuser's categories only)
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserCategories } from '@/lib/db/compat';
import {
  listWorkspacesByCreator,
  createWorkspace,
  getWorkspaceBySlug,
} from '@/lib/db/compat';
import { isWorkspacesFeatureEnabled } from '@/lib/workspace/validator';
import type { WorkspaceType } from '@/types/workspace';

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Super user access required' }, { status: 403 });
    }

    // Check if feature is enabled
    if (!(await isWorkspacesFeatureEnabled())) {
      return NextResponse.json({
        workspaces: [],
        featureEnabled: false,
      });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as WorkspaceType | null;

    // Only show workspaces created by this superuser
    const allWorkspaces = await listWorkspacesByCreator(user.email);
    const workspaces = type ? allWorkspaces.filter(w => w.type === type) : allWorkspaces;

    return NextResponse.json({
      workspaces,
      featureEnabled: true,
    });
  } catch (error) {
    console.error('Error fetching workspaces:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workspaces' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Super user access required' }, { status: 403 });
    }

    // Check if feature is enabled
    if (!(await isWorkspacesFeatureEnabled())) {
      return NextResponse.json(
        { error: 'Workspaces feature is disabled' },
        { status: 403 }
      );
    }

    const userId = await getUserId(user.email);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get superuser's assigned categories
    const assignedCategoryIds = await getSuperUserCategories(userId);

    const body = await request.json();
    const {
      name,
      type,
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
      // Access mode (standalone only)
      accessMode,
    } = body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Workspace name is required' },
        { status: 400 }
      );
    }

    if (!type || !['embed', 'standalone'].includes(type)) {
      return NextResponse.json(
        { error: 'Valid workspace type (embed or standalone) is required' },
        { status: 400 }
      );
    }

    if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one category must be selected' },
        { status: 400 }
      );
    }

    // Validate that all selected categories are in superuser's assigned categories
    const invalidCategories = categoryIds.filter(
      (id: number) => !assignedCategoryIds.includes(id)
    );
    if (invalidCategories.length > 0) {
      return NextResponse.json(
        { error: 'You can only create workspaces with categories assigned to you' },
        { status: 403 }
      );
    }

    // Create workspace
    const workspace = await createWorkspace(
      {
        name: name.trim(),
        type,
        category_ids: categoryIds,
        primary_color: primaryColor || '#2563eb',
        logo_url: logoUrl || null,
        chat_title: chatTitle || null,
        greeting_message: greetingMessage || 'How can I help you today?',
        suggested_prompts: suggestedPrompts || null,
        footer_text: footerText || null,
        llm_provider: llmProvider || null,
        llm_model: llmModel || null,
        temperature: temperature ?? null,
        system_prompt: systemPrompt || null,
        allowed_domains: allowedDomains || [],
        daily_limit: dailyLimit ?? 1000,
        session_limit: sessionLimit ?? 50,
        voice_enabled: voiceEnabled ?? false,
        file_upload_enabled: fileUploadEnabled ?? false,
        max_file_size_mb: maxFileSizeMb ?? 5,
        web_search_enabled: webSearchEnabled ?? true,
        access_mode: accessMode || 'category',
      },
      user.email,
      'superuser'
    );

    // Get full workspace with relations for response
    const fullWorkspace = await getWorkspaceBySlug(workspace.slug);

    return NextResponse.json({ workspace: fullWorkspace }, { status: 201 });
  } catch (error) {
    console.error('Error creating workspace:', error);
    return NextResponse.json(
      { error: 'Failed to create workspace' },
      { status: 500 }
    );
  }
}

/**
 * Admin Workspaces API
 *
 * GET  /api/admin/workspaces - List all workspaces
 * POST /api/admin/workspaces - Create a new workspace
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  listWorkspaces,
  createWorkspace,
  getWorkspaceBySlug,
} from '@/lib/db/compat';
import { isWorkspacesFeatureEnabled } from '@/lib/workspace/validator';
import type { WorkspaceType } from '@/types/workspace';

export async function GET(request: Request) {
  try {
    await requireAdmin();

    // Check if feature is enabled
    if (!(await isWorkspacesFeatureEnabled())) {
      return NextResponse.json({
        workspaces: [],
        featureEnabled: false,
      });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as WorkspaceType | null;

    const workspaces = await listWorkspaces(type || undefined);

    return NextResponse.json({
      workspaces,
      featureEnabled: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error fetching workspaces:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workspaces' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();

    // Check if feature is enabled
    if (!(await isWorkspacesFeatureEnabled())) {
      return NextResponse.json(
        { error: 'Workspaces feature is disabled' },
        { status: 403 }
      );
    }

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
      // Authentication (embed only)
      authRequired,
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
        auth_required: authRequired ?? false,
        access_mode: accessMode || 'category',
      },
      admin.email,
      'admin'
    );

    // Get full workspace with relations for response
    const fullWorkspace = await getWorkspaceBySlug(workspace.slug);

    return NextResponse.json({ workspace: fullWorkspace }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error creating workspace:', error);
    return NextResponse.json(
      { error: 'Failed to create workspace' },
      { status: 500 }
    );
  }
}

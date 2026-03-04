import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSystemPrompt, setSystemPrompt, getSettingMetadata, deleteSetting, getDefaultSystemPrompt } from '@/lib/db/compat';
import { invalidateQueryCache } from '@/lib/redis';
import type { ApiError } from '@/types';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const prompt = await getSystemPrompt();
    const meta = await getSettingMetadata('system-prompt');

    return NextResponse.json({
      prompt,
      updatedAt: meta?.updatedAt || new Date().toISOString(),
      updatedBy: meta?.updatedBy || 'system',
    });
  } catch (error) {
    console.error('Get system prompt error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to get system prompt',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { prompt } = body;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json<ApiError>(
        { error: 'Prompt is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    if (prompt.trim().length < 10) {
      return NextResponse.json<ApiError>(
        { error: 'Prompt must be at least 10 characters', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    await setSystemPrompt(prompt.trim(), user.email);
    const meta = await getSettingMetadata('system-prompt');

    // Invalidate query cache since system prompt changed
    await invalidateQueryCache();

    return NextResponse.json({
      success: true,
      config: {
        prompt: prompt.trim(),
        updatedAt: meta?.updatedAt || new Date().toISOString(),
        updatedBy: meta?.updatedBy || user.email,
      },
    });
  } catch (error) {
    console.error('Update system prompt error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to update system prompt',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    // Delete system prompt from SQLite to fall back to JSON config default
    await deleteSetting('system-prompt');

    // Get the default prompt from config
    const defaultPrompt = await getDefaultSystemPrompt();

    // Invalidate query cache since system prompt changed
    await invalidateQueryCache();

    return NextResponse.json({
      success: true,
      prompt: defaultPrompt,
      updatedAt: new Date().toISOString(),
      updatedBy: 'system',
    });
  } catch (error) {
    console.error('Reset system prompt error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to reset system prompt',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

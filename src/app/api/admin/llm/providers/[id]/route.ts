/**
 * Single LLM Provider API
 *
 * GET    - Get provider details
 * PUT    - Update provider
 * DELETE - Delete provider
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getProvider,
  updateProvider,
  deleteProvider,
  maskApiKey,
  type UpdateProviderInput,
} from '@/lib/db/compat/llm-providers';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/admin/llm/providers/[id]
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (user?.role !== 'admin' && user?.role !== 'superuser') {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const provider = await getProvider(id);

    if (!provider) {
      return NextResponse.json<ApiError>(
        { error: 'Provider not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      provider: {
        ...provider,
        apiKey: maskApiKey(provider.apiKey),
        apiKeyConfigured: !!provider.apiKey,
      },
    });
  } catch (error) {
    console.error('[LLM Provider] GET error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to fetch provider',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// PUT /api/admin/llm/providers/[id]
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json() as UpdateProviderInput;

    const provider = await updateProvider(id, body);

    if (!provider) {
      return NextResponse.json<ApiError>(
        { error: 'Provider not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      provider: {
        ...provider,
        apiKey: maskApiKey(provider.apiKey),
        apiKeyConfigured: !!provider.apiKey,
      },
    });
  } catch (error) {
    console.error('[LLM Provider] PUT error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to update provider',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/llm/providers/[id]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { id } = await params;

    // Don't allow deleting core providers, just clear their config
    const coreProviders = ['openai', 'gemini', 'mistral', 'ollama', 'anthropic', 'deepseek', 'fireworks'];
    if (coreProviders.includes(id)) {
      // Clear API key instead of deleting
      const provider = await updateProvider(id, { apiKey: '', apiBase: '', enabled: false });
      if (!provider) {
        return NextResponse.json<ApiError>(
          { error: 'Provider not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }
      return NextResponse.json({
        message: 'Provider configuration cleared',
        provider: {
          ...provider,
          apiKey: maskApiKey(provider.apiKey),
          apiKeyConfigured: false,
        },
      });
    }

    const deleted = await deleteProvider(id);
    if (!deleted) {
      return NextResponse.json<ApiError>(
        { error: 'Provider not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: 'Provider deleted successfully' });
  } catch (error) {
    console.error('[LLM Provider] DELETE error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to delete provider',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

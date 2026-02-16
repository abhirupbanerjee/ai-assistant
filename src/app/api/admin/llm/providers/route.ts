/**
 * LLM Providers API
 *
 * GET  - List all providers
 * POST - Create new provider
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getAllProviders,
  createProvider,
  maskApiKey,
  type CreateProviderInput,
} from '@/lib/db/llm-providers';
import type { ApiError } from '@/types';

// GET /api/admin/llm/providers - List all providers
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const providers = getAllProviders();

    // Mask API keys for security
    const safeProviders = providers.map(p => ({
      ...p,
      apiKey: maskApiKey(p.apiKey),
      apiKeyConfigured: !!p.apiKey,
    }));

    return NextResponse.json({ providers: safeProviders });
  } catch (error) {
    console.error('[LLM Providers] GET error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to fetch providers',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// POST /api/admin/llm/providers - Create new provider
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const body = await request.json() as CreateProviderInput;

    // Validate required fields
    if (!body.id || !body.name) {
      return NextResponse.json<ApiError>(
        { error: 'Provider ID and name are required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const provider = createProvider(body);

    return NextResponse.json({
      provider: {
        ...provider,
        apiKey: maskApiKey(provider.apiKey),
        apiKeyConfigured: !!provider.apiKey,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[LLM Providers] POST error:', error);

    // Check for duplicate key error
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      return NextResponse.json<ApiError>(
        { error: 'Provider already exists', code: 'DUPLICATE_ERROR' },
        { status: 409 }
      );
    }

    return NextResponse.json<ApiError>(
      {
        error: 'Failed to create provider',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

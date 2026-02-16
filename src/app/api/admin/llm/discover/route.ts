/**
 * Model Discovery API
 *
 * GET - Discover available models from a provider or all providers
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { discoverModels, discoverAllModels } from '@/lib/services/model-discovery';
import type { ApiError } from '@/types';

// GET /api/admin/llm/discover?provider=openai
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');

    if (provider) {
      // Discover models from specific provider
      const result = await discoverModels(provider);
      return NextResponse.json(result);
    }

    // Discover models from all configured providers
    const result = await discoverAllModels();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Model Discovery] GET error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to discover models',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

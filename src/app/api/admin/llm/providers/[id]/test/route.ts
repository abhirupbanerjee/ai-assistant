/**
 * Test Provider Connection API
 *
 * POST - Test provider connection by attempting to list models
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getProvider } from '@/lib/db/compat/llm-providers';
import { testProviderConnection } from '@/lib/services/model-discovery';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/admin/llm/providers/[id]/test
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
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

    const result = await testProviderConnection(id);

    return NextResponse.json({
      provider: id,
      ...result,
    });
  } catch (error) {
    console.error('[LLM Provider] Test error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to test provider connection',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

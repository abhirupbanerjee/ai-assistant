/**
 * Enabled Models API
 *
 * GET  - List all enabled models
 * POST - Enable new models (batch)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getAllEnabledModels,
  getActiveModels,
  createEnabledModelsBatch,
  type CreateEnabledModelInput,
} from '@/lib/db/enabled-models';
import type { ApiError } from '@/types';

// GET /api/admin/llm/models
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
    const activeOnly = searchParams.get('active') === 'true';

    const models = activeOnly ? getActiveModels() : getAllEnabledModels();

    return NextResponse.json({ models });
  } catch (error) {
    console.error('[Enabled Models] GET error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to fetch enabled models',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// POST /api/admin/llm/models
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const body = await request.json() as { models: CreateEnabledModelInput[] };

    if (!body.models || !Array.isArray(body.models) || body.models.length === 0) {
      return NextResponse.json<ApiError>(
        { error: 'Models array is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Validate each model has required fields
    for (const model of body.models) {
      if (!model.id || !model.providerId || !model.displayName) {
        return NextResponse.json<ApiError>(
          { error: 'Each model must have id, providerId, and displayName', code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }
    }

    const created = createEnabledModelsBatch(body.models);

    return NextResponse.json({
      message: `Added ${created.length} models`,
      models: created,
      skipped: body.models.length - created.length,
    });
  } catch (error) {
    console.error('[Enabled Models] POST error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to enable models',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * Enabled Models API
 *
 * GET  - List all enabled models
 * POST - Enable new models (batch)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, requireElevated } from '@/lib/auth';
import {
  getAllEnabledModels,
  getActiveModels,
  createEnabledModelsBatch,
  type CreateEnabledModelInput,
} from '@/lib/db/compat/enabled-models';
import { syncModelToLiteLLM } from '@/lib/services/litellm-sync';
import type { ApiError } from '@/types';

// GET /api/admin/llm/models
// Accessible by admins and superusers (needed for workspace model selector)
export async function GET(request: NextRequest) {
  try {
    await requireElevated();

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') === 'true';

    const models = activeOnly ? await getActiveModels() : await getAllEnabledModels();

    return NextResponse.json({ models });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json<ApiError>({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Elevated access required') {
      return NextResponse.json<ApiError>({ error: 'Elevated access required', code: 'ADMIN_REQUIRED' }, { status: 403 });
    }
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

    const created = await createEnabledModelsBatch(body.models);

    // Fire-and-forget: register new models with LiteLLM proxy
    for (const model of created) {
      syncModelToLiteLLM(model).catch(err =>
        console.warn(`[LiteLLM Sync] Failed to sync ${model.id}:`, err)
      );
    }

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

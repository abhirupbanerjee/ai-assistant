/**
 * Single Enabled Model API
 *
 * GET    - Get model details
 * PUT    - Update model (display name, default, enabled)
 * DELETE - Remove model
 *
 * Uses [...id] catch-all to handle model IDs that contain slashes
 * (e.g. fireworks/minimax-m2p5 → params.id = ['fireworks', 'minimax-m2p5'])
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getEnabledModel,
  updateEnabledModel,
  deleteEnabledModel,
  type UpdateEnabledModelInput,
} from '@/lib/db/compat/enabled-models';
import { setLlmSettings, getLlmSettings } from '@/lib/db/compat/config';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ id: string[] }>;
}

function resolveId(idParts: string[]): string {
  return idParts.join('/');
}

// GET /api/admin/llm/models/[...id]
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { id: idParts } = await params;
    const id = resolveId(idParts);
    const model = await getEnabledModel(id);

    if (!model) {
      return NextResponse.json<ApiError>(
        { error: 'Model not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json({ model });
  } catch (error) {
    console.error('[Enabled Model] GET error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to fetch model',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// PUT /api/admin/llm/models/[...id]
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { id: idParts } = await params;
    const id = resolveId(idParts);
    const body = await request.json() as UpdateEnabledModelInput;

    const model = await updateEnabledModel(id, body);

    if (!model) {
      return NextResponse.json<ApiError>(
        { error: 'Model not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Sync llm-settings.model when a new default is set
    if (body.isDefault) {
      try {
        const current = await getLlmSettings();
        if (current.model !== id) {
          await setLlmSettings({ model: id }, user.email);
        }
      } catch (err) {
        console.warn('[Enabled Model] Failed to sync llm-settings.model:', err);
      }
    }

    return NextResponse.json({ model });
  } catch (error) {
    console.error('[Enabled Model] PUT error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to update model',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/llm/models/[...id]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { id: idParts } = await params;
    const id = resolveId(idParts);
    const deleted = await deleteEnabledModel(id);

    if (!deleted) {
      return NextResponse.json<ApiError>(
        { error: 'Model not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: 'Model removed successfully' });
  } catch (error) {
    console.error('[Enabled Model] DELETE error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to remove model',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

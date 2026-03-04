/**
 * Single Enabled Model API
 *
 * GET    - Get model details
 * PUT    - Update model (display name, default, enabled)
 * DELETE - Remove model
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getEnabledModel,
  updateEnabledModel,
  deleteEnabledModel,
  type UpdateEnabledModelInput,
} from '@/lib/db/compat/enabled-models';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/admin/llm/models/[id]
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { id } = await params;
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

// PUT /api/admin/llm/models/[id]
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
    const body = await request.json() as UpdateEnabledModelInput;

    const model = await updateEnabledModel(id, body);

    if (!model) {
      return NextResponse.json<ApiError>(
        { error: 'Model not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
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

// DELETE /api/admin/llm/models/[id]
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

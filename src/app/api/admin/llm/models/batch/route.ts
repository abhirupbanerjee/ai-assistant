/**
 * Enabled Models Batch API
 *
 * DELETE - Remove multiple models by ID in a single request.
 *           The default model and the configured universal fallback model are
 *           always protected server-side, regardless of what the client sends,
 *           so the "Clear All" admin action can never strip the system of its
 *           required default/fallback models.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  deleteEnabledModelsBatch,
  getEnabledModel,
} from '@/lib/db/compat/enabled-models';
import { getLlmFallbackSettings } from '@/lib/db/compat';
import type { ApiError } from '@/types';

interface BatchDeleteBody {
  ids?: unknown;
}

// DELETE /api/admin/llm/models/batch
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({})) as BatchDeleteBody;
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json<ApiError>(
        { error: 'ids array is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Coerce to strings & dedupe
    const requestedIds = Array.from(
      new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))
    );

    if (requestedIds.length === 0) {
      return NextResponse.json<ApiError>(
        { error: 'ids array must contain non-empty strings', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // ---- Server-side protection of default & fallback models ----
    // Even if the client filters them out, we re-validate here so a buggy or
    // malicious client can never delete the system's default or fallback model.
    const fallbackSettings = await getLlmFallbackSettings().catch(() => null);
    const fallbackId = fallbackSettings?.universalFallback ?? null;

    const protectedIds = new Set<string>();
    if (fallbackId) protectedIds.add(fallbackId);

    const safeIds: string[] = [];
    for (const id of requestedIds) {
      if (protectedIds.has(id)) continue;
      const model = await getEnabledModel(id);
      if (!model) continue; // skip non-existent — nothing to delete
      if (model.isDefault) continue; // never delete the default
      safeIds.push(id);
    }

    if (safeIds.length === 0) {
      return NextResponse.json({
        message: 'No models were eligible for deletion (default/fallback preserved)',
        deleted: 0,
        skipped: requestedIds.length,
      });
    }

    const deleted = await deleteEnabledModelsBatch(safeIds);

    return NextResponse.json({
      message: `Removed ${deleted} model${deleted === 1 ? '' : 's'}`,
      deleted,
      skipped: requestedIds.length - deleted,
    });
  } catch (error) {
    console.error('[Enabled Models Batch] DELETE error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to remove models',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

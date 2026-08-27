/**
 * Organization Deployments API
 *
 * GET  /api/admin/organization-deployments
 *   List enabled models with catalog join (global baseline, org_id NULL).
 *
 * PUT  /api/admin/organization-deployments
 *   Enable/disable a model globally (checkbox action).
 *   Phase 0: any payload carrying a non-null org_id is rejected with HTTP 400.
 *
 * The existing POST /api/admin/llm/models and DELETE /api/admin/llm/models/:id
 * endpoints continue to call the compat write funnel (§7.3 item 4), which writes
 * organization_deployment + mirror transactionally.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getAllEnabledModels,
  enableModel,
  disableModel,
  setDefaultModel,
} from '@/lib/db/compat/enabled-models';
import type { ApiError } from '@/types';

// GET /api/admin/organization-deployments
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    // The compat layer already joins model_catalog + organization_deployment
    // when MODEL_CATALOG_READS is ON, or reads from enabled_models when OFF.
    // Either way, getAllEnabledModels returns the resolved view.
    const models = await getAllEnabledModels();

    return NextResponse.json({ deployments: models });
  } catch (error) {
    console.error('[Organization Deployments] GET error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to fetch organization deployments',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

// PUT /api/admin/organization-deployments
interface DeploymentUpdateBody {
  modelId: string;
  enabled?: boolean;
  isDefault?: boolean;
  sortOrder?: number;
  orgId?: string | null;
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const body = await request.json() as DeploymentUpdateBody;

    if (!body.modelId || typeof body.modelId !== 'string') {
      return NextResponse.json<ApiError>(
        { error: 'modelId is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Phase 0: reject any non-null org_id (per §7.4)
    if (body.orgId != null) {
      return NextResponse.json<ApiError>(
        {
          error: 'Per-organization deployments are not supported in Phase 0',
          code: 'ORG_DEPLOY_NOT_SUPPORTED',
        },
        { status: 400 }
      );
    }

    // Apply changes through the compat funnel (writes both legacy + catalog)
    if (body.isDefault === true) {
      const updated = await setDefaultModel(body.modelId);
      if (!updated) {
        return NextResponse.json<ApiError>(
          { error: 'Model not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }
      return NextResponse.json({ model: updated });
    }

    if (body.enabled === true) {
      const updated = await enableModel(body.modelId);
      if (!updated) {
        return NextResponse.json<ApiError>(
          { error: 'Model not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }
      return NextResponse.json({ model: updated });
    }

    if (body.enabled === false) {
      const updated = await disableModel(body.modelId);
      if (!updated) {
        return NextResponse.json<ApiError>(
          { error: 'Model not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }
      return NextResponse.json({ model: updated });
    }

    if (typeof body.sortOrder === 'number') {
      // Sort order updates go through the compat funnel's updateModelSortOrder
      // which expects an ordered array — but for a single model we use
      // updateEnabledModel via the compat layer
      const { updateEnabledModel } = await import('@/lib/db/compat/enabled-models');
      const updated = await updateEnabledModel(body.modelId, { sortOrder: body.sortOrder });
      if (!updated) {
        return NextResponse.json<ApiError>(
          { error: 'Model not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }
      return NextResponse.json({ model: updated });
    }

    return NextResponse.json<ApiError>(
      { error: 'No valid update fields provided (enabled, isDefault, sortOrder)', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Organization Deployments] PUT error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to update organization deployment',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

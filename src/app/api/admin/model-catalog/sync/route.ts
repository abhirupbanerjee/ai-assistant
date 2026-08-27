/**
 * Model Catalog Sync API
 *
 * POST /api/admin/model-catalog/sync?provider=X
 *   Trigger drift-detection sync from provider API (serialized per §5).
 *   If no ?provider=X, syncs all configured providers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { syncProviderCatalog, syncAllProviderCatalogs } from '@/lib/services/catalog-sync';
import type { ApiError } from '@/types';

// POST /api/admin/model-catalog/sync?provider=fireworks
export async function POST(request: NextRequest) {
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
      const result = await syncProviderCatalog(provider);
      return NextResponse.json(result);
    }

    // Sync all providers
    const results = await syncAllProviderCatalogs();
    return NextResponse.json({ results });
  } catch (error) {
    console.error('[Model Catalog Sync] POST error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to sync model catalog',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

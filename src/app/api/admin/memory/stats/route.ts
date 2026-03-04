import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getMemoryStats } from '@/lib/memory';
import { getMemorySettings } from '@/lib/db/compat';
import type { ApiError } from '@/types';

/**
 * GET /api/admin/memory/stats
 * Get memory system statistics for admin dashboard
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const settings = await getMemorySettings();
    const stats = await getMemoryStats();

    return NextResponse.json({
      enabled: settings.enabled,
      settings: {
        extractionThreshold: settings.extractionThreshold,
        maxFactsPerCategory: settings.maxFactsPerCategory,
        autoExtractOnThreadEnd: settings.autoExtractOnThreadEnd,
      },
      stats,
    });
  } catch (error) {
    console.error('Get memory stats error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to get memory statistics',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

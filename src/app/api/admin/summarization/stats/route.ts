import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSummarizationStats } from '@/lib/summarization';
import { getSummarizationSettings } from '@/lib/db/compat';
import type { ApiError } from '@/types';

/**
 * GET /api/admin/summarization/stats
 * Get summarization system statistics for admin dashboard
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

    const settings = await getSummarizationSettings();
    const stats = await getSummarizationStats();

    return NextResponse.json({
      enabled: settings.enabled,
      settings: {
        tokenThreshold: settings.tokenThreshold,
        keepRecentMessages: settings.keepRecentMessages,
        summaryMaxTokens: settings.summaryMaxTokens,
        archiveOriginalMessages: settings.archiveOriginalMessages,
      },
      stats,
    });
  } catch (error) {
    console.error('Get summarization stats error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to get summarization statistics',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

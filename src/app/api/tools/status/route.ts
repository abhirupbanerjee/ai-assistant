/**
 * Tools Status API
 * GET - Check which tools are enabled
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { isToolEnabled } from '@/lib/tools';
import type { ApiError } from '@/types';

/**
 * GET /api/tools/status
 * Returns enabled status of user-facing tools
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

    // Return status of user-facing tools
    return NextResponse.json({
      share_thread: {
        enabled: await isToolEnabled('share_thread'),
      },
      send_email: {
        enabled: await isToolEnabled('send_email'),
      },
    });
  } catch (error) {
    console.error('Tools status error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to get tool status', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * Backup Schedule API
 *
 * POST - Update schedule configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { setBackupScheduleConfig } from '@/lib/services/backup-scheduler';
import type { ApiError } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const config = await setBackupScheduleConfig(
      {
        enabled: body.enabled,
        hour: body.hour,
        retentionDays: body.retentionDays,
      },
      user.email
    );

    return NextResponse.json({ schedule: config });
  } catch (error) {
    console.error('[Backup Schedule] POST error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to update schedule', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * Backup Files API
 *
 * GET  - List saved backup files + schedule config
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getBackupFiles, getBackupScheduleConfig } from '@/lib/services/backup-scheduler';
import type { ApiError } from '@/types';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const [files, schedule] = await Promise.all([
      getBackupFiles(),
      getBackupScheduleConfig(),
    ]);

    return NextResponse.json({ files, schedule });
  } catch (error) {
    console.error('[Backup Files] GET error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to list backups', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

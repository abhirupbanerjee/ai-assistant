/**
 * Trigger Backup API
 *
 * POST - Trigger an immediate backup
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { runScheduledBackup } from '@/lib/services/backup-scheduler';
import type { ApiError } from '@/types';

export const maxDuration = 1800; // 30 minutes — must be static literal (Next.js 16 requirement)

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const result = await runScheduledBackup();
    if (!result) {
      return NextResponse.json<ApiError>(
        { error: 'Backup failed or already in progress', code: 'SERVICE_ERROR' },
        { status: 500 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Backup Trigger] POST error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to create backup', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

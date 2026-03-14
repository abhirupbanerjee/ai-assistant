/**
 * Single Backup File API
 *
 * DELETE - Delete a specific backup file
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { deleteBackupFile } from '@/lib/services/backup-scheduler';
import type { ApiError } from '@/types';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const { filename } = await params;
    const deleted = await deleteBackupFile(filename);
    if (!deleted) {
      return NextResponse.json<ApiError>(
        { error: 'Backup not found or invalid filename', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('[Backup File] DELETE error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to delete backup', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * Backup File Download API
 *
 * GET - Download a specific backup file
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { getCurrentUser } from '@/lib/auth';
import { getBackupFilePath } from '@/lib/services/backup-scheduler';
import type { ApiError } from '@/types';

export async function GET(
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
    const filePath = getBackupFilePath(filename);
    if (!filePath) {
      return NextResponse.json<ApiError>(
        { error: 'Invalid backup filename', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Check file exists
    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json<ApiError>(
        { error: 'Backup not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const stat = await fs.stat(filePath);
    const fileBuffer = await fs.readFile(filePath);

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(stat.size),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('[Backup File] Download error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to download backup', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

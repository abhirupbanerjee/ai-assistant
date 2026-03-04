/**
 * Admin - Folder Syncs List API
 * GET /api/admin/documents/folders - List all synced folders
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getAllFolderSyncs } from '@/lib/db/compat/folder-syncs';
import type { ApiError } from '@/types';

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

    const folderSyncs = await getAllFolderSyncs();

    return NextResponse.json({
      folders: folderSyncs,
      total: folderSyncs.length,
    });
  } catch (error) {
    console.error('List folder syncs error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to list folder syncs', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

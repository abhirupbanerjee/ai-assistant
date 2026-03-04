/**
 * Superuser - Folder Syncs List API
 * GET /api/superuser/documents/folders - List user's synced folders
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole } from '@/lib/users';
import { getFolderSyncsByUser } from '@/lib/db/compat/folder-syncs';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Super user access required' }, { status: 403 });
    }

    // Only get folders uploaded by this user
    const folderSyncs = await getFolderSyncsByUser(user.email);

    return NextResponse.json({
      folders: folderSyncs,
      total: folderSyncs.length,
    });
  } catch (error) {
    console.error('List folder syncs error:', error);
    return NextResponse.json(
      { error: 'Failed to list folder syncs' },
      { status: 500 }
    );
  }
}

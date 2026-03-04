/**
 * Admin Workspace User API
 *
 * DELETE /api/admin/workspaces/[id]/users/[userId] - Remove user from workspace
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getWorkspaceById, removeUserFromWorkspace } from '@/lib/db/compat';
import { isWorkspacesFeatureEnabled } from '@/lib/workspace/validator';

interface RouteParams {
  params: Promise<{ id: string; userId: string }>;
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { id, userId } = await params;

    if (!(await isWorkspacesFeatureEnabled())) {
      return NextResponse.json(
        { error: 'Workspaces feature is disabled' },
        { status: 403 }
      );
    }

    const workspace = await getWorkspaceById(id);
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    if (workspace.type !== 'standalone') {
      return NextResponse.json(
        { error: 'User management is only available for standalone workspaces' },
        { status: 400 }
      );
    }

    await removeUserFromWorkspace(id, parseInt(userId, 10));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error removing workspace user:', error);
    return NextResponse.json(
      { error: 'Failed to remove user from workspace' },
      { status: 500 }
    );
  }
}

/**
 * Admin Workspace Users API
 *
 * GET  /api/admin/workspaces/[id]/users - List users with access
 * POST /api/admin/workspaces/[id]/users - Add user(s) to workspace
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  getWorkspaceById,
  getWorkspaceUsers,
  addUserToWorkspace,
  bulkAddUsersToWorkspace,
} from '@/lib/db/compat';
import { isWorkspacesFeatureEnabled } from '@/lib/workspace/validator';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    await requireAdmin();

    const { id } = await params;

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

    // Only standalone workspaces support explicit user lists
    if (workspace.type !== 'standalone') {
      return NextResponse.json(
        { error: 'User management is only available for standalone workspaces' },
        { status: 400 }
      );
    }

    const users = await getWorkspaceUsers(id);

    return NextResponse.json({
      users,
      accessMode: workspace.access_mode,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error fetching workspace users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workspace users' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const admin = await requireAdmin();

    const { id } = await params;

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

    const body = await request.json();
    const { userId, userIds } = body;

    // Single user add
    if (userId) {
      await addUserToWorkspace(id, userId, admin.email);
      const users = await getWorkspaceUsers(id);
      return NextResponse.json({ users }, { status: 201 });
    }

    // Bulk user add
    if (userIds && Array.isArray(userIds) && userIds.length > 0) {
      await bulkAddUsersToWorkspace(id, userIds, admin.email);
      const users = await getWorkspaceUsers(id);
      return NextResponse.json({ users }, { status: 201 });
    }

    return NextResponse.json(
      { error: 'userId or userIds is required' },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error adding workspace users:', error);
    return NextResponse.json(
      { error: 'Failed to add users to workspace' },
      { status: 500 }
    );
  }
}

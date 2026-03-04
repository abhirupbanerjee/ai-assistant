/**
 * Admin Workspace Analytics API
 *
 * GET /api/admin/workspaces/[id]/analytics - Get workspace usage stats
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getWorkspaceById, getWorkspaceAnalytics } from '@/lib/db/compat';
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

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);

    const analytics = getWorkspaceAnalytics(id, days);

    return NextResponse.json({ analytics });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error fetching workspace analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}

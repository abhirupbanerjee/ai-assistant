import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import type { ApiError } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    if (!body.confirm) {
      return NextResponse.json<ApiError>(
        { error: 'Confirmation required. Send { "confirm": true }', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const { getGraph } = await import('@/lib/graph/falkordb-client');
    const graph = await getGraph();

    // Delete all nodes and edges
    await graph.query('MATCH (n) DETACH DELETE n');

    return NextResponse.json({
      status: 'cleared',
      message: 'Graph data cleared successfully',
    });
  } catch (err) {
    return NextResponse.json<ApiError>(
      { error: 'Failed to clear graph data' },
      { status: 500 }
    );
  }
}

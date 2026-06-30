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
    const { resetExtractionCache } = await import('@/lib/graph/entity-extraction');
    const { clearAllExtractionFailures, cleanupOrphanedExtractionFailures } = await import('@/lib/db/compat/query-logs');
    const { resetAllGraphExtractionStatuses } = await import('@/lib/db/compat/documents');

    const graph = await getGraph();

    // Delete all nodes and edges from FalkorDB
    await graph.query('MATCH (n) DETACH DELETE n');

    // Reset in-memory processed chunks cache so backfill can re-extract
    resetExtractionCache();

    // Clear extraction failure records from Postgres
    await clearAllExtractionFailures();

    // Also clean up any orphaned failures (documents deleted without cascade)
    await cleanupOrphanedExtractionFailures();

    // Reset all documents' graph_extraction_status to 'pending'
    await resetAllGraphExtractionStatuses();

    return NextResponse.json({
      status: 'cleared',
      message: 'Graph data, extraction cache, failure records, and document statuses cleared successfully',
    });
  } catch (err) {
    return NextResponse.json<ApiError>(
      { error: 'Failed to clear graph data' },
      { status: 500 }
    );
  }
}

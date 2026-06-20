import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { isGraphHealthy } from '@/lib/graph/falkordb-client';
import type { ApiError } from '@/types';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const healthy = await isGraphHealthy();
    let entityCount = 0;
    let chunkCount = 0;
    let relationCount = 0;

    if (healthy) {
      try {
        const { getGraph } = await import('@/lib/graph/falkordb-client');
        const graph = await getGraph();

        const entityResult = await graph.query('MATCH (e:Entity) RETURN COUNT(e) as count');
        entityCount = entityResult?.data?.[0]?.['count'] || entityResult?.data?.[0]?.[0] || 0;

        const chunkResult = await graph.query('MATCH (c:Chunk) RETURN COUNT(c) as count');
        chunkCount = chunkResult?.data?.[0]?.['count'] || chunkResult?.data?.[0]?.[0] || 0;

        const relResult = await graph.query('MATCH ()-[r:RELATES_TO]->() RETURN COUNT(r) as count');
        relationCount = relResult?.data?.[0]?.['count'] || relResult?.data?.[0]?.[0] || 0;
      } catch {
        // Stats collection failed — return what we have
      }
    }

    return NextResponse.json({
      healthy,
      entityCount,
      chunkCount,
      relationCount,
    });
  } catch (err) {
    return NextResponse.json<ApiError>(
      { error: 'Failed to get graph status' },
      { status: 500 }
    );
  }
}

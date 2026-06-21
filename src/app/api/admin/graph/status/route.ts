import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { isGraphHealthy } from '@/lib/graph/falkordb-client';
import type { ApiError } from '@/types';

/**
 * Extract a count value from a FalkorDB GraphReply result.
 *
 * FalkorDB's Graph.#parseReply() converts raw rows into named objects:
 *   result.data = [{ count: 5 }]
 * So we access by column name first, then fall back to numeric index
 * for any edge case where parsing differs.
 */
function extractCount(result: any, columnName: string = 'count'): number {
  if (!result?.data || !Array.isArray(result.data) || result.data.length === 0) return 0;
  const row = result.data[0];
  if (!row) return 0;
  // Primary: named property (standard after #parseReply)
  if (typeof row[columnName] === 'number') return row[columnName];
  // Fallback: numeric index (pre-parse raw format)
  if (Array.isArray(row) && typeof row[0] === 'number') return row[0];
  // Fallback: the value might be a string
  const val = row[columnName] ?? (Array.isArray(row) ? row[0] : undefined);
  return typeof val === 'string' ? parseInt(val, 10) || 0 : 0;
}

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
    let documentCount = 0;
    let graphExists = false;
    let statsError: string | null = null;

    if (healthy) {
      try {
        const { getGraph } = await import('@/lib/graph/falkordb-client');
        const graph = await getGraph();

        // Check if the graph has been initialized (has any labels)
        // An empty FalkorDB instance has no graph until the first write
        try {
          const labelsResult = await graph.roQuery('CALL db.labels()');
          graphExists = !!(labelsResult?.data && labelsResult.data.length > 0);
        } catch {
          // CALL db.labels() fails if graph doesn't exist yet
          graphExists = false;
        }

        if (graphExists) {
          const entityResult = await graph.roQuery('MATCH (e:Entity) RETURN COUNT(e) as count');
          entityCount = extractCount(entityResult);

          const chunkResult = await graph.roQuery('MATCH (c:Chunk) RETURN COUNT(c) as count');
          chunkCount = extractCount(chunkResult);

          const relResult = await graph.roQuery('MATCH ()-[r:RELATES_TO]->() RETURN COUNT(r) as count');
          relationCount = extractCount(relResult);

          const docResult = await graph.roQuery('MATCH (d:Document) RETURN COUNT(d) as count');
          documentCount = extractCount(docResult);
        }
      } catch (err) {
        statsError = String(err);
        console.error('[GraphStatus] Failed to collect stats:', err);
      }
    }

    // Calculate pending chunks (Qdrant chunks not yet in the graph)
    let qdrantChunkCount = 0;
    let pendingChunks = 0;
    try {
      const { getVectorStore, getCollectionNames } = await import('@/lib/vector-store');
      const store = await getVectorStore();
      const collNames = getCollectionNames();
      qdrantChunkCount = await store.getCollectionCount(collNames.global);
      pendingChunks = Math.max(0, qdrantChunkCount - chunkCount);
    } catch {
      // Qdrant may not be reachable — leave as 0
    }

    return NextResponse.json({
      healthy,
      graphExists,
      entityCount,
      chunkCount,
      relationCount,
      documentCount,
      qdrantChunkCount,
      pendingChunks,
      statsError,
    });
  } catch (err) {
    return NextResponse.json<ApiError>(
      { error: 'Failed to get graph status' },
      { status: 500 }
    );
  }
}

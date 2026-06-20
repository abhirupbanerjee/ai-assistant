import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getExtractionFailures,
  clearExtractionFailure,
  clearAllExtractionFailures,
  getExtractionFailureStats,
} from '@/lib/db/compat/query-logs';
import type { ApiError } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const failures = await getExtractionFailures(limit, offset);
    const stats = await getExtractionFailureStats();

    return NextResponse.json({
      failures,
      total: stats.total,
      maxRetryReached: stats.maxRetryReached,
      limit,
      offset,
    });
  } catch (err) {
    return NextResponse.json<ApiError>(
      { error: 'Failed to get failures' },
      { status: 500 }
    );
  }
}

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

    if (body.clearOnly) {
      await clearAllExtractionFailures();
      return NextResponse.json({ status: 'cleared', message: 'All failure records cleared' });
    }

    // Specific qdrantIds to reprocess
    if (body.qdrantIds && Array.isArray(body.qdrantIds) && body.qdrantIds.length > 0) {
      const { resetExtractionCache, extractEntitiesFromChunk } = await import('@/lib/graph/entity-extraction');
      const { getVectorStore, getCollectionNames } = await import('@/lib/vector-store');
      const { getDocumentWithCategories } = await import('@/lib/db/compat/documents');

      resetExtractionCache(); // Clear in-memory cache

      const store = await getVectorStore();
      const collNames = getCollectionNames();

      (async () => {
        for (const qdrantId of body.qdrantIds) {
          try {
            const failures = await getExtractionFailures(500, 0);
            const failure = failures.find((f: any) => f.qdrant_id === qdrantId);
            if (!failure) continue;

            const doc = await getDocumentWithCategories(parseInt(failure.document_id, 10));
            if (!doc) continue;

            const docChunks = await store.getDocumentChunksByDocId(collNames.global, failure.document_id);
            const chunk = docChunks.find((c: any) => c.id === qdrantId);
            if (!chunk) continue;

            await extractEntitiesFromChunk(
              chunk.text,
              qdrantId,
              failure.document_id,
              chunk.metadata?.pageNumber || 1,
              doc.filename,
            );
            await clearExtractionFailure(qdrantId);
          } catch {
            // Will remain in failures for next retry
          }
        }
      })().catch(console.error);

      return NextResponse.json({
        status: 'started',
        message: `Reprocessing ${body.qdrantIds.length} chunks`,
      });
    }

    return NextResponse.json<ApiError>(
      { error: 'Missing qdrantIds or clearOnly', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json<ApiError>(
      { error: 'Failed to process failures' },
      { status: 500 }
    );
  }
}

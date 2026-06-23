import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getExtractionFailures,
  clearExtractionFailure,
  clearAllExtractionFailures,
  getExtractionFailureStats,
} from '@/lib/db/compat/query-logs';
import type { ApiError } from '@/types';

/**
 * Find a single chunk across all collections where the document may live.
 * Mirrors the search logic used by full backfill.
 */
async function findChunkAcrossCollections(
  store: any,
  collNames: { global: string; legacy: string; forCategory: (slug: string) => string },
  documentId: string,
  qdrantId: string,
  isGlobal: boolean,
  categorySlugs: string[]
): Promise<{ id: string; text: string; metadata?: { pageNumber?: number } } | undefined> {
  const candidateCollections = isGlobal
    ? [collNames.global, ...categorySlugs.map(s => collNames.forCategory(s))]
    : [collNames.legacy, ...categorySlugs.map(s => collNames.forCategory(s))];

  for (const coll of candidateCollections) {
    try {
      const docChunks = await store.getDocumentChunksByDocId(coll, documentId);
      const chunk = docChunks.find((c: any) => c.id === qdrantId);
      if (chunk) return chunk;
    } catch {
      // Collection may not exist
    }
  }
  return undefined;
}

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
    console.error('[GraphFailures] Failed to get failures:', err);
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
            if (!failure) {
              console.warn(`[GraphFailures/reprocess] Failure record not found for ${qdrantId}`);
              continue;
            }

            const doc = await getDocumentWithCategories(parseInt(failure.document_id, 10));
            if (!doc) {
              console.warn(`[GraphFailures/reprocess] Document ${failure.document_id} not found for ${qdrantId}`);
              continue;
            }

            const chunk = await findChunkAcrossCollections(
              store,
              collNames,
              failure.document_id,
              qdrantId,
              doc.isGlobal,
              doc.categories.map(c => c.slug)
            );
            if (!chunk) {
              console.warn(`[GraphFailures/reprocess] Chunk ${qdrantId} not found in any collection for document ${failure.document_id}`);
              continue;
            }

            await extractEntitiesFromChunk(
              chunk.text,
              qdrantId,
              failure.document_id,
              chunk.metadata?.pageNumber || 1,
              doc.filename,
            );
            await clearExtractionFailure(qdrantId);
          } catch (err) {
            console.error(`[GraphFailures/reprocess] Reprocessing failed for ${qdrantId}:`, err);
            // Failure record remains for later retry
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
    console.error('[GraphFailures] Failed to process failures:', err);
    return NextResponse.json<ApiError>(
      { error: 'Failed to process failures' },
      { status: 500 }
    );
  }
}

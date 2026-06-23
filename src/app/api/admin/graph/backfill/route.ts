import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import type { ApiError } from '@/types';

/**
 * Find all chunks for a document across every collection it could live in.
 * Global documents are mirrored into the global collection and every category
 * collection; non-global (category-scoped) documents live in the legacy
 * collection plus their category collections.
 */
async function getChunksForDoc(
  store: any,
  collNames: { global: string; legacy: string; forCategory: (slug: string) => string },
  docId: number,
  isGlobal: boolean,
  categorySlugs: string[]
): Promise<any[]> {
  const docIdStr = String(docId);
  const candidateCollections = isGlobal
    ? [collNames.global, ...categorySlugs.map(s => collNames.forCategory(s))]
    : [collNames.legacy, ...categorySlugs.map(s => collNames.forCategory(s))];

  for (const coll of candidateCollections) {
    try {
      const chunks = await store.getDocumentChunksByDocId(coll, docIdStr);
      if (chunks.length > 0) return chunks;
    } catch {
      // Collection may not exist
    }
  }
  return [];
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
    const mode = body.mode === 'failed' ? 'failed' : 'full';

    const { getVectorStore, getCollectionNames } = await import('@/lib/vector-store');
    const store = await getVectorStore();
    const collNames = getCollectionNames();

    // Trigger backfill asynchronously — runs in background
    if (mode === 'failed') {
      // Reprocess only failed chunks
      const { getExtractionFailures, clearExtractionFailure } = await import('@/lib/db/compat/query-logs');
      const { resetExtractionCache, extractEntitiesFromChunk } = await import('@/lib/graph/entity-extraction');
      const { getDocumentWithCategories } = await import('@/lib/db/compat/documents');

      const failures = await getExtractionFailures(500, 0);

      // Don't await — fire and forget
      (async () => {
        resetExtractionCache(); // Clear in-memory cache so retries are real
        for (const f of failures) {
          try {
            const doc = await getDocumentWithCategories(parseInt(f.document_id, 10));
            if (!doc) {
              console.warn(`[GraphBackfill/failed] Document ${f.document_id} not found, skipping ${f.qdrant_id}`);
              continue;
            }

            const docChunks = await getChunksForDoc(
              store,
              collNames,
              doc.id,
              doc.isGlobal,
              doc.categories.map(c => c.slug)
            );
            const chunk = docChunks.find((c: any) => c.id === f.qdrant_id);
            if (!chunk) {
              console.warn(`[GraphBackfill/failed] Chunk ${f.qdrant_id} not found in any collection for document ${f.document_id}`);
              continue;
            }

            await extractEntitiesFromChunk(
              chunk.text,
              f.qdrant_id,
              f.document_id,
              chunk.metadata?.pageNumber || 1,
              doc.filename,
            );
            await clearExtractionFailure(f.qdrant_id);
          } catch (err) {
            console.error(`[GraphBackfill/failed] Reprocessing failed for ${f.qdrant_id}:`, err);
            // Failure record will remain and can be retried later
          }
        }
      })().catch(console.error);

      return NextResponse.json({
        status: 'started',
        mode: 'failed',
        message: `Reprocessing ${failures.length} failed chunks`,
      });
    }

    // Full backfill — count documents first for the response
    const { getAllDocumentsWithCategories } = await import('@/lib/db/compat/documents');

    const documents = await getAllDocumentsWithCategories();
    const readyDocs = documents.filter(d => d.status === 'ready');

    // Count total chunks across all ready documents
    let totalChunks = 0;
    for (const doc of readyDocs) {
      try {
        const docChunks = await getChunksForDoc(store, collNames, doc.id, doc.isGlobal, doc.categories.map(c => c.slug));
        totalChunks += docChunks.length;
      } catch (err) {
        console.warn(`[GraphBackfill/full] Could not count chunks for document ${doc.id}:`, err);
      }
    }

    if (totalChunks === 0) {
      return NextResponse.json({
        status: 'nothing_to_do',
        mode: 'full',
        message: 'No documents with chunks found — nothing to backfill',
        documentCount: readyDocs.length,
        chunkCount: 0,
      });
    }

    // Don't await — fire and forget
    (async () => {
      const { extractEntitiesFromChunks, resetExtractionCache } = await import('@/lib/graph/entity-extraction');
      const { updateDocument } = await import('@/lib/db/compat/documents');

      resetExtractionCache();
      for (const doc of readyDocs) {
        try {
          const docChunks = await getChunksForDoc(store, collNames, doc.id, doc.isGlobal, doc.categories.map(c => c.slug));
          if (docChunks.length === 0) continue;

          await updateDocument(doc.id, { graphExtractionStatus: 'processing' });
          const chunks = docChunks.map((c: any) => ({
            qdrantId: c.id,
            text: c.text,
            documentId: String(doc.id),
            pageNumber: c.metadata?.pageNumber || 1,
            documentName: doc.filename,
          }));
          await extractEntitiesFromChunks(chunks);
          await updateDocument(doc.id, { graphExtractionStatus: 'completed' });
        } catch (err) {
          console.error(`[GraphBackfill/full] Failed for document ${doc.id}:`, err);
          // Mark as failed but continue with next document
          await updateDocument(doc.id, { graphExtractionStatus: 'failed' }).catch(() => {});
        }
      }
    })().catch(console.error);

    return NextResponse.json({
      status: 'started',
      mode: 'full',
      message: `Backfill started: ${readyDocs.length} documents, ${totalChunks} chunks`,
      documentCount: readyDocs.length,
      chunkCount: totalChunks,
    });
  } catch (err) {
    console.error('[GraphBackfill] Failed to start backfill:', err);
    return NextResponse.json<ApiError>(
      { error: 'Failed to start backfill' },
      { status: 500 }
    );
  }
}

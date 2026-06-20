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
    const mode = body.mode === 'failed' ? 'failed' : 'full';

    // Trigger backfill asynchronously — runs in background
    if (mode === 'failed') {
      // Reprocess only failed chunks
      const { getExtractionFailures, clearExtractionFailure } = await import('@/lib/db/compat/query-logs');
      const { resetExtractionCache, extractEntitiesFromChunk } = await import('@/lib/graph/entity-extraction');
      const { getVectorStore, getCollectionNames } = await import('@/lib/vector-store');
      const { getDocumentWithCategories } = await import('@/lib/db/compat/documents');

      const failures = await getExtractionFailures(500, 0);
      const store = await getVectorStore();
      const collNames = getCollectionNames();

      // Don't await — fire and forget
      (async () => {
        for (const f of failures) {
          try {
            const doc = await getDocumentWithCategories(parseInt(f.document_id, 10));
            if (!doc) continue;

            const docChunks = await store.getDocumentChunksByDocId(collNames.global, f.document_id);
            const chunk = docChunks.find((c: any) => c.id === f.qdrant_id);
            if (!chunk) continue;

            await extractEntitiesFromChunk(
              chunk.text,
              f.qdrant_id,
              f.document_id,
              chunk.metadata?.pageNumber || 1,
              doc.filename,
            );
            await clearExtractionFailure(f.qdrant_id);
          } catch {
            // Will be retried next time
          }
        }
      })().catch(console.error);

      return NextResponse.json({
        status: 'started',
        mode: 'failed',
        message: `Reprocessing ${failures.length} failed chunks`,
      });
    }

    // Full backfill
    (async () => {
      const { getVectorStore, getCollectionNames } = await import('@/lib/vector-store');
      const { getAllDocumentsWithCategories } = await import('@/lib/db/compat/documents');
      const { extractEntitiesFromChunks, resetExtractionCache } = await import('@/lib/graph/entity-extraction');

      const documents = await getAllDocumentsWithCategories();
      const store = await getVectorStore();
      const collNames = getCollectionNames();

      for (const doc of documents) {
        if (doc.status !== 'ready') continue;
        try {
          const docIdStr = String(doc.id);
          const docChunks = await store.getDocumentChunksByDocId(collNames.global, docIdStr);
          if (docChunks.length === 0) continue;

          const chunks = docChunks.map((c: any) => ({
            qdrantId: c.id,
            text: c.text,
            documentId: docIdStr,
            pageNumber: c.metadata?.pageNumber || 1,
            documentName: doc.filename,
          }));
          await extractEntitiesFromChunks(chunks);
        } catch {
          // Continue with next document
        }
      }
    })().catch(console.error);

    return NextResponse.json({
      status: 'started',
      mode: 'full',
      message: 'Full backfill started',
    });
  } catch (err) {
    return NextResponse.json<ApiError>(
      { error: 'Failed to start backfill' },
      { status: 500 }
    );
  }
}

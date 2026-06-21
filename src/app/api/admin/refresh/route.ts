import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listGlobalDocuments, reindexDocument, deleteDocument } from '@/lib/ingest';
import { clearAllCache } from '@/lib/redis';
import { fileExists } from '@/lib/storage';
import { getGlobalDocsDir } from '@/lib/storage';
import path from 'path';
import type { ApiError } from '@/types';

/**
 * POST /api/admin/refresh?mode=vector|graph|all
 *
 * mode=vector: Clear cache + reindex all docs into Qdrant only (skip graph extraction)
 * mode=graph:  Trigger graph backfill only (no vector reindex)
 * mode=all:    Clear cache + reindex all docs with inline graph extraction (default)
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    // Parse mode from query params
    const url = new URL(request.url);
    const mode = (url.searchParams.get('mode') || 'all') as 'vector' | 'graph' | 'all';

    // mode=graph: run graph backfill directly (no self-referential fetch — avoids SSL issues behind Traefik)
    if (mode === 'graph') {
      const { getVectorStore, getCollectionNames } = await import('@/lib/vector-store');
      const { getAllDocumentsWithCategories } = await import('@/lib/db/compat/documents');

      const documents = await getAllDocumentsWithCategories();
      const readyDocs = documents.filter(d => d.status === 'ready');
      const store = await getVectorStore();
      const collNames = getCollectionNames();

      // Helper: find chunks across all possible collections
      async function getChunksForDoc(docId: number, isGlobal: boolean, categorySlugs: string[]): Promise<any[]> {
        const docIdStr = String(docId);
        const candidateCollections = isGlobal
          ? [collNames.global, ...categorySlugs.map(s => collNames.forCategory(s))]
          : [collNames.legacy, ...categorySlugs.map(s => collNames.forCategory(s))];
        for (const coll of candidateCollections) {
          try {
            const chunks = await store.getDocumentChunksByDocId(coll, docIdStr);
            if (chunks.length > 0) return chunks;
          } catch { /* collection may not exist */ }
        }
        return [];
      }

      // Count chunks
      let totalChunks = 0;
      for (const doc of readyDocs) {
        try {
          const docChunks = await getChunksForDoc(doc.id, doc.isGlobal, doc.categories.map(c => c.slug));
          totalChunks += docChunks.length;
        } catch { /* skip */ }
      }

      if (totalChunks === 0) {
        return NextResponse.json({
          success: true,
          mode: 'graph',
          status: 'nothing_to_do',
          message: 'No documents with chunks found — nothing to backfill',
          documentCount: readyDocs.length,
          chunkCount: 0,
        });
      }

      // Fire and forget — run backfill in background
      (async () => {
        const { extractEntitiesFromChunks } = await import('@/lib/graph/entity-extraction');
        const { updateDocument } = await import('@/lib/db/compat/documents');

        for (const doc of readyDocs) {
          try {
            const docIdStr = String(doc.id);
            const docChunks = await getChunksForDoc(doc.id, doc.isGlobal, doc.categories.map(c => c.slug));
            if (docChunks.length === 0) continue;

            await updateDocument(doc.id, { graphExtractionStatus: 'processing' });
            const chunks = docChunks.map((c: any) => ({
              qdrantId: c.id,
              text: c.text,
              documentId: docIdStr,
              pageNumber: c.metadata?.pageNumber || 1,
              documentName: doc.filename,
            }));
            await extractEntitiesFromChunks(chunks);
            await updateDocument(doc.id, { graphExtractionStatus: 'completed' });
          } catch {
            await updateDocument(doc.id, { graphExtractionStatus: 'failed' }).catch(() => {});
          }
        }
      })().catch(console.error);

      return NextResponse.json({
        success: true,
        mode: 'graph',
        status: 'started',
        message: `Graph backfill started: ${readyDocs.length} documents, ${totalChunks} chunks`,
        documentCount: readyDocs.length,
        chunkCount: totalChunks,
      });
    }

    // mode=vector or mode=all: clear cache + reindex documents
    // Clear Redis cache
    await clearAllCache();

    // Get all documents and reindex them
    const documents = await listGlobalDocuments();
    let reindexedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];
    const missingFiles: { id: string; filename: string; filepath: string }[] = [];

    const skipGraph = mode === 'vector';

    for (const doc of documents) {
      // Pre-check: verify document file exists on disk
      const globalDocsDir = getGlobalDocsDir();
      const filePath = path.join(globalDocsDir, doc.filepath);
      const exists = await fileExists(filePath);
      if (!exists) {
        missingFiles.push({ id: doc.id, filename: doc.filename, filepath: doc.filepath });
        errors.push(`${doc.filename}: Document file not found on disk — skipping reindex`);
        skippedCount++;
        continue;
      }

      try {
        await reindexDocument(doc.id, { skipGraphExtraction: skipGraph });
        reindexedCount++;
      } catch (error) {
        errors.push(`${doc.filename}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Report missing files prominently so the admin can clean them up
    const response: Record<string, unknown> = {
      success: true,
      mode,
      documentsReindexed: reindexedCount,
      totalDocuments: documents.length,
      documentsSkipped: skippedCount,
    };

    if (missingFiles.length > 0) {
      response.missingFiles = missingFiles.map(mf => ({
        id: mf.id,
        filename: mf.filename,
        filepath: mf.filepath,
      }));
      response.missingFilesMessage =
        `${missingFiles.length} document(s) have no file on disk. ` +
        `These records cannot be reindexed until the files are restored or the records are deleted from the database.`;
    }

    if (errors.length > 0) {
      response.errors = errors.slice(0, 20); // Limit errors to 20 to avoid huge responses
      if (errors.length > 20) {
        response.truncatedErrors = errors.length - 20;
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Refresh error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to refresh',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

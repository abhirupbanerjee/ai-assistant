/**
 * Backfill Graph Script
 *
 * Processes all existing Qdrant documents into the FalkorDB knowledge graph.
 * Idempotent — skips chunks already present in FalkorDB.
 *
 * Usage: npx tsx src/scripts/backfill-graph.ts
 */

import 'dotenv/config';
import { getVectorStore, getCollectionNames } from '@/lib/vector-store';
import { getAllDocumentsWithCategories } from '@/lib/db/compat/documents';
import { getDb } from '@/lib/db/kysely';

async function main() {
  console.log('[BackfillGraph] Starting graph backfill...');

  // Pre-check: verify falkordb SDK is available
  try {
    require.resolve('falkordb');
  } catch {
    console.error(
      '[BackfillGraph] FalkorDB SDK not installed.\n' +
      '  Install it first: npm install --legacy-peer-deps\n' +
      '  Then ensure FalkorDB is running: docker compose --profile falkordb up -d'
    );
    process.exit(1);
  }

  // Lazy imports after pre-check
  const { extractEntitiesFromChunks, resetExtractionCache } = await import('@/lib/graph/entity-extraction');
  const { initGraphSchema, isGraphHealthy } = await import('@/lib/graph/falkordb-client');

  // Check FalkorDB health
  const healthy = await isGraphHealthy();
  if (!healthy) {
    console.error('[BackfillGraph] FalkorDB is not reachable. Start it with: docker compose --profile falkordb up -d');
    process.exit(1);
  }

  // Initialize schema
  await initGraphSchema();
  console.log('[BackfillGraph] Graph schema initialized.');

  // Get all documents
  const documents = await getAllDocumentsWithCategories();
  console.log(`[BackfillGraph] Found ${documents.length} documents.`);

  const store = await getVectorStore();
  const collNames = getCollectionNames();

  let totalChunks = 0;
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const doc of documents) {
    if (doc.status !== 'ready') {
      console.log(`[BackfillGraph] Skipping document "${doc.filename}" (status: ${doc.status})`);
      continue;
    }

    const docIdStr = String(doc.id);
    console.log(`[BackfillGraph] Processing document "${doc.filename}" (id=${docIdStr}, chunks=${doc.chunk_count})...`);

    try {
      // Determine which collection to query based on document's categories
      let docChunks: any[] = [];
      const categorySlugs = doc.categories?.map((c: any) => c.slug) || [];

      if (doc.isGlobal) {
        // Global docs: chunks are in global_documents collection
        docChunks = await store.getDocumentChunksByDocId(collNames.global, docIdStr);
      } else if (categorySlugs.length > 0) {
        // Category docs: try each category collection (chunks are in category-specific collections)
        for (const slug of categorySlugs) {
          const chunks = await store.getDocumentChunksByDocId(collNames.forCategory(slug), docIdStr);
          if (chunks.length > 0) {
            docChunks = chunks;
            break;
          }
        }
      }

      // Fallback: try legacy collection
      if (docChunks.length === 0) {
        docChunks = await store.getDocumentChunksByDocId(collNames.legacy, docIdStr);
      }

      if (docChunks.length === 0) {
        console.log(`[BackfillGraph]   No chunks found in Qdrant for document ${docIdStr} (global=${doc.isGlobal}, categories=${categorySlugs.join(',') || 'none'}), skipping.`);
        continue;
      }

      const chunks = docChunks.map(c => ({
        qdrantId: c.id,
        text: c.text,
        documentId: docIdStr,
        pageNumber: c.metadata?.pageNumber || 1,
        documentName: doc.filename,
      }));

      totalChunks += chunks.length;
      const { processed, skipped, failed } = await extractEntitiesFromChunks(chunks);
      totalProcessed += processed;
      totalSkipped += skipped;
      totalFailed += failed;

      console.log(`[BackfillGraph]   ${processed} processed, ${skipped} skipped, ${failed} failed`);
    } catch (err) {
      console.error(`[BackfillGraph]   Failed for document "${doc.filename}":`, err);
      totalFailed += doc.chunk_count || 0;
    }
  }

  console.log(`\n[BackfillGraph] Complete! Total: ${totalChunks} chunks, ${totalProcessed} processed, ${totalSkipped} skipped, ${totalFailed} failed`);
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[BackfillGraph] Fatal error:', err);
  process.exit(1);
});

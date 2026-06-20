/**
 * Backfill Graph Script
 *
 * Processes all existing Qdrant documents into the FalkorDB knowledge graph.
 * Idempotent — skips chunks already present in FalkorDB.
 *
 * Usage: npx tsx src/scripts/backfill-graph.ts
 */

import { getVectorStore, getCollectionNames } from '@/lib/vector-store';
import { getAllDocumentsWithCategories } from '@/lib/db/compat/documents';
import { getDb } from '@/lib/db/kysely';
import { extractEntitiesFromChunks, resetExtractionCache } from '@/lib/graph/entity-extraction';
import { initGraphSchema, isGraphHealthy } from '@/lib/graph/falkordb-client';

async function main() {
  console.log('[BackfillGraph] Starting graph backfill...');

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
      // Fetch chunks from Qdrant using the document-scoped retrieval method
      const docChunks = await store.getDocumentChunksByDocId(collNames.global, docIdStr);

      if (docChunks.length === 0) {
        console.log(`[BackfillGraph]   No chunks found in Qdrant for document ${docIdStr}, skipping.`);
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

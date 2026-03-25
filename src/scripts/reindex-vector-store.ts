#!/usr/bin/env npx ts-node
/**
 * Vector Store Reindex Script
 *
 * Reindexes all documents from SQLite into the configured vector store.
 * Use this when:
 * - Recovering from vector store data loss
 * - Recovering from vector store data loss
 * - Changing embedding model (requires re-embedding)
 *
 * Usage:
 *   npx ts-node src/scripts/reindex-vector-store.ts
 *   npx ts-node src/scripts/reindex-vector-store.ts --clear-first
 *   npx ts-node src/scripts/reindex-vector-store.ts --dry-run
 */

import { config } from 'dotenv';
config(); // Load .env file

import { getAllDocumentsWithCategories } from '../lib/db/documents';
import { getVectorStore, getCollectionNames, getVectorStoreProvider } from '../lib/vector-store';
import { createEmbeddings } from '../lib/openai';
import { extractText, getMimeTypeFromFilename } from '../lib/document-extractor';
import { chunkText } from '../lib/ingest';
import { readFileBuffer, getGlobalDocsDir } from '../lib/storage';
import path from 'path';

interface ReindexOptions {
  clearFirst: boolean;
  dryRun: boolean;
  batchSize: number;
}

interface ReindexResult {
  totalDocuments: number;
  successfulDocuments: number;
  failedDocuments: number;
  totalChunks: number;
  errors: Array<{ documentId: number; filename: string; error: string }>;
}

async function reindexAllDocuments(options: ReindexOptions): Promise<ReindexResult> {
  const provider = getVectorStoreProvider();
  console.log(`\n🔄 Reindexing documents to ${provider.toUpperCase()}`);
  console.log(`   Options: clearFirst=${options.clearFirst}, dryRun=${options.dryRun}\n`);

  const store = await getVectorStore();
  const collNames = getCollectionNames();
  const globalDocsDir = getGlobalDocsDir();

  // Get all documents with status='ready'
  const allDocs = getAllDocumentsWithCategories();
  const readyDocs = allDocs.filter(doc => doc.status === 'ready');

  console.log(`📊 Found ${readyDocs.length} documents to reindex (${allDocs.length} total)\n`);

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
    for (const doc of readyDocs) {
      const categories = doc.categories.map(c => c.slug).join(', ') || 'none';
      console.log(`  - [${doc.id}] ${doc.filename} (global: ${doc.isGlobal}, categories: ${categories})`);
    }
    return {
      totalDocuments: readyDocs.length,
      successfulDocuments: 0,
      failedDocuments: 0,
      totalChunks: 0,
      errors: [],
    };
  }

  // Optionally clear existing collections
  if (options.clearFirst) {
    console.log('🗑️  Clearing existing collections...');
    const collections = await store.listCollections();
    for (const name of collections) {
      console.log(`   Deleting collection: ${name}`);
      await store.deleteCollection(name);
    }
    console.log('   Done clearing collections\n');
  }

  const result: ReindexResult = {
    totalDocuments: readyDocs.length,
    successfulDocuments: 0,
    failedDocuments: 0,
    totalChunks: 0,
    errors: [],
  };

  // Process each document
  for (let i = 0; i < readyDocs.length; i++) {
    const doc = readyDocs[i];
    const progress = `[${i + 1}/${readyDocs.length}]`;

    try {
      console.log(`${progress} Processing: ${doc.filename}`);

      // Read file
      const filePath = path.join(globalDocsDir, doc.filepath);
      const buffer = await readFileBuffer(filePath);

      // Extract text
      const mimeType = getMimeTypeFromFilename(doc.filename);
      const { text, pages } = await extractText(buffer, mimeType, doc.filename);

      // Chunk text
      const docId = String(doc.id);
      const chunks = await chunkText(text, docId, doc.filename, 'global', undefined, undefined, pages);

      if (chunks.length === 0) {
        console.log(`   ⚠️  No chunks extracted, skipping`);
        continue;
      }

      console.log(`   📝 ${chunks.length} chunks extracted`);

      // Get category slugs
      const categorySlugs = doc.categories.map(c => c.slug);

      // Create embeddings and add to vector store in batches
      for (let j = 0; j < chunks.length; j += options.batchSize) {
        const batch = chunks.slice(j, j + options.batchSize);
        const texts = batch.map(c => c.text);
        const embeddings = await createEmbeddings(texts);
        const metadatas = batch.map(c => c.metadata);
        const ids = batch.map(c => c.id);

        // Add to appropriate collections
        if (doc.isGlobal) {
          // Global docs go to global collection and all category collections
          await store.addDocuments(collNames.global, ids, embeddings, texts, metadatas);
          const allCollections = await store.listCollections();
          for (const name of allCollections.filter(collNames.isCategory)) {
            await store.addDocuments(name, ids, embeddings, texts, metadatas);
          }
        }

        if (categorySlugs.length > 0) {
          // Add to category collections
          for (const slug of categorySlugs) {
            await store.addDocuments(collNames.forCategory(slug), ids, embeddings, texts, metadatas);
          }
        } else if (!doc.isGlobal) {
          // Legacy: uncategorized non-global docs go to legacy collection
          await store.addDocuments(collNames.legacy, ids, embeddings, texts, metadatas);
        }

        result.totalChunks += batch.length;
      }

      console.log(`   ✅ Successfully indexed`);
      result.successfulDocuments++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`   ❌ Failed: ${errorMessage}`);
      result.failedDocuments++;
      result.errors.push({
        documentId: doc.id,
        filename: doc.filename,
        error: errorMessage,
      });
    }
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const options: ReindexOptions = {
    clearFirst: args.includes('--clear-first'),
    dryRun: args.includes('--dry-run'),
    batchSize: 100,
  };

  // Parse batch size if provided
  const batchArg = args.find(a => a.startsWith('--batch-size='));
  if (batchArg) {
    options.batchSize = parseInt(batchArg.split('=')[1], 10) || 100;
  }

  console.log('='.repeat(60));
  console.log('Vector Store Reindex Script');
  console.log('='.repeat(60));

  try {
    const result = await reindexAllDocuments(options);

    console.log('\n' + '='.repeat(60));
    console.log('📊 REINDEX SUMMARY');
    console.log('='.repeat(60));
    console.log(`   Provider: ${getVectorStoreProvider()}`);
    console.log(`   Total documents: ${result.totalDocuments}`);
    console.log(`   Successful: ${result.successfulDocuments}`);
    console.log(`   Failed: ${result.failedDocuments}`);
    console.log(`   Total chunks indexed: ${result.totalChunks}`);

    if (result.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      for (const err of result.errors) {
        console.log(`   [${err.documentId}] ${err.filename}: ${err.error}`);
      }
    }

    console.log('='.repeat(60) + '\n');

    if (result.failedDocuments > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

main();

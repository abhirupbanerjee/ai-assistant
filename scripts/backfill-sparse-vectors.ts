#!/usr/bin/env npx tsx

/**
 * Sparse Vector Backfill Script (one-off)
 *
 * Documents ingested before `hybridSearchEnabled` was turned on have no sparse
 * (BM25-style) vectors, so hybrid queries return 0 sparse results and retrieval
 * falls back to dense-only. The `backfillSparseVectors()` method in
 * src/lib/vector-store/qdrant.ts already implements the fix; this script simply
 * invokes it for every existing collection (category + global + legacy).
 *
 * Usage:
 *   npx tsx scripts/backfill-sparse-vectors.ts
 *
 * The script is idempotent — points that already have sparse vectors are skipped.
 * Worst case on an up-to-date collection: a no-op scan.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local manually (same pattern as scripts/test-connectivity.ts)
function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      const envPath = resolve(process.cwd(), file);
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0 && process.env[key.trim()] === undefined) {
            process.env[key.trim()] = valueParts.join('=').trim();
          }
        }
      }
    } catch {
      // File not present — continue
    }
  }
}

loadEnv();

async function main() {
  console.log('[Backfill] Starting sparse vector backfill...');

  const { getVectorStore } = await import('../src/lib/vector-store');
  const store = await getVectorStore();

  // Report hybridSearchEnabled so the operator can confirm future ingestions
  // will write sparse vectors automatically (ingestion path checks this flag).
  try {
    const { getRagSettings } = await import('../src/lib/db/compat/config');
    const ragSettings = await getRagSettings();
    console.log(`[Backfill] hybridSearchEnabled = ${ragSettings.hybridSearchEnabled}`);
    if (!ragSettings.hybridSearchEnabled) {
      console.warn(
        '[Backfill] WARNING: hybridSearchEnabled is FALSE in RAG settings. ' +
        'Enable it (Admin > Settings > RAG) so future ingestions write sparse vectors.'
      );
    }
  } catch (err) {
    console.warn(
      '[Backfill] Could not read RAG settings from DB (continuing anyway):',
      err instanceof Error ? err.message : err
    );
  }

  const collections = await store.listCollections();
  console.log(`[Backfill] Found ${collections.length} collection(s): ${collections.join(', ') || '(none)'}`);

  let totalUpdated = 0;
  for (const collectionName of collections) {
    try {
      const updated = await store.backfillSparseVectors(collectionName);
      totalUpdated += updated;
      console.log(`[Backfill] ${collectionName}: ${updated} point(s) updated`);
    } catch (err) {
      console.error(
        `[Backfill] Failed on ${collectionName}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(`[Backfill] Done. Total points updated across all collections: ${totalUpdated}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});

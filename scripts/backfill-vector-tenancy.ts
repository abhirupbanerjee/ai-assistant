#!/usr/bin/env npx tsx

/**
 * Vector tenancy backfill — AI & API Setup Redesign, Phase D (plan §8, §12.3).
 *
 * Stamps the DEFAULT organization id onto every existing Qdrant point payload.
 * This mutates payload metadata only (Qdrant `setPayload`) — vectors and sparse
 * vectors are untouched, so NO re-embedding is required.
 *
 * Idempotent: points that already carry the target organization id are skipped.
 *
 *   npx tsx scripts/backfill-vector-tenancy.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      const envPath = resolve(process.cwd(), file);
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eq = trimmed.indexOf('=');
          if (eq <= 0) continue;
          const key = trimmed.slice(0, eq).trim();
          const value = trimmed.slice(eq + 1).trim();
          if (key && process.env[key] === undefined) {
            process.env[key] = value;
          }
        }
      }
    } catch {
      // File not present — continue.
    }
  }
}

loadEnv();

async function main(): Promise<void> {
  console.log('[Backfill] Starting vector tenancy backfill (Phase D)...');

  const { getDb } = await import('../src/lib/db/kysely');
  const { getDefaultOrganizationId } = await import('../src/lib/org-context');
  const { qdrantStore } = await import('../src/lib/vector-store/qdrant');

  const db = await getDb();
  const defaultOrgId = await getDefaultOrganizationId(db);
  if (defaultOrgId == null) {
    console.error('[Backfill] No DEFAULT organization found — run scripts/backfill-org-tenancy.ts first.');
    process.exit(1);
  }

  const collections = await qdrantStore.listCollections();
  let totalStamped = 0;
  for (const name of collections) {
    const stamped = await qdrantStore.backfillOrganizationIds(name, defaultOrgId);
    console.log(`[Backfill] ${name}: stamped ${stamped} point(s) with organization_id=${defaultOrgId}`);
    totalStamped += stamped;
  }

  console.log(`[Backfill] Vector tenancy backfill complete: ${totalStamped} point(s) stamped across ${collections.length} collection(s).`);
  await db.destroy();
}

main().catch((error) => {
  console.error('[Backfill] Vector tenancy backfill failed:', error);
  process.exit(1);
});

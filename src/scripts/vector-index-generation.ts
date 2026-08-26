#!/usr/bin/env npx tsx

/**
 * Vector Index Generation Manager — Phase 6 CLI (see plans/RAG_updates.md and
 * plans/RAG_updates-review.md §Phase 6).
 *
 * PostgreSQL-only. Builds candidate physical collections off-path, validates
 * them against hard gates, atomically cuts over the active mapping, and can
 * roll back to the previous generation. The legacy SQLite tool
 * (src/scripts/reindex-vector-store.ts) is left untouched.
 *
 * Usage:
 *   npx tsx src/scripts/vector-index-generation.ts build [--dry-run] [--resume] [--logical=<name>]
 *   npx tsx src/scripts/vector-index-generation.ts validate [--logical=<name>]
 *   npx tsx src/scripts/vector-index-generation.ts activate [--logical=<name>]
 *   npx tsx src/scripts/vector-index-generation.ts rollback [--logical=<name>]
 *   npx tsx src/scripts/vector-index-generation.ts report [--logical=<name>]
 */

import { readFileSync } from 'fs';
import path from 'path';
import { resolve } from 'path';
import type { Kysely } from 'kysely';

// Pure helpers (no DB/Qdrant I/O) — importable statically.
import {
  computeNextGeneration,
  buildPhysicalCollectionName,
  logicalCollectionNames,
  organizationForLogicalName,
  evaluateValidationGate,
} from '../lib/vector-store/generation-manager';
import { shouldMirrorToLogicalName } from '../lib/vector-store/dual-write';
import { validateVectorPayload } from '../lib/vector-store/payload-contract';

// Type-only imports (erased at compile time — no runtime module evaluation).
import type { DB } from '../lib/db/db-types';
import type { VectorIndexGeneration } from '../lib/db/compat/vector-index-generations';
import type { DocumentWithCategories } from '../lib/db/compat/documents';

const CHUNKING_VERSION = 1;
const EMBED_BATCH_SIZE = 100;

// Load .env.local / .env manually (same pattern as scripts/backfill-org-tenancy.ts
// and scripts/pre-migration-readiness.ts) so DB/Qdrant env vars are present
// before any runtime module reads them.
function loadEnv(): void {
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

type Command = 'build' | 'validate' | 'activate' | 'rollback' | 'report';

interface CliOptions {
  command: Command;
  dryRun: boolean;
  resume: boolean;
  logical?: string;
}

function parseArgs(args: string[]): CliOptions {
  const command = args[0] as Command | undefined;
  if (!command || !['build', 'validate', 'activate', 'rollback', 'report'].includes(command)) {
    console.error(
      'Usage: vector-index-generation <build|validate|activate|rollback|report> [--dry-run] [--resume] [--logical=<name>]'
    );
    process.exit(2);
  }

  const logicalArg = args.find((a) => a.startsWith('--logical='));

  return {
    command,
    dryRun: args.includes('--dry-run'),
    resume: args.includes('--resume'),
    logical: logicalArg ? logicalArg.slice('--logical='.length) : undefined,
  };
}

interface BuildContext {
  defaultOrgId: number | null;
  embeddingModel: string;
  embeddingDimensions: number;
  categorySlugs: string[];
  categoryOrgMap: Map<string, number | null | undefined>;
  logicalNames: string[];
}

async function loadBuildContext(db: Kysely<DB>): Promise<BuildContext> {
  const { getDefaultOrganizationId } = await import('../lib/org-context');
  const { getEmbeddingSettings } = await import('../lib/db/compat/config');
  const { getAllCategories } = await import('../lib/db/compat/categories');

  const [defaultOrgId, embeddingSettings, categories] = await Promise.all([
    getDefaultOrganizationId(db),
    getEmbeddingSettings(),
    getAllCategories(),
  ]);

  const categorySlugs = categories
    .map((c) => c.slug)
    .filter((slug): slug is string => Boolean(slug));

  const categoryOrgMap = new Map<string, number | null | undefined>();
  for (const category of categories) {
    if (category.slug) {
      categoryOrgMap.set(category.slug, category.organization_id ?? null);
    }
  }

  return {
    defaultOrgId,
    embeddingModel: embeddingSettings.model,
    embeddingDimensions: embeddingSettings.dimensions,
    categorySlugs,
    categoryOrgMap,
    logicalNames: logicalCollectionNames(categorySlugs),
  };
}

function filterLogicalName<T extends { logical_name: string }>(
  rows: T[],
  logical?: string
): T[] {
  return logical ? rows.filter((r) => r.logical_name === logical) : rows;
}

interface BuildTarget {
  logicalName: string;
  physicalName: string;
  generation: number;
  existing?: VectorIndexGeneration;
}

// ============ build ============

async function runBuild(db: Kysely<DB>, opts: CliOptions): Promise<number> {
  const { getCandidateGenerations, listGenerations, createGeneration } = await import(
    '../lib/db/compat/vector-index-generations'
  );
  const { getAllDocumentsWithCategories } = await import('../lib/db/compat/documents');
  const { getVectorStore } = await import('../lib/vector-store');
  const { getGlobalDocsDir, readFileBuffer } = await import('../lib/storage');
  const { extractText, getMimeTypeFromFilename } = await import('../lib/document-extractor');
  const { chunkText } = await import('../lib/ingest');
  const { createEmbeddings } = await import('../lib/openai');
  const { runWithContextAsync } = await import('../lib/request-context');

  const ctx = await loadBuildContext(db);
  const logicalNames = opts.logical
    ? ctx.logicalNames.filter((n) => n === opts.logical)
    : ctx.logicalNames;

  if (logicalNames.length === 0) {
    console.error(`[Build] Unknown logical collection name: ${opts.logical}`);
    return 1;
  }

  const candidates = await getCandidateGenerations();
  const allRows = await listGenerations();

  const candidateByName = new Map(candidates.map((c) => [c.logical_name, c]));
  let buildGeneration: number;
  if (candidateByName.size > 0) {
    const generations = new Set(candidates.map((c) => c.generation));
    if (generations.size > 1) {
      console.error(
        '[Build] Conflicting candidate generations are in progress. Finish or roll back the existing build before starting a new one.'
      );
      return 1;
    }
    buildGeneration = candidates[0].generation;
  } else {
    buildGeneration = computeNextGeneration(allRows.map((r) => r.generation));
  }

  const targets = new Map<string, BuildTarget>();
  for (const logicalName of logicalNames) {
    const existing = candidateByName.get(logicalName);
    targets.set(logicalName, {
      logicalName,
      physicalName: existing
        ? existing.physical_name
        : buildPhysicalCollectionName(logicalName, buildGeneration),
      generation: existing ? existing.generation : buildGeneration,
      existing,
    });
  }

  const readyDocs = (await getAllDocumentsWithCategories()).filter((d) => d.status === 'ready');

  console.log('='.repeat(72));
  console.log('Vector Index Generation — build');
  console.log('='.repeat(72));
  console.log(`Generation:          g${buildGeneration}`);
  console.log(`Embedding model:     ${ctx.embeddingModel} (${ctx.embeddingDimensions} dims)`);
  console.log(`Logical collections: ${logicalNames.length}`);
  console.log(`Ready documents:     ${readyDocs.length}`);
  console.log(`Mode:                ${opts.dryRun ? 'DRY RUN' : 'live'}${opts.resume ? ', resume' : ''}`);
  console.log('');
  for (const target of targets.values()) {
    console.log(
      `  [${target.logicalName}] -> ${target.physicalName}${target.existing ? ' (resume)' : ' (new)'}`
    );
  }
  console.log('='.repeat(72));

  if (opts.dryRun) {
    for (const doc of readyDocs) {
      const shape = { isGlobal: doc.isGlobal, categorySlugs: doc.categories.map((c) => c.slug) };
      const expected = logicalNames.filter((n) => shouldMirrorToLogicalName(n, shape));
      console.log(
        `  - [${doc.id}] ${doc.filename} (global=${doc.isGlobal}, categories=${shape.categorySlugs.join(',') || 'none'}) -> ${expected.join(', ') || 'none'}`
      );
    }
    return 0;
  }

  const store = await getVectorStore();
  const globalDocsDir = getGlobalDocsDir();

  // Create candidate collections with the same config as createCollection()
  // (dense/sparse vectors, cosine, payload indexes incl. organization_id,
  // schemaVersion, generation) and record building rows.
  for (const target of targets.values()) {
    await store.createCollection(target.physicalName);
    if (!target.existing) {
      await createGeneration({
        logicalName: target.logicalName,
        physicalName: target.physicalName,
        generation: target.generation,
        status: 'building',
        embeddingModel: ctx.embeddingModel,
        dimensions: ctx.embeddingDimensions,
        chunkingVersion: CHUNKING_VERSION,
        notes: 'Phase 6 generation build',
      });
    }
  }

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ documentId: number; filename: string; error: string }> = [];
  const counts: Array<{ documentId: number; logicalName: string; expected: number; actual: number }> = [];

  for (let i = 0; i < readyDocs.length; i++) {
    const doc = readyDocs[i];
    const docIdStr = String(doc.id);
    const shape = { isGlobal: doc.isGlobal, categorySlugs: doc.categories.map((c) => c.slug) };
    const expectedLogicalNames = logicalNames.filter((n) => shouldMirrorToLogicalName(n, shape));
    const docTargets = expectedLogicalNames
      .map((n) => targets.get(n))
      .filter((t): t is BuildTarget => Boolean(t));

    if (docTargets.length === 0) {
      continue;
    }

    // Resume / idempotency: skip documents already fully present in every
    // expected candidate collection (chunk count matches the DB record).
    const expectedChunks = doc.chunk_count > 0 ? doc.chunk_count : null;
    if (expectedChunks != null) {
      let allPresent = true;
      for (const target of docTargets) {
        const existingCount = await store.countDocuments(target.physicalName, {
          documentId: docIdStr,
        });
        if (existingCount !== expectedChunks) {
          allPresent = false;
          break;
        }
      }
      if (allPresent) {
        skipped++;
        for (const target of docTargets) {
          counts.push({
            documentId: doc.id,
            logicalName: target.logicalName,
            expected: expectedChunks,
            actual: expectedChunks,
          });
        }
        console.log(`[${i + 1}/${readyDocs.length}] SKIP (already present): ${doc.filename}`);
        continue;
      }
    }

    try {
      const filePath = path.join(globalDocsDir, doc.filepath);
      const buffer = await readFileBuffer(filePath);
      const mimeType = getMimeTypeFromFilename(doc.filename);
      const { text, pages } = await extractText(buffer, mimeType, doc.filename);
      const chunks = await chunkText(text, docIdStr, doc.filename, 'global', undefined, undefined, pages);

      if (chunks.length === 0) {
        console.log(`[${i + 1}/${readyDocs.length}] SKIP (no chunks): ${doc.filename}`);
        skipped++;
        continue;
      }

      for (let j = 0; j < chunks.length; j += EMBED_BATCH_SIZE) {
        const batch = chunks.slice(j, j + EMBED_BATCH_SIZE);
        const texts = batch.map((c) => c.text);
        const embeddings = await createEmbeddings(texts);
        if (embeddings.length !== texts.length) {
          throw new Error(
            `Embedding batch mismatch: expected ${texts.length} embeddings, got ${embeddings.length}.`
          );
        }
        const metadatas = batch.map((c) => c.metadata);
        const ids = batch.map((c) => c.id);

        // Write ONLY to candidate collections, stamped with the per-collection
        // organization derived from document_categories → categories.organization_id
        // (DEFAULT-org fallback), never to the active collections.
        for (const target of docTargets) {
          const orgId = organizationForLogicalName(
            target.logicalName,
            ctx.categoryOrgMap,
            ctx.defaultOrgId
          );
          await runWithContextAsync({ organizationId: orgId ?? undefined }, () =>
            store.addDocuments(target.physicalName, ids, embeddings, texts, metadatas)
          );
        }
      }

      for (const target of docTargets) {
        const actual = await store.countDocuments(target.physicalName, { documentId: docIdStr });
        counts.push({
          documentId: doc.id,
          logicalName: target.logicalName,
          expected: chunks.length,
          actual,
        });
      }

      processed++;
      console.log(`[${i + 1}/${readyDocs.length}] OK (${chunks.length} chunks): ${doc.filename}`);
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ documentId: doc.id, filename: doc.filename, error: message });
      console.log(`[${i + 1}/${readyDocs.length}] FAILED: ${doc.filename} — ${message}`);
    }
  }

  console.log('\n=== Build summary ===');
  console.log(`Processed: ${processed}, skipped (already present): ${skipped}, failed: ${failed}`);
  const diverged = counts.filter((c) => c.expected !== c.actual);
  if (diverged.length > 0) {
    console.log('Expected-vs-verified divergences:');
    for (const d of diverged) {
      console.log(
        `  [doc ${d.documentId}] ${d.logicalName}: expected ${d.expected}, verified ${d.actual}`
      );
    }
  }
  if (errors.length > 0) {
    console.log('Errors:');
    for (const e of errors) {
      console.log(`  [doc ${e.documentId}] ${e.filename}: ${e.error}`);
    }
  }

  return failed > 0 ? 1 : 0;
}

// ============ validate ============

async function runValidate(db: Kysely<DB>, opts: CliOptions): Promise<number> {
  const { getCandidateGenerations, transitionStatus } = await import(
    '../lib/db/compat/vector-index-generations'
  );
  const { getAllDocumentsWithCategories } = await import('../lib/db/compat/documents');
  const { readFeatureFlagCombinations } = await import('../lib/feature-flag-combinations');
  const { getVectorStore } = await import('../lib/vector-store');
  const { runWithContextAsync } = await import('../lib/request-context');

  const ctx = await loadBuildContext(db);
  const candidates = filterLogicalName(await getCandidateGenerations(), opts.logical);

  if (candidates.length === 0) {
    console.error('[Validate] No candidate (building/validating) generation found to validate.');
    return 1;
  }

  const flags = await readFeatureFlagCombinations(db);
  const tenancyEnabled = flags.vectorTenancyEnabled;

  const targets = new Map<string, { logicalName: string; physicalName: string; generation: number }>();
  for (const c of candidates) {
    targets.set(c.logical_name, {
      logicalName: c.logical_name,
      physicalName: c.physical_name,
      generation: c.generation,
    });
  }

  const readyDocs = (await getAllDocumentsWithCategories()).filter((d) => d.status === 'ready');
  const store = await getVectorStore();

  console.log('='.repeat(72));
  console.log('Vector Index Generation — validate');
  console.log('='.repeat(72));
  console.log(`Candidates:         ${candidates.length} collection(s)`);
  console.log(`Ready documents:    ${readyDocs.length}`);
  console.log(`Vector tenancy:     ${tenancyEnabled ? 'enabled' : 'disabled'}`);
  console.log(`Configured dims:    ${ctx.embeddingDimensions} (${ctx.embeddingModel})`);
  console.log('='.repeat(72));

  let documentsRepresented = true;
  let payloadsValid = true;
  let countsMatch = true;
  let dimensionsMatch = true;
  let orgReadsAuthorized = true;
  const details: string[] = [];

  // Distinct organization ids in play (for the negative org-read check).
  const allOrgIds = new Set<number>();
  if (ctx.defaultOrgId != null) allOrgIds.add(ctx.defaultOrgId);
  for (const orgId of ctx.categoryOrgMap.values()) {
    if (orgId != null) allOrgIds.add(orgId);
  }
  const orgIdList = Array.from(allOrgIds).sort((a, b) => a - b);

  // Gate: candidate dimensions match the configured embedding model.
  for (const target of targets.values()) {
    try {
      const size = await store.getCollectionVectorSize(target.physicalName);
      if (size !== ctx.embeddingDimensions) {
        dimensionsMatch = false;
        details.push(
          `[${target.logicalName}] vector size ${size} != configured ${ctx.embeddingDimensions}`
        );
      }
    } catch (error) {
      dimensionsMatch = false;
      details.push(
        `[${target.logicalName}] could not read vector size: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Gates per ready document across each expected logical collection.
  for (const doc of readyDocs) {
    const docIdStr = String(doc.id);
    const shape = { isGlobal: doc.isGlobal, categorySlugs: doc.categories.map((c) => c.slug) };
    const expectedLogicalNames = ctx.logicalNames.filter((n) => shouldMirrorToLogicalName(n, shape));
    const docTargets = expectedLogicalNames
      .map((n) => targets.get(n))
      .filter((t): t is { logicalName: string; physicalName: string; generation: number } => Boolean(t));

    const expectedChunks = doc.chunk_count > 0 ? doc.chunk_count : null;

    for (const target of docTargets) {
      const orgId = organizationForLogicalName(target.logicalName, ctx.categoryOrgMap, ctx.defaultOrgId);

      // Representation + exact-count gates (countDocuments is not org-scoped).
      const actualCount = await store.countDocuments(target.physicalName, { documentId: docIdStr });
      if (actualCount === 0) {
        documentsRepresented = false;
        details.push(`[doc ${doc.id}] missing from ${target.logicalName}`);
      }
      if (expectedChunks != null && actualCount !== expectedChunks) {
        countsMatch = false;
        details.push(
          `[doc ${doc.id}] ${target.logicalName}: expected ${expectedChunks} chunks, found ${actualCount}`
        );
      }

      // Payload-contract + org-aware read gates, performed under the collection's
      // authoritative organization so the read itself exercises tenant scoping.
      const chunks = await runWithContextAsync({ organizationId: orgId ?? undefined }, () =>
        store.getDocumentChunksByDocId(target.physicalName, docIdStr)
      );
      for (const chunk of chunks) {
        const payload = chunk.metadata as unknown as Record<string, unknown>;
        const result = validateVectorPayload(payload, { requireOrganizationId: tenancyEnabled });
        if (!result.valid) {
          payloadsValid = false;
          details.push(
            `[doc ${doc.id}] ${target.logicalName} invalid payload: ${[...result.missing, ...result.errors].join('; ')}`
          );
        }
        if (tenancyEnabled && orgId != null && payload.organization_id !== orgId) {
          orgReadsAuthorized = false;
          details.push(
            `[doc ${doc.id}] ${target.logicalName} chunk stamped org ${String(payload.organization_id)} != expected ${orgId}`
          );
        }
      }

      // Negative check: a different org must see zero chunks.
      if (tenancyEnabled && orgId != null) {
        const wrongOrg = orgIdList.find((o) => o !== orgId) ?? orgId + 1;
        const unauthorized = await runWithContextAsync({ organizationId: wrongOrg }, () =>
          store.getDocumentChunksByDocId(target.physicalName, docIdStr)
        );
        if (unauthorized.length !== 0) {
          orgReadsAuthorized = false;
          details.push(
            `[doc ${doc.id}] ${target.logicalName} leaked ${unauthorized.length} chunk(s) to org ${wrongOrg}`
          );
        }
      }
    }
  }

  const gate = evaluateValidationGate({
    documentsRepresented,
    payloadsValid,
    countsMatch,
    dimensionsMatch,
    orgReadsAuthorized,
  });

  console.log('\n=== Validation gate ===');
  console.log(`${gate.pass ? 'PASS' : 'FAIL'}`);
  if (!gate.pass) {
    console.log('Failed gates:');
    for (const failure of gate.failures) {
      console.log(`  - ${failure}`);
    }
  }
  if (details.length > 0) {
    console.log('\nDetails:');
    for (const detail of details.slice(0, 100)) {
      console.log(`  - ${detail}`);
    }
    if (details.length > 100) {
      console.log(`  ... and ${details.length - 100} more`);
    }
  }

  if (!gate.pass) {
    return 1;
  }

  // On full pass, move building → validating (rows already validating are a no-op).
  for (const candidate of candidates) {
    if (candidate.status === 'building') {
      await transitionStatus(candidate.id, ['building'], 'validating');
      console.log(`[Validate] ${candidate.logical_name} g${candidate.generation} -> validating`);
    }
  }

  console.log('[Validate] All gates passed — candidate generation is ready for activation.');
  return 0;
}

// ============ activate ============

async function runActivate(db: Kysely<DB>, opts: CliOptions): Promise<number> {
  const { getCandidateGenerations, markActive } = await import(
    '../lib/db/compat/vector-index-generations'
  );
  const { invalidateCollectionMappingCache } = await import(
    '../lib/vector-store/collection-resolver'
  );

  const candidates = filterLogicalName(await getCandidateGenerations(), opts.logical);
  if (candidates.length === 0) {
    console.error('[Activate] No candidate generation found to activate.');
    return 1;
  }

  const building = candidates.filter((c) => c.status === 'building');
  if (building.length > 0) {
    console.error(
      `[Activate] ${building.length} candidate(s) are still 'building' — run validate first.`
    );
    for (const b of building) {
      console.error(`  - ${b.logical_name} g${b.generation} (${b.physical_name})`);
    }
    return 1;
  }

  console.log('='.repeat(72));
  console.log('Vector Index Generation — activate (atomic cutover)');
  console.log('='.repeat(72));

  for (const candidate of candidates) {
    await markActive(candidate.logical_name, candidate.generation);
    console.log(
      `  [${candidate.logical_name}] active -> ${candidate.physical_name} (g${candidate.generation})`
    );
  }

  await invalidateCollectionMappingCache();
  console.log('[Activate] Mapping cache invalidated — new requests resolve the new generation.');
  return 0;
}

// ============ rollback ============

async function runRollback(db: Kysely<DB>, opts: CliOptions): Promise<number> {
  const { getActiveMappings, listGenerations, markActive } = await import(
    '../lib/db/compat/vector-index-generations'
  );
  const { invalidateCollectionMappingCache } = await import(
    '../lib/vector-store/collection-resolver'
  );

  const active = filterLogicalName(await getActiveMappings(), opts.logical);
  if (active.length === 0) {
    console.error('[Rollback] No active generation found to roll back.');
    return 1;
  }

  const allRows = await listGenerations();
  const byLogical = new Map<string, VectorIndexGeneration[]>();
  for (const row of allRows) {
    const list = byLogical.get(row.logical_name) ?? [];
    list.push(row);
    byLogical.set(row.logical_name, list);
  }

  console.log('='.repeat(72));
  console.log('Vector Index Generation — rollback');
  console.log('='.repeat(72));

  let restored = 0;
  for (const current of active) {
    const previous = (byLogical.get(current.logical_name) ?? [])
      .filter((r) => r.generation < current.generation)
      .sort((a, b) => b.generation - a.generation)[0];

    if (!previous) {
      console.warn(`  [${current.logical_name}] no previous generation to restore; skipped.`);
      continue;
    }

    await markActive(current.logical_name, previous.generation);
    console.log(
      `  [${current.logical_name}] active -> g${previous.generation} (${previous.physical_name})`
    );
    restored++;
  }

  await invalidateCollectionMappingCache();
  console.log('[Rollback] Mapping cache invalidated — new requests resolve the restored generation.');
  return restored > 0 ? 0 : 1;
}

// ============ report ============

async function runReport(db: Kysely<DB>, opts: CliOptions): Promise<number> {
  const { listGenerations } = await import('../lib/db/compat/vector-index-generations');
  const { getVectorStore } = await import('../lib/vector-store');

  const rows = filterLogicalName(await listGenerations(), opts.logical);
  const store = await getVectorStore();

  const activeByLogical = new Map<string, VectorIndexGeneration>();
  for (const row of rows) {
    if (row.status === 'active') activeByLogical.set(row.logical_name, row);
  }

  console.log('='.repeat(72));
  console.log('Vector Index Generation — report');
  console.log('='.repeat(72));
  console.log(
    `${'logical_name'.padEnd(24)} ${'gen'.padEnd(4)} ${'status'.padEnd(11)} ${'physical_name'.padEnd(34)} count`
  );

  for (const row of rows) {
    const count = await store.countDocuments(row.physical_name).catch(() => -1);
    const countStr = count === -1 ? 'n/a' : String(count);
    let note = '';
    if ((row.status === 'building' || row.status === 'validating') && activeByLogical.has(row.logical_name)) {
      const activeRow = activeByLogical.get(row.logical_name)!;
      const activeCount = await store.countDocuments(activeRow.physical_name).catch(() => -1);
      if (activeCount !== -1 && count !== -1 && activeCount !== count) {
        note = `  (diverges from active by ${count - activeCount})`;
      }
    }
    console.log(
      `${row.logical_name.padEnd(24)} ${`g${row.generation}`.padEnd(4)} ${row.status.padEnd(11)} ${row.physical_name.padEnd(34)} ${countStr}${note}`
    );
  }

  return 0;
}

// ============ entrypoint ============

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));

  const { getDb } = await import('../lib/db/kysely');
  const db = await getDb();

  try {
    switch (opts.command) {
      case 'build':
        return await runBuild(db, opts);
      case 'validate':
        return await runValidate(db, opts);
      case 'activate':
        return await runActivate(db, opts);
      case 'rollback':
        return await runRollback(db, opts);
      case 'report':
        return await runReport(db, opts);
      default:
        console.error(`Unknown command: ${opts.command}`);
        return 2;
    }
  } finally {
    await db.destroy().catch(() => {});
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('[vector-index-generation] Fatal error:', error);
    process.exit(1);
  });

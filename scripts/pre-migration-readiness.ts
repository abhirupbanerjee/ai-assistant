#!/usr/bin/env npx tsx

/**
 * Pre-migration readiness check — AI & API Setup Redesign, Phase B (plan §17).
 *
 * Automates the six readiness gates required before the Phase B backfill:
 *
 *   1. DATA_SOURCE_ENCRYPTION_KEY present and 32 bytes.
 *   2. Every existing encrypted credential decrypts via the legacy format path.
 *   3. No orphaned workspaces (or a documented assignment for each).
 *   4. PostgreSQL/Kysely path active; legacy SQLite modules frozen.
 *   5. Exactly one Default org candidate; no duplicate.
 *   6. Existing provider keys resolve from the same secure source.
 *
 * Usage:
 *   npx tsx scripts/pre-migration-readiness.ts
 *
 * Exits 0 when every check passes; exits 1 when any check fails or a live
 * PostgreSQL connection is unavailable (checks 2, 3, 5, 6 need the database).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local / .env manually (same pattern as scripts/test-connectivity.ts).
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

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

function keKCheck(): CheckResult {
  const key = process.env.DATA_SOURCE_ENCRYPTION_KEY;
  if (!key) {
    return { name: '1. DATA_SOURCE_ENCRYPTION_KEY present (32 bytes)', pass: false, detail: 'missing' };
  }
  if (key.length !== 64) {
    return { name: '1. DATA_SOURCE_ENCRYPTION_KEY present (32 bytes)', pass: false, detail: `length ${key.length} (expected 64 hex chars)` };
  }
  try {
    const buf = Buffer.from(key, 'hex');
    if (buf.length !== 32) {
      return { name: '1. DATA_SOURCE_ENCRYPTION_KEY present (32 bytes)', pass: false, detail: `decoded ${buf.length} bytes` };
    }
  } catch {
    return { name: '1. DATA_SOURCE_ENCRYPTION_KEY present (32 bytes)', pass: false, detail: 'not valid hex' };
  }
  return { name: '1. DATA_SOURCE_ENCRYPTION_KEY present (32 bytes)', pass: true, detail: '32 bytes, hex-encoded' };
}

function legacyFrozenCheck(): CheckResult {
  const indexPath = resolve(process.cwd(), 'src', 'lib', 'db', 'index.ts');
  try {
    const content = readFileSync(indexPath, 'utf-8');
    const frozen = content.includes('FROZEN — LEGACY SQLITE MODULE');
    return {
      name: '4. PostgreSQL/Kysely path active; legacy SQLite modules frozen',
      pass: frozen,
      detail: frozen ? 'legacy SQLite modules carry the FROZEN marker' : 'FROZEN marker not found in src/lib/db/index.ts',
    };
  } catch {
    return { name: '4. PostgreSQL/Kysely path active; legacy SQLite modules frozen', pass: false, detail: 'could not read src/lib/db/index.ts' };
  }
}

function printSummary(results: CheckResult[]): number {
  console.log('\n=== Pre-migration readiness summary ===');
  let failed = 0;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`);
    if (!r.pass) failed += 1;
  }
  console.log(`\n${failed === 0 ? 'READY' : 'NOT READY'} (${results.length - failed}/${results.length} checks passed)`);
  return failed === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  console.log('[Readiness] AI & API Setup Redesign — pre-migration checks (Phase B)');
  const results: CheckResult[] = [];

  // Check 1 (pure) and check 4 (static) run without a database.
  results.push(keKCheck());
  results.push(legacyFrozenCheck());

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    results.push({ name: '4. PostgreSQL/Kysely path active', pass: false, detail: 'DATABASE_URL missing' });
    return printSummary(results);
  }

  try {
    const { getDb } = await import('../src/lib/db/kysely');
    const { getAllProviders, getProviderApiKey } = await import('../src/lib/db/compat/llm-providers');
    const { decrypt } = await import('../src/lib/encryption');
    const { detectOrphanWorkspaces } = await import('../src/lib/organization-backfill');

    const db = await getDb();
    results.push({ name: '4. PostgreSQL/Kysely path active', pass: true, detail: 'connected via Kysely (PostgreSQL)' });

    // Check 2: every encrypted legacy credential decrypts via the legacy path.
    const providers = await getAllProviders();
    let encryptedTotal = 0;
    const failures: string[] = [];
    for (const p of providers) {
      if (!p.apiKey) continue;
      const parts = p.apiKey.split(':');
      if (parts.length !== 3) continue; // not in the encrypted legacy format
      encryptedTotal += 1;
      try {
        decrypt(p.apiKey);
      } catch (err) {
        failures.push(`${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    results.push({
      name: '2. every existing encrypted credential decrypts (legacy path)',
      pass: failures.length === 0,
      detail:
        failures.length === 0
          ? `${encryptedTotal} encrypted credential(s) decrypted OK`
          : `${failures.length}/${encryptedTotal} failed: ${failures.slice(0, 5).join('; ')}`,
    });

    // Check 3: orphan diagnostic.
    const workspaces = await db
      .selectFrom('workspaces')
      .select(['id', 'type', 'created_by', 'organization_id'])
      .execute();
    const orphanInput = workspaces.map((w) => ({
      id: w.id,
      type: w.type,
      createdBy: w.created_by ?? null,
      organizationId: w.organization_id ?? null,
    }));
    const orphans = detectOrphanWorkspaces(orphanInput);
    results.push({
      name: '3. no orphaned workspaces (or documented assignment)',
      pass: orphans.length === 0,
      detail:
        orphans.length === 0
          ? `${workspaces.length} workspace(s), none orphaned`
          : `orphaned: ${orphans.map((o) => `${o.workspaceId} (${o.reason})`).join('; ')}`,
    });

    // Check 5: exactly one Default org candidate, no duplicate.
    const orgs = await db.selectFrom('organizations').select(['id', 'type', 'is_default']).execute();
    const defaultOrgs = orgs.filter((o) => o.type === 'DEFAULT');
    const dupes = defaultOrgs.length > 1;
    const badFlag = defaultOrgs.length === 1 && defaultOrgs[0].is_default !== true;
    results.push({
      name: '5. exactly one Default org candidate; no duplicate',
      pass: !dupes && !badFlag,
      detail:
        dupes
          ? `${defaultOrgs.length} DEFAULT org(s) — duplicate detected`
          : badFlag
            ? 'one DEFAULT org exists but is_default is not true'
            : `${defaultOrgs.length} DEFAULT org candidate(s) (0 = will be created by backfill)`,
    });

    // Check 6: existing provider keys resolve from the same secure source.
    const providerFailures: string[] = [];
    let resolvedCount = 0;
    for (const p of providers) {
      const key = await getProviderApiKey(p.id);
      if (key) resolvedCount += 1;
      else if (p.apiKey) providerFailures.push(`${p.id}: stored key did not resolve`);
    }
    results.push({
      name: '6. existing provider keys resolve from the same secure source',
      pass: providerFailures.length === 0,
      detail: providerFailures.length === 0 ? `${resolvedCount} provider key(s) resolved` : providerFailures.join('; '),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({
      name: 'database-dependent checks (2, 3, 5, 6)',
      pass: false,
      detail: `could not connect to PostgreSQL: ${message}`,
    });
  }

  return printSummary(results);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[Readiness] Fatal error:', err);
    process.exit(1);
  });

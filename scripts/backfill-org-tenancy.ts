#!/usr/bin/env npx tsx

/**
 * Organization tenancy backfill — AI & API Setup Redesign, Phase B (plan §12.3).
 *
 * Idempotent: safe to run multiple times; every step is an INSERT … ON CONFLICT
 * or a NULL-only UPDATE, so a second run is a no-op and counts stay stable.
 *
 *   npx tsx scripts/pre-migration-readiness.ts   # gate first (plan §17)
 *   npx tsx scripts/backfill-org-tenancy.ts
 *
 * The feature flag `org-tenancy-enabled` remains OFF: this backfill writes the
 * new tenancy tables but does not change runtime credential resolution.
 *
 * Legacy rows are never deleted: `llm_providers` keys are mapped into
 * `platform_provider_credentials` as references (secret_ref), and the legacy
 * settings remain intact.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { sql } from 'kysely';

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

interface BackfillReport {
  defaultOrgId: number | null;
  membershipsInserted: number;
  workspacesAssigned: number;
  orphanedWorkspaces: string[];
  tokenUsageAssigned: number;
  platformCredentialsMapped: number;
  capabilityConfigRows: number;
  workspacesNotNullApplied: boolean;
  workspacesNullsRemaining: number;
}

async function main(): Promise<void> {
  console.log('[Backfill] Starting organization tenancy backfill (Phase B)...');

  const { getDb } = await import('../src/lib/db/kysely');
  const { getAllProviders } = await import('../src/lib/db/compat/llm-providers');
  const {
    getLlmSettings,
    getEmbeddingSettings,
    getRerankerSettings,
    getTavilySettings,
    getSpeechSettings,
    getOcrSettings,
  } = await import('../src/lib/db/compat/config');
  const {
    buildDefaultOrgRow,
    isDefaultOrgMissing,
    buildMembershipRows,
    buildWorkspaceAssignments,
    buildTokenUsageAssignments,
    buildPlatformCredentialRows,
    buildCapabilityConfigRows,
    buildProviderReferenceRows,
    buildCapabilityReferenceRows,
  } = await import('../src/lib/organization-backfill');

  const db = await getDb();
  const report: BackfillReport = {
    defaultOrgId: null,
    membershipsInserted: 0,
    workspacesAssigned: 0,
    orphanedWorkspaces: [],
    tokenUsageAssigned: 0,
    platformCredentialsMapped: 0,
    capabilityConfigRows: 0,
    workspacesNotNullApplied: false,
    workspacesNullsRemaining: 0,
  };

  // 0. Seed provider/capability reference rows (satisfies FKs used below).
  await db
    .insertInto('providers')
    .values(buildProviderReferenceRows())
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
  await db
    .insertInto('capabilities')
    .values(buildCapabilityReferenceRows())
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
  console.log('[Backfill] Ensured provider + capability reference rows exist');

  // 1. Create the DEFAULT org exactly once.
  const existingDefault = await db
    .selectFrom('organizations')
    .select(['id', 'type', 'is_default'])
    .where('type', '=', 'DEFAULT')
    .execute();

  let defaultOrgId: number;
  if (isDefaultOrgMissing(existingDefault.map((o) => ({ type: o.type, isDefault: o.is_default })))) {
    const inserted = await db
      .insertInto('organizations')
      .values(buildDefaultOrgRow())
      .returning('id')
      .executeTakeFirstOrThrow();
    defaultOrgId = inserted.id;
    console.log(`[Backfill] Created DEFAULT org (id=${defaultOrgId})`);
  } else {
    const found = existingDefault.find((o) => o.type === 'DEFAULT' && o.is_default === true);
    defaultOrgId = found!.id;
    console.log(`[Backfill] DEFAULT org already exists (id=${defaultOrgId})`);
  }
  report.defaultOrgId = defaultOrgId;

  // 2. Backfill memberships (every active non-super_admin user → member).
  const users = await db.selectFrom('users').select(['id', 'role']).execute();
  const membershipRows = buildMembershipRows(
    users.map((u) => ({ id: u.id, role: u.role })),
    defaultOrgId
  );
  if (membershipRows.length > 0) {
    const insertResults = await db
      .insertInto('organization_memberships')
      .values(
        membershipRows.map((r) => ({
          organization_id: r.organizationId,
          user_id: r.userId,
          role: r.role,
          status: 'active' as const,
        }))
      )
      .onConflict((oc) => oc.columns(['organization_id', 'user_id']).doNothing())
      .execute();
    let inserted = 0;
    for (const result of insertResults) {
      inserted += Number(result.numInsertedOrUpdatedRows ?? 0);
    }
    report.membershipsInserted = inserted;
  }
  console.log(`[Backfill] Memberships: ${report.membershipsInserted} inserted (super_admin excluded)`);

  // 3. Backfill workspaces.organization_id → Default (with orphan diagnostic).
  const workspaceRows = await db
    .selectFrom('workspaces')
    .select(['id', 'type', 'created_by', 'organization_id'])
    .execute();
  const { assignments, orphans } = buildWorkspaceAssignments(
    workspaceRows.map((w) => ({
      id: w.id,
      type: w.type,
      createdBy: w.created_by ?? null,
      organizationId: w.organization_id ?? null,
    })),
    defaultOrgId
  );
  report.orphanedWorkspaces = orphans.map((o) => `${o.workspaceId} (${o.reason})`);
  for (const assignment of assignments) {
    await db
      .updateTable('workspaces')
      .set({ organization_id: assignment.organizationId })
      .where('id', '=', assignment.id)
      .execute();
  }
  report.workspacesAssigned = assignments.length;
  console.log(
    `[Backfill] Workspaces: ${report.workspacesAssigned} assigned to Default; orphans: ${
      report.orphanedWorkspaces.length
    }`
  );
  if (report.orphanedWorkspaces.length > 0) {
    console.warn('[Backfill] Orphaned workspaces (left unassigned):', report.orphanedWorkspaces.join('; '));
  }

  // 4. Backfill token_usage_log.organization_id → Default.
  const usageRows = await db
    .selectFrom('token_usage_log')
    .select(['id', 'organization_id'])
    .execute();
  const usageAssignments = buildTokenUsageAssignments(
    usageRows.map((r) => ({ id: r.id, organizationId: r.organization_id ?? null })),
    defaultOrgId
  );
  if (usageAssignments.length > 0) {
    await db
      .updateTable('token_usage_log')
      .set({ organization_id: defaultOrgId })
      .where('organization_id', 'is', null)
      .execute();
  }
  report.tokenUsageAssigned = usageAssignments.length;
  console.log(`[Backfill] token_usage_log: ${report.tokenUsageAssigned} row(s) assigned to Default`);

  // 5. Map legacy keys → platform_provider_credentials (reference rows).
  const providers = await getAllProviders();

  // Guarantee a `providers` reference row for every legacy provider id so the
  // FK on `platform_provider_credentials.provider_id` cannot be violated by a
  // custom provider added to `llm_providers` outside the default seed.
  for (const p of providers) {
    await db
      .insertInto('providers')
      .values({ id: p.id, name: p.name, enabled: true, sort_order: 1000 })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }

  const credentialRows = buildPlatformCredentialRows(
    providers.map((p) => ({ id: p.id, apiKey: p.apiKey, apiBase: p.apiBase })),
    process.env as Record<string, string | undefined>
  );
  if (credentialRows.length > 0) {
    for (const row of credentialRows) {
      await db
        .insertInto('platform_provider_credentials')
        .values({
          provider_id: row.providerId,
          secret_ref: row.secretRef,
          kek_version: row.kekVersion,
          status: row.status,
          last_verified_at: row.lastVerifiedAt,
        })
        .onConflict((oc) =>
          oc.column('provider_id').doUpdateSet({
            secret_ref: row.secretRef,
            kek_version: row.kekVersion,
            status: row.status,
          })
        )
        .execute();
    }
  }
  report.platformCredentialsMapped = credentialRows.length;
  console.log(`[Backfill] platform_provider_credentials: ${report.platformCredentialsMapped} mapped (legacy rows preserved)`);

  // 6. Map existing settings → Default organization_capability_config.
  const [llm, embeddings, reranker, tavily, speech, ocr] = await Promise.all([
    getLlmSettings(),
    getEmbeddingSettings(),
    getRerankerSettings(),
    getTavilySettings(),
    getSpeechSettings(),
    getOcrSettings(),
  ]);
  const capabilityRows = buildCapabilityConfigRows({
    llm: { model: llm.model },
    embeddings: { model: embeddings.model },
    reranker: { enabled: reranker.enabled, providers: reranker.providers },
    tavily: { enabled: tavily.enabled },
    speech: { stt: { default: speech.stt.default }, tts: { primaryProvider: speech.tts.primaryProvider } },
    ocr: { providers: ocr.providers },
  });
  if (capabilityRows.length > 0) {
    for (const row of capabilityRows) {
      await db
        .insertInto('organization_capability_config')
        .values({
          organization_id: defaultOrgId,
          capability_id: row.capabilityId,
          provider_id: row.providerId,
          credential_id: null,
          model_or_service_id: row.modelOrServiceId,
          enabled: row.enabled,
          configuration: row.configuration,
        })
        .onConflict((oc) => oc.columns(['organization_id', 'capability_id']).doNothing())
        .execute();
    }
  }
  report.capabilityConfigRows = capabilityRows.length;
  console.log(`[Backfill] organization_capability_config: ${report.capabilityConfigRows} mapped`);

  // 7. Verify zero nulls; apply NOT NULL only after verification (plan §4/§12.3).
  const nullCount = await db
    .selectFrom('workspaces')
    .select(sql<number>`COUNT(*)`.as('count'))
    .where('organization_id', 'is', null)
    .executeTakeFirst();
  report.workspacesNullsRemaining = Number(nullCount?.count ?? 0);

  if (report.workspacesNullsRemaining === 0) {
    try {
      await sql`ALTER TABLE workspaces ALTER COLUMN organization_id SET NOT NULL`.execute(db);
      report.workspacesNotNullApplied = true;
      console.log('[Backfill] Verified zero nulls — applied workspaces.organization_id NOT NULL');
    } catch (err) {
      console.warn('[Backfill] Could not apply NOT NULL constraint:', err instanceof Error ? err.message : err);
    }
  } else {
    console.warn(
      `[Backfill] workspaces.organization_id still has ${report.workspacesNullsRemaining} null(s) (orphans) — NOT NULL NOT applied`
    );
  }

  console.log('\n=== Backfill report ===');
  console.log(JSON.stringify(report, null, 2));
  console.log('[Backfill] Done.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Backfill] Fatal error:', err);
    process.exit(1);
  });

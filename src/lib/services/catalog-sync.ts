/**
 * Catalog Sync — snapshot-hash drift detection
 *
 * Implements the §5 sync flow:
 *   - Discover models from a provider API
 *   - Upsert into `model_catalog` with drift detection
 *   - New models arrive disabled (status='new')
 *   - Changed models (self-describing providers only): append snapshot, set pending_changes=true
 *   - Gone models: set status='retired' (never DELETE)
 *   - Serialized via in-process mutex + Postgres advisory lock
 *   - Non-destructive, idempotent
 *
 * Curated fields (price, context window, capability_tier, capability_scores)
 * are NEVER overwritten by sync — only API-observable fields contribute to
 * the snapshot_hash.
 */

import { createHash } from 'crypto';
import { getDb, sql, transaction } from '../db/kysely';
import { discoverModels } from './model-discovery';
import type { DiscoveredModel } from './model-discovery';

// ─── Types ───────────────────────────────────────────────────────────

export interface SyncResult {
  provider: string;
  newModels: string[];
  changedModels: string[];
  retiredModels: string[];
  unchanged: number;
  errors: string[];
}

// ─── Serialization ───────────────────────────────────────────────────

/** In-process mutex: prevents concurrent syncs within the same Node process. */
let syncInProgress = false;

/**
 * Postgres advisory-lock key namespace for catalog sync.
 * Uses a fixed 64-bit key so multiple processes don't interleave.
 */
const ADVISORY_LOCK_KEY = 0x0c4a70_01; // 'catalog_sync' — arbitrary stable key

async function acquireAdvisoryLock(): Promise<boolean> {
  const db = await getDb();
  const result = await sql<{ pg_try_advisory_lock: boolean }>`
    SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}::bigint)
  `.execute(db);
  return result.rows[0]?.pg_try_advisory_lock ?? false;
}

async function releaseAdvisoryLock(): Promise<void> {
  const db = await getDb();
  await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY}::bigint)`.execute(db);
}

// ─── Snapshot Hash ───────────────────────────────────────────────────

/**
 * Compute the snapshot_hash over API-observable fields only.
 *
 * For metadata-poor providers (Fireworks returns only {id, object}), this
 * is effectively presence-only — the hash is deterministic from the model ID.
 * For self-describing providers, API-returned attributes (context window,
 * modality, pricing if returned) are included so drift is detected.
 *
 * Curated fields (capability_tier, capability_scores, manifest-derived
 * capability flags) are EXCLUDED — otherwise the first post-migration sync
 * flags every seeded row as 'changed'.
 */
function computeSnapshotHash(model: {
  id: string;
  transportModelId: string;
  maxInputTokens: number | null;
  maxOutputTokens: number;
  provider: string;
}): string {
  // Only API-observable fields: identity + token limits (if the API returns them)
  const hashInput = JSON.stringify({
    id: model.transportModelId,
    max_input_tokens: model.maxInputTokens,
    max_output_tokens: model.maxOutputTokens,
  });
  return createHash('sha256').update(hashInput).digest('hex').slice(0, 32);
}

// ─── Alias Transform (§3) ────────────────────────────────────────────

const FIREWORKS_PREFIX = 'accounts/fireworks/models/';

function toTransportId(providerId: string, aliasId: string): string {
  if (providerId === 'fireworks' && aliasId.startsWith('fireworks/')) {
    return FIREWORKS_PREFIX + aliasId.slice('fireworks/'.length);
  }
  return aliasId;
}

// ─── Core Sync ───────────────────────────────────────────────────────

/**
 * Sync a single provider's models into `model_catalog`.
 *
 * Steps:
 * 1. Discover models via the provider's discovery function.
 * 2. For each discovered model:
 *    a. Compute snapshot_hash
 *    b. If not in catalog → INSERT with status='new'
 *    c. If in catalog and hash unchanged → UPDATE catalog_seen_at only
 *    d. If in catalog and hash changed → append prior row to
 *       model_catalog_snapshot, set pending_changes=true (do NOT overwrite
 *       curated values)
 * 3. For models in catalog (status != 'retired') but not in API response →
 *    set status='retired'
 * 4. Invalidate quality cache on status transitions.
 *
 * @param providerId - Provider ID (e.g. 'fireworks', 'openai')
 * @returns SyncResult with counts and IDs per drift category
 */
export async function syncProviderCatalog(providerId: string): Promise<SyncResult> {
  const result: SyncResult = {
    provider: providerId,
    newModels: [],
    changedModels: [],
    retiredModels: [],
    unchanged: 0,
    errors: [],
  };

  // In-process mutex
  if (syncInProgress) {
    result.errors.push('Another catalog sync is already in progress');
    return result;
  }
  syncInProgress = true;

  // Advisory lock for cross-process serialization
  const locked = await acquireAdvisoryLock().catch(() => true);
  if (!locked) {
    syncInProgress = false;
    result.errors.push('Could not acquire advisory lock — another process is syncing');
    return result;
  }

  try {
    // 1. Discover models
    const discovery = await discoverModels(providerId);
    if (!discovery.success) {
      result.errors.push(discovery.error ?? 'Discovery failed');
      return result;
    }

    const discoveredModels = discovery.models;
    const discoveredByTransportId = new Map<string, DiscoveredModel>();
    for (const m of discoveredModels) {
      const transportId = toTransportId(providerId, m.id);
      discoveredByTransportId.set(transportId, m);
    }

    // 2. Load existing catalog rows for this provider (non-retired)
    const db = await getDb();
    const existingRows = await sql<{
      id: string;
      transport_model_id: string;
      snapshot_hash: string | null;
      status: string;
      max_input_tokens: number | null;
      max_output_tokens: number | null;
    }>`
      SELECT id, transport_model_id, snapshot_hash, status,
             max_input_tokens, max_output_tokens
      FROM model_catalog
      WHERE provider_id = ${providerId}
    `.execute(db);

    const existingByTransportId = new Map<string, typeof existingRows.rows[number]>();
    for (const row of existingRows.rows) {
      existingByTransportId.set(row.transport_model_id, row);
    }

    // 3. Process discovered models: new vs changed vs unchanged
    const hasStatusTransition = { value: false };

    for (const [transportId, discovered] of discoveredByTransportId) {
      const snapshotHash = computeSnapshotHash({
        id: discovered.id,
        transportModelId: transportId,
        maxInputTokens: discovered.maxInputTokens,
        maxOutputTokens: discovered.maxOutputTokens,
        provider: providerId,
      });

      const existing = existingByTransportId.get(transportId);

      if (!existing) {
        // 3a. New model → INSERT with status='new'
        await sql`
          INSERT INTO model_catalog (
            id, provider_id, capability_id, transport_model_id,
            max_input_tokens, max_output_tokens,
            catalog_source, catalog_seen_at, snapshot_hash,
            status, pending_changes
          ) VALUES (
            ${discovered.id}, ${providerId}, 'llm', ${transportId},
            ${discovered.maxInputTokens}, ${discovered.maxOutputTokens},
            'discovery', NOW(), ${snapshotHash},
            'new', false
          )
          ON CONFLICT (provider_id, transport_model_id) DO UPDATE
            SET catalog_seen_at = NOW()
        `.execute(db);
        result.newModels.push(discovered.id);
        hasStatusTransition.value = true;
      } else if (existing.snapshot_hash === snapshotHash) {
        // 3b. Unchanged → just refresh catalog_seen_at
        await sql`
          UPDATE model_catalog
          SET catalog_seen_at = NOW()
          WHERE id = ${existing.id}
        `.execute(db);
        result.unchanged++;
        // If was retired and is now back → re-activate
        if (existing.status === 'retired') {
          await sql`
            UPDATE model_catalog SET status = 'active' WHERE id = ${existing.id}
          `.execute(db);
          hasStatusTransition.value = true;
        }
      } else {
        // 3c. Changed → append prior row to snapshot, set pending_changes=true
        //     Do NOT overwrite curated values
        await sql`
          INSERT INTO model_catalog_snapshot (
            catalog_id, snapshot_hash, captured_at,
            max_input_tokens, max_output_tokens
          ) VALUES (
            ${existing.id}, ${existing.snapshot_hash}, NOW(),
            ${existing.max_input_tokens}, ${existing.max_output_tokens}
          )
        `.execute(db);
        await sql`
          UPDATE model_catalog
          SET pending_changes = true,
              catalog_seen_at = NOW(),
              snapshot_hash = ${snapshotHash}
          WHERE id = ${existing.id}
        `.execute(db);
        result.changedModels.push(discovered.id);
      }
    }

    // 4. Retire models in catalog but not in API response
    for (const [transportId, existing] of existingByTransportId) {
      if (!discoveredByTransportId.has(transportId) && existing.status !== 'retired') {
        await sql`
          UPDATE model_catalog
          SET status = 'retired', updated_at = NOW()
          WHERE id = ${existing.id}
        `.execute(db);
        result.retiredModels.push(existing.id);
        hasStatusTransition.value = true;
      }
    }

    // 5. Invalidate quality cache on status transitions
    if (hasStatusTransition.value) {
      import('@/lib/model-quality')
        .then(m => m.invalidateQualityCache())
        .catch(() => {});
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);
    console.error(`[CatalogSync] Error syncing ${providerId}:`, message);
    return result;
  } finally {
    await releaseAdvisoryLock().catch(() => {});
    syncInProgress = false;
  }
}

/**
 * Sync all configured providers' catalogs.
 *
 * Runs each provider sync sequentially (not in parallel) to avoid
 * interleaving upserts within the advisory lock window.
 */
export async function syncAllProviderCatalogs(): Promise<SyncResult[]> {
  const providers = [
    'openai',
    'gemini',
    'mistral',
    'anthropic',
    'deepseek',
    'fireworks',
    'moonshot',
    'ollama-cloud',
    'azure-foundry',
  ];

  const results: SyncResult[] = [];
  for (const provider of providers) {
    const result = await syncProviderCatalog(provider);
    results.push(result);
  }
  return results;
}

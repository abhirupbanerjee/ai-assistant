/**
 * Per-provider org-aware credential resolution — AI & API Setup Redesign,
 * Phase D (plan §7, §12.3).
 *
 * `resolveCapability()` (src/lib/capability-resolver.ts) is capability-first:
 * it maps a capability to a single provider/credential. Several runtime modules
 * route by *provider* instead — the LLM modules (llm-client, llm-router,
 * openai.ts) dispatch on the model prefix, and the reranker/STT iterate a
 * provider chain. This module provides the provider-keyed equivalent of the
 * same dual-read resolution, built on the same primitives (feature flag,
 * organization lookup with DEFAULT fallback, credential selection, vault
 * decryption).
 *
 * Parity guarantee: while `org-credential-resolver-enabled` is OFF the legacy
 * key source is used (byte-for-byte the pre-Phase-D behavior). When ON, a
 * `PLATFORM_MANAGED` org (including the DEFAULT org) resolves to the platform
 * credential — the same `getApiKey`/`getApiBase` source — so DEFAULT-org
 * parity holds by construction. An `ORGANIZATION_BYOK` org resolves only its
 * own credential, with no platform fallback (Decision 5 / §6).
 *
 * The companion `sharedProviderClientFactory` is the Phase C LRU keyed by
 * `credential_id + credential_version`; callers obtain clients from it so no
 * module-scope provider client singletons remain.
 */

import type { Kysely } from 'kysely';
import type { DB } from './db/db-types';
import { getDb } from './db/kysely';
import { readFeatureFlagCombinations } from './feature-flag-combinations';
import {
  ProviderClientFactory,
  selectCredentialForProvider,
  type CredentialRef,
} from './provider-client-factory';
import { decryptCredentialSecret } from './credential-vault';
import { getApiKey, getApiBase } from './provider-helpers';
import { getRerankerSettings } from './db/compat/config';
import { getRequestContext } from './request-context';

// ============================================================================
// Shared factory (LRU keyed by credential_id + credential_version)
// ============================================================================

/**
 * Process-wide provider client factory. Replaces the removed module-scope
 * `let xClient: … | null` singletons. Entries are keyed by
 * `credential_id + credential_version` (see src/lib/provider-client-factory.ts),
 * so a key replace/disable/rotation bumps the version and invalidates the entry
 * across Next.js worker processes.
 */
export const sharedProviderClientFactory = new ProviderClientFactory();

// ============================================================================
// Types
// ============================================================================

export interface ResolvedProviderCredential {
  providerId: string;
  /** Stable credential id (`platform`, `legacy`, an org `credential_id`, or `unavailable`). */
  credentialId: string;
  credentialVersion: number;
  apiKey: string | null;
  apiBase: string | null;
  available: boolean;
}

// Providers whose "configured" condition is a base URL rather than an API key.
const BASE_URL_PROVIDERS = new Set(['ollama', 'azure-foundry']);

function isAvailable(
  providerId: string,
  apiKey: string | null,
  apiBase: string | null
): boolean {
  return BASE_URL_PROVIDERS.has(providerId) ? !!apiBase : !!apiKey;
}

// ============================================================================
// Legacy / platform key sources (parity with pre-Phase-D behavior)
// ============================================================================

/**
 * The legacy key source — exactly what the converted modules read before
 * Phase D. Used while `org-credential-resolver-enabled` is OFF.
 *
 * `cohere` is special-cased: the reranker is its only consumer and its key
 * lives in reranker settings (Settings > Reranker), not the `llm_providers`
 * table. This mirrors `loadLegacyResolution('reranking')`.
 */
async function resolveLegacy(providerId: string): Promise<ResolvedProviderCredential> {
  if (providerId === 'cohere') {
    const settings = await getRerankerSettings();
    const apiKey = settings.cohereApiKey || process.env.COHERE_API_KEY || null;
    return {
      providerId,
      credentialId: 'legacy',
      credentialVersion: 0,
      apiKey,
      apiBase: null,
      available: !!apiKey,
    };
  }

  const apiKey = await getApiKey(providerId);
  const apiBase = await getApiBase(providerId);
  return {
    providerId,
    credentialId: 'legacy',
    credentialVersion: 0,
    apiKey,
    apiBase,
    available: isAvailable(providerId, apiKey, apiBase),
  };
}

/**
 * The platform credential — the same key source as legacy for
 * `PLATFORM_MANAGED` orgs, which is what preserves DEFAULT-org parity.
 */
/**
 * Resolve the canonical platform credential source and its persisted revision.
 *
 * Platform secret material remains in the legacy secure stores (`llm_providers`,
 * settings, or environment). `platform_provider_credentials` only supplies
 * lifecycle status and a version that invalidates cached SDK clients whenever a
 * canonical platform provider row changes. An absent metadata row intentionally
 * retains legacy availability during rollout.
 */
export async function resolvePlatformProviderCredential(
  db: Kysely<DB>,
  providerId: string
): Promise<ResolvedProviderCredential> {
  const metadata = await db
    .selectFrom('platform_provider_credentials')
    .select(['status', 'credential_version'])
    .where('provider_id', '=', providerId)
    .executeTakeFirst();
  const enabled = metadata?.status !== 'disabled';
  const credentialVersion = metadata?.credential_version ?? 0;

  if (providerId === 'cohere') {
    const settings = await getRerankerSettings();
    const apiKey = settings.cohereApiKey || process.env.COHERE_API_KEY || null;
    return {
      providerId,
      credentialId: 'platform',
      credentialVersion,
      apiKey: enabled ? apiKey : null,
      apiBase: null,
      available: enabled && !!apiKey,
    };
  }

  const apiKey = await getApiKey(providerId);
  const apiBase = await getApiBase(providerId);
  return {
    providerId,
    credentialId: 'platform',
    credentialVersion,
    apiKey: enabled ? apiKey : null,
    apiBase: enabled ? apiBase : null,
    available: enabled && isAvailable(providerId, apiKey, apiBase),
  };
}

// ============================================================================
// Organization lookup
// ============================================================================

async function loadOrganization(
  db: Kysely<DB>,
  orgId: number | null
): Promise<{ id: number; type: string; is_default: boolean; credential_mode: string } | null> {
  if (orgId != null) {
    const org = await db
      .selectFrom('organizations')
      .select(['id', 'type', 'is_default', 'credential_mode'])
      .where('id', '=', orgId)
      .executeTakeFirst();
    // Fail closed: a requested org id that does not exist must NOT silently
    // fall back to the DEFAULT org (which would leak platform keys to a
    // mistargeted tenant request). Only an absent org id uses the DEFAULT.
    return org ?? null;
  }

  // Fall back to the DEFAULT org when no org is provided (parity path).
  const def = await db
    .selectFrom('organizations')
    .select(['id', 'type', 'is_default', 'credential_mode'])
    .where('is_default', '=', true)
    .orderBy('id')
    .limit(1)
    .executeTakeFirst();
  return def ?? null;
}

async function resolveByokCredential(
  db: Kysely<DB>,
  orgId: number,
  providerId: string
): Promise<ResolvedProviderCredential | null> {
  const rows = await db
    .selectFrom('organization_provider_credentials')
    .select([
      'provider_id',
      'credential_id',
      'credential_version',
      'status',
      'is_default',
      'secret_ciphertext',
      'dek_wrapped',
      'aad',
      'kek_version',
    ])
    .where('organization_id', '=', orgId)
    .where('provider_id', '=', providerId)
    .execute();

  if (rows.length === 0) return null;

  const selected = selectCredentialForProvider(
    rows.map((r) => ({
      credentialId: r.credential_id,
      status: r.status,
      isDefault: r.is_default,
    })),
    null
  );
  if (!selected) return null;

  const row = rows.find((r) => r.credential_id === selected.credentialId);
  if (!row) return null;

  let apiKey: string | null = null;
  try {
    apiKey = decryptCredentialSecret({
      organizationId: orgId,
      providerId: row.provider_id,
      credentialId: row.credential_id,
      secretCiphertext: row.secret_ciphertext,
      dekWrapped: row.dek_wrapped,
      aad: row.aad,
      kekVersion: row.kek_version,
    });
  } catch (error) {
    console.error('[provider-credential] Failed to decrypt org credential:', error);
    apiKey = null;
  }

  return {
    providerId,
    credentialId: row.credential_id,
    credentialVersion: row.credential_version,
    apiKey,
    apiBase: null,
    available: !!apiKey,
  };
}

/**
 * Resolve exactly one organization credential by its stable id. Unlike the
 * provider-level resolver, this never substitutes a default or sibling key.
 * It is used by credential testing and other identity-specific actions.
 */
export async function resolveOrganizationCredentialById(
  db: Kysely<DB>,
  orgId: number,
  providerId: string,
  credentialId: string
): Promise<ResolvedProviderCredential> {
  const row = await db
    .selectFrom('organization_provider_credentials')
    .select([
      'provider_id',
      'credential_id',
      'credential_version',
      'status',
      'secret_ciphertext',
      'dek_wrapped',
      'aad',
      'kek_version',
    ])
    .where('organization_id', '=', orgId)
    .where('provider_id', '=', providerId)
    .where('credential_id', '=', credentialId)
    .executeTakeFirst();

  if (!row || row.status !== 'active') {
    return {
      providerId,
      credentialId,
      credentialVersion: row?.credential_version ?? 0,
      apiKey: null,
      apiBase: null,
      available: false,
    };
  }

  let apiKey: string | null = null;
  try {
    apiKey = decryptCredentialSecret({
      organizationId: orgId,
      providerId: row.provider_id,
      credentialId: row.credential_id,
      secretCiphertext: row.secret_ciphertext,
      dekWrapped: row.dek_wrapped,
      aad: row.aad,
      kekVersion: row.kek_version,
    });
  } catch (error) {
    console.error('[provider-credential] Failed to decrypt requested org credential:', error);
  }

  return {
    providerId,
    credentialId,
    credentialVersion: row.credential_version,
    apiKey,
    apiBase: null,
    available: !!apiKey,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve the credential for a provider in an org-aware, flag-gated way.
 *
 * - OFF flag  → legacy key source.
 * - ON flag   → `PLATFORM_MANAGED` → platform credential;
 *               `ORGANIZATION_BYOK` → org credential (no platform fallback).
 */
export async function resolveProviderCredential(
  db: Kysely<DB>,
  orgId: number | null,
  providerId: string
): Promise<ResolvedProviderCredential> {
  const flags = await readFeatureFlagCombinations(db);
  if (!flags.orgCredentialResolverEnabled) {
    return resolveLegacy(providerId);
  }

  const org = await loadOrganization(db, orgId);
  // Fail closed: when the organization cannot be resolved (e.g. a stale /
  // mistargeted org id, or no DEFAULT org at all), return UNAVAILABLE rather
  // than silently defaulting to platform keys.
  if (!org) {
    return {
      providerId,
      credentialId: 'unavailable',
      credentialVersion: 0,
      apiKey: null,
      apiBase: null,
      available: false,
    };
  }

  if (org.credential_mode !== 'ORGANIZATION_BYOK') {
    return resolvePlatformProviderCredential(db, providerId);
  }

  const byok = await resolveByokCredential(db, org.id, providerId);
  if (byok) return byok;

  return {
    providerId,
    credentialId: 'unavailable',
    credentialVersion: 0,
    apiKey: null,
    apiBase: null,
    available: false,
  };
}

/**
 * Resolve a provider credential for the current request. Reads the DB instance
 * and the request context (`organizationId`) so converted call sites do not
 * need to thread `db`/`orgId` through every layer. Absent org → DEFAULT org.
 */
export async function resolveProviderCredentialForRequest(
  providerId: string
): Promise<ResolvedProviderCredential> {
  const db = await getDb();
  const orgId = getRequestContext().organizationId ?? null;
  return resolveProviderCredential(db, orgId, providerId);
}

/** Build a `CredentialRef` from a resolved credential (for factory callers). */
export function toCredentialRef(
  resolved: ResolvedProviderCredential,
  overrides: Partial<CredentialRef> = {}
): CredentialRef {
  return {
    providerId: resolved.providerId,
    credentialId: resolved.credentialId,
    credentialVersion: resolved.credentialVersion,
    apiKey: resolved.apiKey,
    apiBase: resolved.apiBase,
    ...overrides,
  };
}

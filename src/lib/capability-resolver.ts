/**
 * Capability resolver — AI & API Setup Redesign, Phase C (plan §7, §12.3).
 *
 * `resolveCapability(orgId, capability, request)` is the dual-read resolver:
 *
 *   "new config present → use it; absent → legacy fallback"
 *
 * Credential modes:
 *   - PLATFORM_MANAGED → resolve the platform credential for the configured
 *     provider.
 *   - ORGANIZATION_BYOK → resolve the org credential (by `credential_id`, else
 *     `is_default`); when the org credential is missing/invalid the capability
 *     is UNAVAILABLE — there is NO silent platform fallback.
 *
 * The `org-credential-resolver-enabled` feature flag gates which path is the
 * runtime path. While OFF (rollback), the legacy path is used. Since Phase D it
 * defaults ON, and the runtime callers resolve through `resolveCapability` /
 * `resolveProviderCredential` (src/lib/provider-credential.ts). The DEFAULT org
 * parity path: a DEFAULT org is `PLATFORM_MANAGED` and its config rows were
 * mapped from legacy settings in Phase B, so the new path resolves to the same
 * provider/model/key as legacy.
 *
 * The pure decision core (`resolveCapabilityCore`) is database-free and
 * unit-testable; the async functions below read the Kysely tables and the
 * legacy settings modules and feed that core.
 */

import type { Kysely } from 'kysely';
import type { DB } from './db/db-types';
import type { CapabilityId, CapabilityImportance } from './provider-registry';
import { REGISTRY_CAPABILITIES } from './provider-registry';
import type { CredentialMode } from './organization';
import { readFeatureFlagCombinations } from './feature-flag-combinations';
import { decryptCredentialSecret } from './credential-vault';
import { inferProviderFromModel } from './organization-backfill';
import {
  selectCredentialForProvider,
  type CredentialRef,
} from './provider-client-factory';
import type { HealthState } from './health-evaluator';
import { capabilityDisplayName } from './health-evaluator';
import { getApiKey, getApiBase } from './provider-helpers';
import {
  getLlmSettings,
  getEmbeddingSettings,
  getRerankerSettings,
  getTavilySettings,
  getSpeechSettings,
  getOcrSettings,
} from './db/compat/config';

// ============================================================================
// Types
// ============================================================================

export type ResolveSource = 'organization' | 'platform' | 'legacy' | 'none';

export interface CapabilityConfigCandidate {
  providerId: string;
  credentialId: string | null;
  modelOrServiceId: string | null;
  enabled: boolean;
}

export interface OrgCredentialCandidate {
  providerId: string;
  credentialId: string;
  credentialVersion: number;
  status: string;
  isDefault: boolean;
  apiKey: string | null;
  apiBase: string | null;
}

export interface PlatformCredentialCandidate {
  providerId: string;
  status: string;
  apiKey: string | null;
  apiBase: string | null;
}

export interface LegacyCandidate {
  providerId: string | null;
  modelOrServiceId: string | null;
  apiKey: string | null;
  apiBase: string | null;
  available: boolean;
}

export interface ResolvedCapability {
  capabilityId: CapabilityId;
  importance: CapabilityImportance;
  providerId: string | null;
  modelOrServiceId: string | null;
  credentialMode: CredentialMode | 'LEGACY';
  source: ResolveSource;
  /** Client construction input for `ProviderClientFactory` (null → unavailable). */
  credentialRef: CredentialRef | null;
  health: HealthState;
  available: boolean;
  warnings: string[];
}

export interface ResolveInput {
  capability: CapabilityId;
  importance: CapabilityImportance;
  orgType: string;
  isDefaultOrg: boolean;
  credentialMode: CredentialMode;
  config: CapabilityConfigCandidate | null;
  orgCredentials: OrgCredentialCandidate[];
  platformCredentials: PlatformCredentialCandidate[];
  legacy: LegacyCandidate;
}

export interface ResolveRequest {
  /** Optional workspace-level model override used by the legacy LLM fallback. */
  workspaceModel?: string | null;
}

// ============================================================================
// Pure decision core (database-free)
// ============================================================================

function legacyRef(legacy: LegacyCandidate): CredentialRef | null {
  if (!legacy.providerId) return null;
  return {
    providerId: legacy.providerId,
    credentialId: 'legacy',
    credentialVersion: 0,
    apiKey: legacy.apiKey,
    apiBase: legacy.apiBase,
  };
}

function buildResult(
  input: ResolveInput,
  partial: {
    state: HealthState;
    providerId: string | null;
    modelOrServiceId: string | null;
    source: ResolveSource;
    credentialMode: CredentialMode | 'LEGACY';
    credentialRef: CredentialRef | null;
    warnings: string[];
  }
): ResolvedCapability {
  return {
    capabilityId: input.capability,
    importance: input.importance,
    providerId: partial.providerId,
    modelOrServiceId: partial.modelOrServiceId,
    credentialMode: partial.credentialMode,
    source: partial.source,
    credentialRef: partial.credentialRef,
    health: partial.state,
    available: partial.state === 'READY' && partial.credentialRef !== null,
    warnings: partial.warnings,
  };
}

/** "absent → legacy fallback": no new config row, so delegate to legacy. */
function resolveLegacy(input: ResolveInput): ResolvedCapability {
  const { legacy } = input;
  if (legacy.available && legacy.providerId) {
    return buildResult(input, {
      state: 'READY',
      providerId: legacy.providerId,
      modelOrServiceId: legacy.modelOrServiceId,
      source: 'legacy',
      credentialMode: 'LEGACY',
      credentialRef: legacyRef(legacy),
      warnings: [],
    });
  }

  const warnings =
    input.importance === 'REQUIRED'
      ? [`${capabilityDisplayName(input.capability)} is not configured (required capability)`]
      : [];
  return buildResult(input, {
    state: 'NOT_CONFIGURED',
    providerId: legacy.providerId,
    modelOrServiceId: legacy.modelOrServiceId,
    source: 'legacy',
    credentialMode: 'LEGACY',
    credentialRef: null,
    warnings,
  });
}

function resolvePlatform(input: ResolveInput): ResolvedCapability {
  const providerId = input.config!.providerId;
  const platform = input.platformCredentials.find(
    (p) => p.providerId === providerId && p.status === 'active'
  );
  const hasCredential =
    !!platform &&
    (providerId === 'ollama' ? !!platform.apiBase : !!platform.apiKey);

  if (!hasCredential) {
    return buildResult(input, {
      state: 'UNAVAILABLE',
      providerId,
      modelOrServiceId: input.config!.modelOrServiceId,
      source: 'platform',
      credentialMode: 'PLATFORM_MANAGED',
      credentialRef: null,
      warnings: [`${providerId} platform credential is missing`],
    });
  }

  return buildResult(input, {
    state: 'READY',
    providerId,
    modelOrServiceId: input.config!.modelOrServiceId,
    source: 'platform',
    credentialMode: 'PLATFORM_MANAGED',
    credentialRef: {
      providerId,
      credentialId: 'platform',
      credentialVersion: 0,
      apiKey: platform!.apiKey,
      apiBase: platform!.apiBase,
    },
    warnings: [],
  });
}

function resolveByok(input: ResolveInput): ResolvedCapability {
  const config = input.config!;
  const providerId = config.providerId;
  const selected = selectCredentialForProvider(
    input.orgCredentials.filter((c) => c.providerId === providerId),
    config.credentialId
  );

  const hasKey = !!selected && !!selected.apiKey;
  if (!hasKey) {
    // NO platform fallback — the defining BYOK rule.
    return buildResult(input, {
      state: 'UNAVAILABLE',
      providerId,
      modelOrServiceId: config.modelOrServiceId,
      source: 'organization',
      credentialMode: 'ORGANIZATION_BYOK',
      credentialRef: null,
      warnings: [
        `BYOK credential for ${providerId} is missing or invalid (no platform fallback)`,
      ],
    });
  }

  return buildResult(input, {
    state: 'READY',
    providerId,
    modelOrServiceId: config.modelOrServiceId,
    source: 'organization',
    credentialMode: 'ORGANIZATION_BYOK',
    credentialRef: {
      providerId,
      credentialId: selected!.credentialId,
      credentialVersion: selected!.credentialVersion,
      apiKey: selected!.apiKey,
      apiBase: selected!.apiBase,
    },
    warnings: [],
  });
}

/**
 * The pure dual-read decision core.
 *
 *   1. No `organization_capability_config` row → legacy fallback.
 *   2. Config row disabled → NOT_CONFIGURED (explicit off).
 *   3. PLATFORM_MANAGED → platform credential (UNAVAILABLE when missing).
 *   4. ORGANIZATION_BYOK → org credential (UNAVAILABLE when missing; no
 *      platform fallback).
 */
export function resolveCapabilityCore(input: ResolveInput): ResolvedCapability {
  if (!input.config) {
    // Guardrail (plan §6/§7): an ORGANIZATION_BYOK org with no capability
    // config row must NOT silently fall back to legacy/platform keys. The
    // legacy fallback remains the PLATFORM_MANAGED (and DEFAULT) parity path.
    if (input.credentialMode === 'ORGANIZATION_BYOK') {
      const warnings =
        input.importance === 'REQUIRED'
          ? [`${capabilityDisplayName(input.capability)} is not configured (required capability)`]
          : [];
      return buildResult(input, {
        state: 'NOT_CONFIGURED',
        providerId: null,
        modelOrServiceId: null,
        source: 'organization',
        credentialMode: 'ORGANIZATION_BYOK',
        credentialRef: null,
        warnings,
      });
    }
    return resolveLegacy(input);
  }
  if (!input.config.enabled) {
    return buildResult(input, {
      state: 'NOT_CONFIGURED',
      providerId: input.config.providerId,
      modelOrServiceId: input.config.modelOrServiceId,
      source: 'organization',
      credentialMode: input.credentialMode,
      credentialRef: null,
      warnings: [`${capabilityDisplayName(input.capability)} is disabled`],
    });
  }
  if (input.credentialMode === 'PLATFORM_MANAGED') {
    return resolvePlatform(input);
  }
  return resolveByok(input);
}

// ============================================================================
// Catalog lookup
// ============================================================================

export function getCapabilityImportance(capability: CapabilityId): CapabilityImportance {
  return (
    REGISTRY_CAPABILITIES.find((c) => c.id === capability)?.importance ?? 'OPTIONAL'
  );
}

// ============================================================================
// Feature flag
// ============================================================================

/** True when the organization-aware resolver is the runtime path (Phase D). */
export async function isOrgCredentialResolverEnabled(db: Kysely<DB>): Promise<boolean> {
  const flags = await readFeatureFlagCombinations(db);
  return flags.orgCredentialResolverEnabled;
}

// ============================================================================
// Legacy resolution (the OFF-flag path, and the fallback in dual-read)
// ============================================================================

function unavailableLegacy(): LegacyCandidate {
  return { providerId: null, modelOrServiceId: null, apiKey: null, apiBase: null, available: false };
}

/**
 * Resolve a capability the way the legacy code paths do today (plan §12.3).
 * This is the DEFAULT-org parity baseline and the fallback used when a new
 * config row is absent.
 */
export async function loadLegacyResolution(
  _db: Kysely<DB>,
  capability: CapabilityId,
  request: ResolveRequest = {}
): Promise<LegacyCandidate> {
  switch (capability) {
    case 'llm': {
      const settings = await getLlmSettings();
      const model = request.workspaceModel || settings.model;
      const provider = inferProviderFromModel(model);
      if (!provider) return unavailableLegacy();
      const apiKey = await getApiKey(provider);
      const apiBase = await getApiBase(provider);
      const available = provider === 'ollama' ? !!apiBase : !!apiKey;
      return { providerId: provider, modelOrServiceId: model, apiKey, apiBase, available };
    }

    case 'embeddings': {
      const settings = await getEmbeddingSettings();
      const model = settings.model;
      const provider = inferProviderFromModel(model) ?? 'openai';
      const apiKey = await getApiKey(provider);
      const apiBase = await getApiBase(provider);
      const available = provider === 'ollama' ? !!apiBase : !!apiKey;
      return { providerId: provider, modelOrServiceId: model, apiKey, apiBase, available };
    }

    case 'reranking': {
      const settings = await getRerankerSettings();
      const primary = settings.providers.find((p) => p.enabled);
      if (!primary) return unavailableLegacy();
      if (primary.provider === 'cohere') {
        const apiKey = settings.cohereApiKey || process.env.COHERE_API_KEY || null;
        return { providerId: 'cohere', modelOrServiceId: 'cohere', apiKey, apiBase: null, available: !!apiKey };
      }
      if (primary.provider === 'fireworks') {
        const apiKey = await getApiKey('fireworks');
        return { providerId: 'fireworks', modelOrServiceId: 'fireworks', apiKey, apiBase: null, available: !!apiKey };
      }
      // bge-large / bge-base / local → local cross-encoder, no key required.
      return { providerId: 'bge', modelOrServiceId: primary.provider, apiKey: null, apiBase: null, available: true };
    }

    case 'web-search': {
      const settings = await getTavilySettings();
      const apiKey = settings.apiKey || process.env.TAVILY_API_KEY || null;
      return { providerId: 'tavily', modelOrServiceId: null, apiKey, apiBase: null, available: settings.enabled && !!apiKey };
    }

    case 'document-intelligence': {
      const settings = await getOcrSettings();
      const primary = settings.providers.find((p) => p.enabled);
      if (!primary) return unavailableLegacy();
      if (primary.provider === 'mistral') {
        const apiKey = settings.mistralApiKey || (await getApiKey('mistral'));
        return { providerId: 'mistral', modelOrServiceId: 'mistral-ocr', apiKey, apiBase: null, available: !!apiKey };
      }
      if (primary.provider === 'azure-di') {
        const endpoint = settings.azureDiEndpoint || process.env.AZURE_DI_ENDPOINT || null;
        const key = settings.azureDiKey || process.env.AZURE_DI_KEY || null;
        return { providerId: 'azure-di', modelOrServiceId: 'prebuilt-read', apiKey: key, apiBase: endpoint, available: !!(endpoint && key) };
      }
      return unavailableLegacy();
    }

    case 'speech-to-text': {
      const settings = await getSpeechSettings();
      const provider = settings.stt.default;
      const apiKey = await getApiKey(provider);
      return { providerId: provider, modelOrServiceId: null, apiKey, apiBase: null, available: !!apiKey };
    }

    case 'text-to-speech': {
      const settings = await getSpeechSettings();
      const provider = settings.tts.primaryProvider;
      const apiKey = await getApiKey(provider);
      return { providerId: provider, modelOrServiceId: null, apiKey, apiBase: null, available: !!apiKey };
    }

    default:
      // OPTIONAL developer-tool capabilities have no legacy runtime path.
      return unavailableLegacy();
  }
}

/**
 * Legacy-only resolution — the runtime path while
 * `org-credential-resolver-enabled` is OFF (this phase). DEFAULT org parity is
 * trivially preserved because this is exactly the pre-redesign behavior.
 */
export async function resolveLegacyOnly(
  db: Kysely<DB>,
  capability: CapabilityId,
  request: ResolveRequest = {}
): Promise<ResolvedCapability> {
  const legacy = await loadLegacyResolution(db, capability, request);
  return resolveCapabilityCore({
    capability,
    importance: getCapabilityImportance(capability),
    orgType: 'DEFAULT',
    isDefaultOrg: true,
    credentialMode: 'PLATFORM_MANAGED',
    config: null,
    orgCredentials: [],
    platformCredentials: [],
    legacy,
  });
}

// ============================================================================
// Async DB resolution (dual-read)
// ============================================================================

async function loadOrganization(db: Kysely<DB>, orgId: number | null) {
  if (orgId != null) {
    const org = await db
      .selectFrom('organizations')
      .select(['id', 'type', 'is_default', 'credential_mode'])
      .where('id', '=', orgId)
      .executeTakeFirst();
    if (org) return org;
    // Fail closed: a requested org id that does not exist must NOT silently
    // fall back to the DEFAULT org (which would leak platform keys to a
    // mistargeted tenant request). This mirrors `provider-credential.ts`; only
    // an ABSENT org id uses the DEFAULT organization below.
    throw new Error(`capability-resolver: organization ${orgId} not found`);
  }
  // Fall back to the DEFAULT org only when no org id is provided (parity path).
  const def = await db
    .selectFrom('organizations')
    .select(['id', 'type', 'is_default', 'credential_mode'])
    .where('is_default', '=', true)
    .orderBy('id')
    .limit(1)
    .executeTakeFirst();
  if (!def) {
    throw new Error('capability-resolver: no DEFAULT organization found');
  }
  return def;
}

async function loadCapabilityConfig(
  db: Kysely<DB>,
  orgId: number,
  capability: CapabilityId
): Promise<CapabilityConfigCandidate | null> {
  const row = await db
    .selectFrom('organization_capability_config')
    .select(['provider_id', 'credential_id', 'model_or_service_id', 'enabled'])
    .where('organization_id', '=', orgId)
    .where('capability_id', '=', capability)
    .executeTakeFirst();
  if (!row) return null;
  return {
    providerId: row.provider_id,
    credentialId: row.credential_id,
    modelOrServiceId: row.model_or_service_id,
    enabled: row.enabled,
  };
}

async function loadPlatformCredentials(
  db: Kysely<DB>,
  providerId: string | null
): Promise<PlatformCredentialCandidate[]> {
  if (!providerId) return [];
  const rows = await db
    .selectFrom('platform_provider_credentials')
    .select(['provider_id', 'status'])
    .where('provider_id', '=', providerId)
    .execute();

  const result: PlatformCredentialCandidate[] = [];
  for (const row of rows) {
    // Platform credential secret material still resolves through the legacy
    // secure source (env or llm_providers) — the same source legacy uses.
    result.push({
      providerId: row.provider_id,
      status: row.status,
      apiKey: await getApiKey(row.provider_id),
      apiBase: await getApiBase(row.provider_id),
    });
  }
  return result;
}

async function loadOrgCredentials(
  db: Kysely<DB>,
  orgId: number,
  providerId: string | null
): Promise<OrgCredentialCandidate[]> {
  if (!providerId) return [];
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

  return rows.map((row) => {
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
      console.error('[capability-resolver] Failed to decrypt org credential:', error);
      apiKey = null;
    }
    return {
      providerId: row.provider_id,
      credentialId: row.credential_id,
      credentialVersion: row.credential_version,
      status: row.status,
      isDefault: row.is_default,
      apiKey,
      apiBase: null,
    };
  });
}

/**
 * The dual-read resolver (used by the runtime path once the flag is ON).
 * "New config present → use it; absent → legacy fallback."
 */
export async function resolveCapability(
  db: Kysely<DB>,
  orgId: number | null,
  capability: CapabilityId,
  request: ResolveRequest = {}
): Promise<ResolvedCapability> {
  const org = await loadOrganization(db, orgId);
  const config = await loadCapabilityConfig(db, org.id, capability);
  const [legacy, platformCredentials, orgCredentials] = await Promise.all([
    loadLegacyResolution(db, capability, request),
    loadPlatformCredentials(db, config?.providerId ?? null),
    loadOrgCredentials(db, org.id, config?.providerId ?? null),
  ]);

  return resolveCapabilityCore({
    capability,
    importance: getCapabilityImportance(capability),
    orgType: org.type,
    isDefaultOrg: org.is_default,
    credentialMode: org.credential_mode,
    config,
    orgCredentials,
    platformCredentials,
    legacy,
  });
}

/**
 * The runtime entrypoint. While `org-credential-resolver-enabled` is OFF the
 * legacy path is used; when ON the dual-read resolver takes over. Phase D flips
 * the flag ON; the provider-keyed runtime clients route through
 * `resolveProviderCredential()` (src/lib/provider-credential.ts) for
 * multi-provider modules, while this capability-first resolver remains the
 * health/configuration resolution path.
 */
export async function resolveCapabilityForRuntime(
  db: Kysely<DB>,
  orgId: number | null,
  capability: CapabilityId,
  request: ResolveRequest = {}
): Promise<ResolvedCapability> {
  if (!(await isOrgCredentialResolverEnabled(db))) {
    return resolveLegacyOnly(db, capability, request);
  }
  return resolveCapability(db, orgId, capability, request);
}

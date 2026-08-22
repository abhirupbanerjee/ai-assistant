/**
 * ProviderClientFactory — AI & API Setup Redesign, Phase C (plan §7, Decision 5).
 *
 * Constructs provider SDK clients from a resolved `credential_ref`
 * (provider_id, credential_id, apiKey, apiBase) and caches them in a bounded
 * LRU with TTL. The cache key is `credential_id + credential_version`, so a
 * `credential_version` bump (key replace/disable/rotation — see
 * src/lib/credential-vault.ts) invalidates the entry. The version is stored in
 * PostgreSQL and bumped by the trigger in src/lib/db/kysely.ts, which makes
 * invalidation correct across multiple Next.js worker processes (an in-process
 * LRU alone is not shared across workers).
 *
 * Design rules:
 *   - No mutable module-scope client variables. The LRU cache lives inside a
 *     factory instance; callers create or share instances explicitly.
 *   - Multiple active keys per (organization_id, provider_id) are supported via
 *     `selectCredentialForProvider()` — `credential_id` selects a specific key,
 *     else the `is_default` key, else the sole active key.
 *   - The factory only builds clients; the actual singleton modules
 *     (llm-client.ts, reranker.ts, stt.ts, llm-router.ts, openai.ts) are
 *     converted in Phase D, not here.
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { CohereClient } from 'cohere-ai';
import { GoogleGenAI } from '@google/genai';
import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer';
import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential } from '@azure/identity';

// ============================================================================
// Types
// ============================================================================

/** A resolved credential reference passed into the factory. */
export interface CredentialRef {
  providerId: string;
  /** Stable credential identifier (`platform`, an org `credential_id`, or `legacy`). */
  credentialId: string;
  /** Bumped on every key mutation; part of the cache key. */
  credentialVersion: number;
  apiKey: string | null;
  apiBase: string | null;
  /**
   * Optional request timeout (ms) passed through to the underlying SDK client.
   * Preserves the per-provider timeouts legacy call sites configured (e.g. 5
   * minutes for direct OpenAI/Anthropic/Fireworks clients).
   */
  timeoutMs?: number;
}

/**
 * Provider client union. Every entry carries a discriminant so callers can
 * narrow to the correct SDK type without `instanceof` guessing.
 */
export type ProviderClient =
  | { kind: 'openai'; client: OpenAI }
  | { kind: 'anthropic'; client: Anthropic }
  | { kind: 'cohere'; client: CohereClient }
  | { kind: 'google-genai'; client: GoogleGenAI }
  | { kind: 'azure-di'; client: DocumentAnalysisClient }
  | { kind: 'http'; providerId: string; apiKey: string | null; baseUrl: string | null };

/** Minimal credential row shape used by credential selection. */
export interface CredentialCandidate {
  credentialId?: string;
  status?: string;
  isDefault?: boolean;
}

// ============================================================================
// Credential selection (multiple active keys → is_default)
// ============================================================================

/**
 * Select which active credential to use for a provider.
 *
 *   1. `requestedCredentialId` (from `organization_capability_config`) when it
 *      matches an active credential.
 *   2. Otherwise the active `is_default` credential.
 *   3. Otherwise the sole active credential.
 *   4. Otherwise `null` (→ capability UNAVAILABLE; never silently fall back).
 */
export function selectCredentialForProvider<T extends CredentialCandidate>(
  credentials: T[],
  requestedCredentialId: string | null | undefined
): T | null {
  const active = credentials.filter((c) => (c.status ?? 'active') === 'active');

  if (requestedCredentialId) {
    const match = active.find((c) => c.credentialId === requestedCredentialId);
    if (match) return match;
  }

  const def = active.find((c) => c.isDefault === true);
  if (def) return def;

  if (active.length === 1) return active[0];

  return null;
}

// ============================================================================
// Client construction
// ============================================================================

/** Default base URLs for OpenAI-compatible providers. */
const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  ollama: 'http://localhost:11434/v1',
  'ollama-cloud': 'https://api.ollama.com/v1',
};

/** Providers that are OpenAI-API-compatible and constructed with the `openai` SDK. */
const OPENAI_COMPATIBLE_PROVIDERS = new Set([
  'openai',
  'fireworks',
  'deepseek',
  'mistral',
  'moonshot',
  'ollama',
  'ollama-cloud',
]);

function buildAzureFoundryClient(apiBase: string | null): OpenAI {
  if (!apiBase) {
    throw new Error('Azure AI Foundry not configured (AZURE_FOUNDRY_ENDPOINT required)');
  }
  const project = new AIProjectClient(apiBase.replace(/\/$/, ''), new DefaultAzureCredential());
  // Returns a standard openai SDK client routing through the project endpoint.
  return project.getOpenAIClient();
}

/**
 * Construct a provider client from a credential ref. No caching here — caching
 * is the `ProviderClientFactory`'s responsibility.
 */
export function buildProviderClient(ref: CredentialRef): ProviderClient {
  const { providerId, apiKey, apiBase } = ref;

  switch (providerId) {
    case 'anthropic':
      return {
        kind: 'anthropic',
        client: new Anthropic({
          ...(apiKey ? { apiKey } : {}),
          ...(apiBase ? { baseURL: apiBase } : {}),
          ...(ref.timeoutMs ? { timeout: ref.timeoutMs } : {}),
        }),
      };

    case 'cohere':
      return {
        kind: 'cohere',
        client: new CohereClient({ token: apiKey ?? '' }),
      };

    case 'gemini':
      return {
        kind: 'google-genai',
        client: new GoogleGenAI({ apiKey: apiKey ?? '' }),
      };

    case 'azure-di': {
      const endpoint = apiBase ?? '';
      if (!endpoint) {
        throw new Error('Azure Document Intelligence requires an endpoint (apiBase)');
      }
      return {
        kind: 'azure-di',
        client: new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey ?? '')),
      };
    }

    case 'azure-foundry':
      return { kind: 'openai', client: buildAzureFoundryClient(apiBase) };

    // Local key-less reranker: represented as an http client with no secret.
    case 'bge':
      return { kind: 'http', providerId: 'bge', apiKey: null, baseUrl: null };

    // Tool integrations without an official SDK (fetch-based in the repo).
    case 'tavily':
    case 'sonarcloud':
    case 'k6':
    case 'lighthouse':
      return { kind: 'http', providerId, apiKey, baseUrl: apiBase };

    default:
      if (!OPENAI_COMPATIBLE_PROVIDERS.has(providerId)) {
        throw new Error(`ProviderClientFactory: unsupported provider "${providerId}"`);
      }
      return {
        kind: 'openai',
        client: new OpenAI({
          ...(apiKey ? { apiKey } : {}),
          baseURL: apiBase ?? OPENAI_COMPATIBLE_BASE_URLS[providerId],
          ...(ref.timeoutMs ? { timeout: ref.timeoutMs } : {}),
        }),
      };
  }
}

// ============================================================================
// LRU cache keyed by credential_id + credential_version
// ============================================================================

export function buildCredentialCacheKey(ref: CredentialRef): string {
  // `timeoutMs` is part of the key so distinct call sites can share the same
  // credential while keeping their own client construction (e.g. 5-minute
  // direct-route clients vs 2-minute TTS clients vs no-timeout router clients).
  return `${ref.providerId}:${ref.credentialId}:${ref.credentialVersion}:${ref.timeoutMs ?? 0}`;
}

interface CacheEntry {
  key: string;
  credentialId: string;
  client: ProviderClient;
  expiresAt: number;
}

export interface ProviderClientFactoryOptions {
  /** Maximum number of cached clients (LRU bound). Default 100. */
  maxEntries?: number;
  /** Cache entry time-to-live in milliseconds. Default 5 minutes. */
  ttlMs?: number;
  /** Injectable clock for deterministic TTL tests. Defaults to `Date.now`. */
  now?: () => number;
}

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Bounded LRU cache of provider clients with TTL. No module-scope client state:
 * each instance owns its own `Map`.
 */
export class ProviderClientFactory {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: ProviderClientFactoryOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Number of entries currently cached. */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Return a (possibly cached) client for a credential ref. On a cache miss the
   * client is built and inserted; on a hit the entry is refreshed to the most
   * recently used position. Expired entries are evicted lazily.
   */
  getClient(ref: CredentialRef): ProviderClient {
    const key = buildCredentialCacheKey(ref);
    const now = this.now();

    const hit = this.cache.get(key);
    if (hit) {
      if (hit.expiresAt <= now) {
        this.cache.delete(key);
      } else {
        // Refresh LRU ordering.
        this.cache.delete(key);
        this.cache.set(key, hit);
        return hit.client;
      }
    }

    const client = buildProviderClient(ref);
    this.cache.set(key, {
      key,
      credentialId: ref.credentialId,
      client,
      expiresAt: now + this.ttlMs,
    });
    this.evictIfNeeded();
    return client;
  }

  /** Invalidate every entry for a credential id (across all versions). */
  invalidateCredential(credentialId: string): void {
    for (const [key, entry] of this.cache) {
      if (entry.credentialId === credentialId) this.cache.delete(key);
    }
  }

  /** Clear the entire cache. */
  clear(): void {
    this.cache.clear();
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }
}

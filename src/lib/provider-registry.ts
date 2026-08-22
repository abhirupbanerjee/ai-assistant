/**
 * Server-side provider/capability registry — AI & API Setup Redesign, Phase C
 * (plan §5 "Capability-First Model", Decision 4).
 *
 * This module is the single source of truth for the provider → capability
 * mapping. It replaces the retired frontend map
 * `PROVIDER_CAPABILITIES` (src/components/admin/settings/ApiKeysSettings.tsx)
 * and is maintained server-side: adding a future provider or tool means adding
 * registry rows here — zero frontend component changes.
 *
 * The data model is intentionally pure and database-free so the registry is
 * unit-testable without a live PostgreSQL. `seedProviderRegistry()` applies the
 * rows to the Kysely `providers` / `capabilities` / `provider_capabilities`
 * tables idempotently (INSERT … ON CONFLICT DO NOTHING).
 *
 * OPTIONAL developer-tool rows (image generation, podcast/audio, code analysis,
 * load testing, website analysis) are only included when the corresponding
 * integration actually exists in the repository — see
 * `detectDeveloperToolIntegrations()`. Registry rows, never hardcoded UI.
 */

import type { Kysely } from 'kysely';
import type { DB } from './db/db-types';
import { existsSync } from 'fs';
import { resolve } from 'path';

// ============================================================================
// Types
// ============================================================================

export type CapabilityImportance = 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';

/** Canonical capability identifiers (plan §5 catalog). */
export type CapabilityId =
  | 'llm'
  | 'embeddings'
  | 'reranking'
  | 'web-search'
  | 'document-intelligence'
  | 'speech-to-text'
  | 'text-to-speech'
  | 'image-generation'
  | 'podcast-audio'
  | 'code-analysis'
  | 'load-testing'
  | 'website-analysis';

export interface RegistryProvider {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
}

export interface RegistryCapability {
  id: CapabilityId;
  name: string;
  description: string | null;
  importance: CapabilityImportance;
  sortOrder: number;
}

export interface RegistryProviderCapability {
  providerId: string;
  capabilityId: CapabilityId;
  isSupported: boolean;
  /** Optional list of known model/service ids for this provider capability. */
  modelOrServiceIds: string[] | null;
}

// ============================================================================
// Provider registry
// ============================================================================

/**
 * All providers. The first ten mirror the legacy `DEFAULT_PROVIDERS` seed; the
 * next four are capability-only providers (web search, reranking, OCR); the
 * final three are developer-tool integrations. `bge` is the local (key-less)
 * reranker.
 */
export const REGISTRY_PROVIDERS: RegistryProvider[] = [
  { id: 'openai', name: 'OpenAI', description: 'GPT, Whisper, TTS, embeddings', sortOrder: 10 },
  { id: 'gemini', name: 'Google Gemini', description: 'Gemini LLM, embeddings, image generation, TTS', sortOrder: 20 },
  { id: 'mistral', name: 'Mistral AI', description: 'Mistral LLM, embeddings, OCR', sortOrder: 30 },
  { id: 'ollama', name: 'Ollama (Local)', description: 'Local LLM, embeddings, reranker', sortOrder: 40 },
  { id: 'anthropic', name: 'Anthropic (Claude)', description: 'Claude LLM (no embeddings)', sortOrder: 50 },
  { id: 'deepseek', name: 'DeepSeek', description: 'DeepSeek LLM', sortOrder: 60 },
  { id: 'fireworks', name: 'Fireworks AI', description: 'LLM, embeddings, reranker', sortOrder: 70 },
  { id: 'ollama-cloud', name: 'Ollama Cloud', description: 'Hosted Ollama LLM', sortOrder: 80 },
  { id: 'moonshot', name: 'Moonshot AI', description: 'Kimi LLM', sortOrder: 90 },
  { id: 'azure-foundry', name: 'Azure AI Foundry', description: 'Aggregator gateway (Entra ID auth)', sortOrder: 100 },
  { id: 'tavily', name: 'Tavily (Web Search)', description: 'Web search service', sortOrder: 110 },
  { id: 'cohere', name: 'Cohere (Reranking)', description: 'Cohere rerank API', sortOrder: 120 },
  { id: 'bge', name: 'BGE (Local Reranking)', description: 'Local cross-encoder, no key required', sortOrder: 130 },
  { id: 'azure-di', name: 'Azure Document Intelligence', description: 'OCR / document analysis', sortOrder: 140 },
  { id: 'sonarcloud', name: 'SonarCloud', description: 'Static code quality analysis', sortOrder: 210 },
  { id: 'k6', name: 'Grafana k6', description: 'Cloud load testing', sortOrder: 220 },
  { id: 'lighthouse', name: 'Google Lighthouse / PageSpeed', description: 'Website performance analysis', sortOrder: 230 },
];

// ============================================================================
// Capability catalog (plan §5) with importance axis
// ============================================================================

export const REGISTRY_CAPABILITIES: RegistryCapability[] = [
  { id: 'llm', name: 'LLM', description: 'Chat and reasoning model', importance: 'REQUIRED', sortOrder: 10 },
  { id: 'embeddings', name: 'Embeddings', description: 'Vector embeddings for RAG ingestion', importance: 'REQUIRED', sortOrder: 20 },
  { id: 'reranking', name: 'Reranking', description: 'Cross-encoder reranking of retrieved chunks', importance: 'RECOMMENDED', sortOrder: 30 },
  { id: 'web-search', name: 'Web Search', description: 'Tavily web search', importance: 'RECOMMENDED', sortOrder: 40 },
  { id: 'document-intelligence', name: 'Document Intelligence / OCR', description: 'OCR and document parsing', importance: 'RECOMMENDED', sortOrder: 50 },
  { id: 'speech-to-text', name: 'Speech-to-Text', description: 'Audio transcription', importance: 'RECOMMENDED', sortOrder: 60 },
  { id: 'text-to-speech', name: 'Text-to-Speech', description: 'Voice synthesis', importance: 'RECOMMENDED', sortOrder: 70 },
  { id: 'image-generation', name: 'Image Generation', description: 'Gemini image generation', importance: 'OPTIONAL', sortOrder: 80 },
  { id: 'podcast-audio', name: 'Podcast / Audio Generation', description: 'Podcast audio generation', importance: 'OPTIONAL', sortOrder: 90 },
  { id: 'code-analysis', name: 'Code Analysis / SonarCloud', description: 'Static code quality analysis', importance: 'OPTIONAL', sortOrder: 100 },
  { id: 'load-testing', name: 'Load Testing / Grafana k6', description: 'Cloud load testing', importance: 'OPTIONAL', sortOrder: 110 },
  { id: 'website-analysis', name: 'Website Analysis / Lighthouse', description: 'PageSpeed / Lighthouse analysis', importance: 'OPTIONAL', sortOrder: 120 },
];

// ============================================================================
// Provider → capability mapping
// ============================================================================

/**
 * Derived from the retired frontend `PROVIDER_CAPABILITIES` map and the
 * capability-only providers referenced by existing settings. The frontend map
 * used display strings ('LLM', 'Embeddings', 'Images', 'TTS', 'Reranker'); they
 * are translated to canonical capability ids here.
 *
 * Note: image generation now routes exclusively through Gemini in this
 * repository (see src/lib/image-gen/providers/gemini-imagen.ts), so
 * `image-generation` is mapped to `gemini` only even though the retired map
 * listed 'Images' for OpenAI too.
 */
export const REGISTRY_PROVIDER_CAPABILITIES: RegistryProviderCapability[] = [
  { providerId: 'openai', capabilityId: 'llm', isSupported: true, modelOrServiceIds: null },
  { providerId: 'openai', capabilityId: 'embeddings', isSupported: true, modelOrServiceIds: ['text-embedding-3-small', 'text-embedding-3-large'] },
  { providerId: 'openai', capabilityId: 'speech-to-text', isSupported: true, modelOrServiceIds: ['whisper-1'] },
  { providerId: 'openai', capabilityId: 'text-to-speech', isSupported: true, modelOrServiceIds: ['tts-1', 'tts-1-hd'] },
  { providerId: 'openai', capabilityId: 'podcast-audio', isSupported: true, modelOrServiceIds: null },
  { providerId: 'gemini', capabilityId: 'llm', isSupported: true, modelOrServiceIds: null },
  { providerId: 'gemini', capabilityId: 'embeddings', isSupported: true, modelOrServiceIds: null },
  { providerId: 'gemini', capabilityId: 'speech-to-text', isSupported: true, modelOrServiceIds: null },
  { providerId: 'gemini', capabilityId: 'text-to-speech', isSupported: true, modelOrServiceIds: null },
  { providerId: 'gemini', capabilityId: 'image-generation', isSupported: true, modelOrServiceIds: ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'] },
  { providerId: 'gemini', capabilityId: 'podcast-audio', isSupported: true, modelOrServiceIds: null },
  { providerId: 'mistral', capabilityId: 'llm', isSupported: true, modelOrServiceIds: null },
  { providerId: 'mistral', capabilityId: 'embeddings', isSupported: true, modelOrServiceIds: null },
  { providerId: 'mistral', capabilityId: 'document-intelligence', isSupported: true, modelOrServiceIds: ['mistral-ocr'] },
  { providerId: 'ollama', capabilityId: 'llm', isSupported: true, modelOrServiceIds: null },
  { providerId: 'ollama', capabilityId: 'embeddings', isSupported: true, modelOrServiceIds: null },
  { providerId: 'ollama', capabilityId: 'reranking', isSupported: true, modelOrServiceIds: null },
  { providerId: 'anthropic', capabilityId: 'llm', isSupported: true, modelOrServiceIds: null },
  { providerId: 'deepseek', capabilityId: 'llm', isSupported: true, modelOrServiceIds: null },
  { providerId: 'fireworks', capabilityId: 'llm', isSupported: true, modelOrServiceIds: null },
  { providerId: 'fireworks', capabilityId: 'embeddings', isSupported: true, modelOrServiceIds: null },
  { providerId: 'fireworks', capabilityId: 'reranking', isSupported: true, modelOrServiceIds: null },
  { providerId: 'ollama-cloud', capabilityId: 'llm', isSupported: true, modelOrServiceIds: null },
  { providerId: 'moonshot', capabilityId: 'llm', isSupported: true, modelOrServiceIds: null },
  { providerId: 'azure-foundry', capabilityId: 'llm', isSupported: true, modelOrServiceIds: null },
  { providerId: 'azure-foundry', capabilityId: 'embeddings', isSupported: true, modelOrServiceIds: null },
  { providerId: 'tavily', capabilityId: 'web-search', isSupported: true, modelOrServiceIds: null },
  { providerId: 'cohere', capabilityId: 'reranking', isSupported: true, modelOrServiceIds: ['rerank-english-v3.0', 'rerank-multilingual-v3.0'] },
  { providerId: 'bge', capabilityId: 'reranking', isSupported: true, modelOrServiceIds: ['bge-reranker-large', 'bge-reranker-base'] },
  { providerId: 'azure-di', capabilityId: 'document-intelligence', isSupported: true, modelOrServiceIds: ['prebuilt-read'] },
  { providerId: 'sonarcloud', capabilityId: 'code-analysis', isSupported: true, modelOrServiceIds: null },
  { providerId: 'k6', capabilityId: 'load-testing', isSupported: true, modelOrServiceIds: null },
  { providerId: 'lighthouse', capabilityId: 'website-analysis', isSupported: true, modelOrServiceIds: null },
];

// ============================================================================
// Developer-tool (OPTIONAL) integration detection
// ============================================================================

/** Capability ids whose registry rows only exist when the integration is present. */
export const DEVELOPER_TOOL_CAPABILITIES = [
  'image-generation',
  'podcast-audio',
  'code-analysis',
  'load-testing',
  'website-analysis',
] as const;

/** The subset of `CapabilityId` that is gated on repository integration presence. */
export type DeveloperToolCapability = (typeof DEVELOPER_TOOL_CAPABILITIES)[number];

/** Repository-relative paths proving each optional integration exists. */
const INTEGRATION_PATHS: Record<DeveloperToolCapability, string> = {
  'image-generation': 'src/lib/image-gen/providers/gemini-imagen.ts',
  'podcast-audio': 'src/lib/audio/pcm-to-wav.ts',
  'code-analysis': 'src/lib/tools/sonarcloud.ts',
  'load-testing': 'src/lib/tools/loadtest.ts',
  'website-analysis': 'src/lib/tools/pagespeed.ts',
};

export type IntegrationPresence = Record<DeveloperToolCapability, boolean>;

/**
 * Detect which optional developer-tool integrations exist in this repository.
 *
 * Pure filesystem check (server-side module). Each capability is present when
 * its implementation file exists relative to `process.cwd()`. Tests should use
 * `filterRegistryByIntegrations()` with an explicit presence map instead of
 * touching the filesystem.
 */
export function detectDeveloperToolIntegrations(cwd: string = process.cwd()): IntegrationPresence {
  const presence = {} as IntegrationPresence;
  for (const capabilityId of DEVELOPER_TOOL_CAPABILITIES) {
    try {
      presence[capabilityId] = existsSync(resolve(cwd, INTEGRATION_PATHS[capabilityId]));
    } catch {
      presence[capabilityId] = false;
    }
  }
  return presence;
}

// ============================================================================
// Registry filtering
// ============================================================================

export interface FilteredRegistry {
  providers: RegistryProvider[];
  capabilities: RegistryCapability[];
  providerCapabilities: RegistryProviderCapability[];
}

/**
 * Filter the full registry down to the rows whose integrations actually exist.
 *
 * A developer-tool provider is dropped when none of its capability mappings
 * survive filtering. The ten LLM providers and the four capability-only
 * providers are always kept (they are not gated by integration presence).
 */
export function filterRegistryByIntegrations(
  presence: IntegrationPresence
): FilteredRegistry {
  const developerTools = new Set<string>(DEVELOPER_TOOL_CAPABILITIES);
  const included = new Set(
    DEVELOPER_TOOL_CAPABILITIES.filter((capabilityId) => presence[capabilityId] === true)
  );

  const capabilities = REGISTRY_CAPABILITIES.filter(
    (c) => !developerTools.has(c.id) || included.has(c.id as DeveloperToolCapability)
  );

  const providerCapabilities = REGISTRY_PROVIDER_CAPABILITIES.filter(
    (pc) => !developerTools.has(pc.capabilityId) || included.has(pc.capabilityId as DeveloperToolCapability)
  );

  const providersWithMappings = new Set(providerCapabilities.map((pc) => pc.providerId));
  const providers = REGISTRY_PROVIDERS.filter(
    (p) =>
      !['sonarcloud', 'k6', 'lighthouse'].includes(p.id) ||
      providersWithMappings.has(p.id)
  );

  return { providers, capabilities, providerCapabilities };
}

/** Full registry with every integration enabled (used by tests). */
export function buildFullRegistry(): FilteredRegistry {
  const presence = {} as IntegrationPresence;
  for (const capabilityId of DEVELOPER_TOOL_CAPABILITIES) presence[capabilityId] = true;
  return filterRegistryByIntegrations(presence);
}

// ============================================================================
// DB row builders + seeding
// ============================================================================

/** Build `providers` insertable rows for a filtered registry. */
export function buildProviderRows(registry: FilteredRegistry) {
  return registry.providers.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    enabled: true,
    sort_order: p.sortOrder,
  }));
}

/** Build `capabilities` insertable rows for a filtered registry. */
export function buildCapabilityRows(registry: FilteredRegistry) {
  return registry.capabilities.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    importance: c.importance,
    sort_order: c.sortOrder,
  }));
}

/** Build `provider_capabilities` insertable rows for a filtered registry. */
export function buildProviderCapabilityRows(registry: FilteredRegistry) {
  return registry.providerCapabilities.map((pc) => ({
    provider_id: pc.providerId,
    capability_id: pc.capabilityId,
    is_supported: pc.isSupported,
    model_or_service_ids: pc.modelOrServiceIds,
  }));
}

/**
 * Seed the server-side registry into PostgreSQL. Idempotent: every insert is
 * ON CONFLICT DO NOTHING, so repeated calls (startup + backfill script) never
 * duplicate rows. OPTIONAL developer-tool rows are included only when the
 * corresponding integration exists in the repository.
 */
export async function seedProviderRegistry(
  db: Kysely<DB>,
  options: { presence?: IntegrationPresence; cwd?: string } = {}
): Promise<FilteredRegistry> {
  const presence = options.presence ?? detectDeveloperToolIntegrations(options.cwd);
  const registry = filterRegistryByIntegrations(presence);

  if (registry.providers.length > 0) {
    await db
      .insertInto('providers')
      .values(buildProviderRows(registry))
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }
  if (registry.capabilities.length > 0) {
    await db
      .insertInto('capabilities')
      .values(buildCapabilityRows(registry))
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }
  if (registry.providerCapabilities.length > 0) {
    await db
      .insertInto('provider_capabilities')
      .values(buildProviderCapabilityRows(registry))
      .onConflict((oc) => oc.columns(['provider_id', 'capability_id']).doNothing())
      .execute();
  }

  return registry;
}

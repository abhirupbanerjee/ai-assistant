/**
 * LLM Provider Database Operations - Async Compatibility Layer
 *
 * Provides async wrappers that work with both SQLite and PostgreSQL.
 * - SQLite: Delegates to existing sync functions
 * - PostgreSQL: Uses Kysely query builder
 */

import { getDb } from '../kysely';

// Re-export types and constants from sync module
export type { LLMProvider, CreateProviderInput, UpdateProviderInput } from '../llm-providers';
export { DEFAULT_PROVIDERS, maskApiKey } from '../utils';

import type { LLMProvider, CreateProviderInput, UpdateProviderInput } from '../llm-providers';

// ============ Row Mapper ============

interface LLMProviderRow {
  id: string;
  name: string;
  api_key: string | null;
  api_base: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function mapRowToProvider(row: LLMProviderRow): LLMProvider {
  return {
    id: row.id,
    name: row.name,
    apiKey: row.api_key,
    apiBase: row.api_base,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Environment variable mapping for auto-seeding
export const PROVIDER_ENV_KEYS: Record<string, { apiKey?: string; apiBase?: string }> = {
  openai: { apiKey: 'OPENAI_API_KEY' },
  gemini: { apiKey: 'GEMINI_API_KEY' },
  mistral: { apiKey: 'MISTRAL_API_KEY' },
  ollama: { apiBase: 'OLLAMA_API_BASE' },
  anthropic: { apiKey: 'ANTHROPIC_API_KEY' },
  deepseek: { apiKey: 'DEEPSEEK_API_KEY' },
  fireworks: { apiKey: 'FIREWORKS_AI_API_KEY' },
};

// ============ CRUD Operations ============

/**
 * Get all LLM providers
 */
export async function getAllProviders(): Promise<LLMProvider[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('llm_providers')
    .selectAll()
    .orderBy('name')
    .execute();

  return rows.map((row) => mapRowToProvider(row as unknown as LLMProviderRow));
}

/**
 * Get enabled providers only
 */
export async function getEnabledProviders(): Promise<LLMProvider[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('llm_providers')
    .selectAll()
    .where('enabled', '=', 1)
    .orderBy('name')
    .execute();

  return rows.map((row) => mapRowToProvider(row as unknown as LLMProviderRow));
}

/**
 * Get a single provider by ID
 */
export async function getProvider(id: string): Promise<LLMProvider | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('llm_providers')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? mapRowToProvider(row as unknown as LLMProviderRow) : null;
}

/**
 * Create a new provider
 */
export async function createProvider(input: CreateProviderInput): Promise<LLMProvider> {
  const db = await getDb();
  await db
    .insertInto('llm_providers')
    .values({
      id: input.id,
      name: input.name,
      api_key: input.apiKey || null,
      api_base: input.apiBase || null,
      enabled: input.enabled !== false ? 1 : 0,
    })
    .execute();

  return (await getProvider(input.id))!;
}

/**
 * Update an existing provider
 */
export async function updateProvider(id: string, input: UpdateProviderInput): Promise<LLMProvider | null> {
  const existing = await getProvider(id);
  if (!existing) return null;

  const updateObj: Record<string, unknown> = {};

  if (input.name !== undefined) {
    updateObj.name = input.name;
  }
  if (input.apiKey !== undefined) {
    updateObj.api_key = input.apiKey || null;
  }
  if (input.apiBase !== undefined) {
    updateObj.api_base = input.apiBase || null;
  }
  if (input.enabled !== undefined) {
    updateObj.enabled = input.enabled ? 1 : 0;
  }

  if (Object.keys(updateObj).length === 0) return existing;

  const db = await getDb();
  await db
    .updateTable('llm_providers')
    .set(updateObj)
    .where('id', '=', id)
    .execute();

  return getProvider(id);
}

/**
 * Delete a provider and its associated models
 * Note: CASCADE will delete enabled_models referencing this provider
 */
export async function deleteProvider(id: string): Promise<boolean> {
  const existing = await getProvider(id);
  if (!existing) return false;

  const db = await getDb();
  await db
    .deleteFrom('llm_providers')
    .where('id', '=', id)
    .execute();

  return true;
}

/**
 * Upsert a provider (insert or update)
 */
export async function upsertProvider(input: CreateProviderInput): Promise<LLMProvider> {
  const existing = await getProvider(input.id);

  if (existing) {
    return (await updateProvider(input.id, {
      name: input.name,
      apiKey: input.apiKey,
      apiBase: input.apiBase,
      enabled: input.enabled,
    }))!;
  }

  return createProvider(input);
}

/**
 * Check if a provider has a valid API key configured
 */
export async function isProviderConfigured(id: string): Promise<boolean> {
  const provider = await getProvider(id);
  if (!provider) return false;

  // Ollama uses apiBase, others use apiKey
  if (id === 'ollama') {
    return !!provider.apiBase;
  }
  return !!provider.apiKey;
}

/**
 * Get API key for a provider
 * Returns stored key or falls back to environment variable
 */
export async function getProviderApiKey(id: string): Promise<string | null> {
  const provider = await getProvider(id);
  if (provider?.apiKey) return provider.apiKey;

  // Fall back to environment variable
  const envConfig = PROVIDER_ENV_KEYS[id];
  if (envConfig?.apiKey) {
    return process.env[envConfig.apiKey] || null;
  }
  return null;
}

/**
 * Get API base URL for a provider
 * Returns stored URL or falls back to environment variable
 */
export async function getProviderApiBase(id: string): Promise<string | null> {
  const provider = await getProvider(id);
  if (provider?.apiBase) return provider.apiBase;

  // Fall back to environment variable
  const envConfig = PROVIDER_ENV_KEYS[id];
  if (envConfig?.apiBase) {
    return process.env[envConfig.apiBase] || null;
  }
  return null;
}

// ============ Seeding ============

/**
 * Seed default providers if the table is empty
 * Also adds any missing providers to existing databases
 * Auto-populates API keys from environment variables
 */
export async function seedDefaultProviders(): Promise<void> {
  const { DEFAULT_PROVIDERS } = await import('../utils');
  const existing = await getAllProviders();
  const existingIds = new Set(existing.map((p) => p.id));

  // Find providers that need to be added
  const missingProviders = DEFAULT_PROVIDERS.filter((p) => !existingIds.has(p.id));

  if (missingProviders.length === 0) {
    return; // All providers already exist
  }

  console.log(`[LLM Providers] Adding ${missingProviders.length} missing providers... (PostgreSQL)`);

  for (const provider of missingProviders) {
    const envConfig = PROVIDER_ENV_KEYS[provider.id];
    let apiKey: string | undefined;
    let apiBase: string | undefined;

    // Check environment variables
    if (envConfig?.apiKey) {
      apiKey = process.env[envConfig.apiKey] || undefined;
    }
    if (envConfig?.apiBase) {
      apiBase = process.env[envConfig.apiBase] || undefined;
    }

    await createProvider({
      id: provider.id,
      name: provider.name,
      apiKey,
      apiBase,
      enabled: provider.enabled,
    });

    console.log(`[LLM Providers] Added provider: ${provider.name}`);
  }
}

/**
 * LLM Provider Database Operations
 *
 * CRUD operations for managing LLM provider configurations (API keys, endpoints)
 */

import { execute, queryOne, queryAll } from './index';

// ============ Types ============

export interface LLMProvider {
  id: string;           // 'openai', 'gemini', 'mistral', 'ollama'
  name: string;         // Display name: 'OpenAI', 'Google Gemini', etc.
  apiKey: string | null;      // Encrypted API key (null for ollama)
  apiBase: string | null;     // Custom endpoint (for ollama or Azure)
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LLMProviderRow {
  id: string;
  name: string;
  api_key: string | null;
  api_base: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface CreateProviderInput {
  id: string;
  name: string;
  apiKey?: string;
  apiBase?: string;
  enabled?: boolean;
}

export interface UpdateProviderInput {
  name?: string;
  apiKey?: string;
  apiBase?: string;
  enabled?: boolean;
}

// ============ Default Providers ============

export const DEFAULT_PROVIDERS: Omit<LLMProvider, 'createdAt' | 'updatedAt'>[] = [
  { id: 'openai', name: 'OpenAI', apiKey: null, apiBase: null, enabled: true },
  { id: 'gemini', name: 'Google Gemini', apiKey: null, apiBase: null, enabled: true },
  { id: 'mistral', name: 'Mistral AI', apiKey: null, apiBase: null, enabled: true },
  { id: 'ollama', name: 'Ollama (Local)', apiKey: null, apiBase: null, enabled: true },
  { id: 'anthropic', name: 'Anthropic (Claude)', apiKey: null, apiBase: null, enabled: true },
  { id: 'deepseek', name: 'DeepSeek', apiKey: null, apiBase: null, enabled: true },
  { id: 'fireworks', name: 'Fireworks AI', apiKey: null, apiBase: null, enabled: true },
];

// Environment variable mapping for auto-seeding
const PROVIDER_ENV_KEYS: Record<string, { apiKey?: string; apiBase?: string }> = {
  openai: { apiKey: 'OPENAI_API_KEY' },
  gemini: { apiKey: 'GEMINI_API_KEY' },
  mistral: { apiKey: 'MISTRAL_API_KEY' },
  ollama: { apiBase: 'OLLAMA_API_BASE' },
  anthropic: { apiKey: 'ANTHROPIC_API_KEY' },
  deepseek: { apiKey: 'DEEPSEEK_API_KEY' },
  fireworks: { apiKey: 'FIREWORKS_AI_API_KEY' },
};

// ============ Row Mapper ============

function mapRowToProvider(row: LLMProviderRow): LLMProvider {
  return {
    id: row.id,
    name: row.name,
    apiKey: row.api_key,
    apiBase: row.api_base,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============ CRUD Operations ============

/**
 * Get all LLM providers
 */
export function getAllProviders(): LLMProvider[] {
  const rows = queryAll<LLMProviderRow>(`
    SELECT id, name, api_key, api_base, enabled, created_at, updated_at
    FROM llm_providers
    ORDER BY name
  `);
  return rows.map(mapRowToProvider);
}

/**
 * Get enabled providers only
 */
export function getEnabledProviders(): LLMProvider[] {
  const rows = queryAll<LLMProviderRow>(`
    SELECT id, name, api_key, api_base, enabled, created_at, updated_at
    FROM llm_providers
    WHERE enabled = 1
    ORDER BY name
  `);
  return rows.map(mapRowToProvider);
}

/**
 * Get a single provider by ID
 */
export function getProvider(id: string): LLMProvider | null {
  const row = queryOne<LLMProviderRow>(`
    SELECT id, name, api_key, api_base, enabled, created_at, updated_at
    FROM llm_providers
    WHERE id = ?
  `, [id]);
  return row ? mapRowToProvider(row) : null;
}

/**
 * Create a new provider
 */
export function createProvider(input: CreateProviderInput): LLMProvider {
  execute(`
    INSERT INTO llm_providers (id, name, api_key, api_base, enabled)
    VALUES (?, ?, ?, ?, ?)
  `, [
    input.id,
    input.name,
    input.apiKey || null,
    input.apiBase || null,
    input.enabled !== false ? 1 : 0,
  ]);

  return getProvider(input.id)!;
}

/**
 * Update an existing provider
 */
export function updateProvider(id: string, input: UpdateProviderInput): LLMProvider | null {
  const existing = getProvider(id);
  if (!existing) return null;

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    params.push(input.name);
  }
  if (input.apiKey !== undefined) {
    updates.push('api_key = ?');
    params.push(input.apiKey || null);
  }
  if (input.apiBase !== undefined) {
    updates.push('api_base = ?');
    params.push(input.apiBase || null);
  }
  if (input.enabled !== undefined) {
    updates.push('enabled = ?');
    params.push(input.enabled ? 1 : 0);
  }

  if (updates.length === 0) return existing;

  params.push(id);
  execute(`
    UPDATE llm_providers
    SET ${updates.join(', ')}
    WHERE id = ?
  `, params);

  return getProvider(id);
}

/**
 * Delete a provider and its associated models
 * Note: CASCADE will delete enabled_models referencing this provider
 */
export function deleteProvider(id: string): boolean {
  const existing = getProvider(id);
  if (!existing) return false;

  execute('DELETE FROM llm_providers WHERE id = ?', [id]);
  return true;
}

/**
 * Upsert a provider (insert or update)
 */
export function upsertProvider(input: CreateProviderInput): LLMProvider {
  const existing = getProvider(input.id);

  if (existing) {
    return updateProvider(input.id, {
      name: input.name,
      apiKey: input.apiKey,
      apiBase: input.apiBase,
      enabled: input.enabled,
    })!;
  }

  return createProvider(input);
}

/**
 * Check if a provider has a valid API key configured
 */
export function isProviderConfigured(id: string): boolean {
  const provider = getProvider(id);
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
export function getProviderApiKey(id: string): string | null {
  const provider = getProvider(id);
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
export function getProviderApiBase(id: string): string | null {
  const provider = getProvider(id);
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
export function seedDefaultProviders(): void {
  const existing = getAllProviders();
  const existingIds = new Set(existing.map(p => p.id));

  // Find providers that need to be added
  const missingProviders = DEFAULT_PROVIDERS.filter(p => !existingIds.has(p.id));

  if (missingProviders.length === 0) {
    return; // All providers already exist
  }

  console.log(`[LLM Providers] Adding ${missingProviders.length} missing providers...`);

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

    createProvider({
      id: provider.id,
      name: provider.name,
      apiKey,
      apiBase,
      enabled: provider.enabled,
    });

    console.log(`[LLM Providers] Added provider: ${provider.name}`);
  }
}

/**
 * Mask API key for display (shows last 4 characters)
 */
export function maskApiKey(apiKey: string | null): string {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return '••••••••';
  return '••••••••' + apiKey.slice(-4);
}

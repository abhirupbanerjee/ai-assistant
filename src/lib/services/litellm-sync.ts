/**
 * LiteLLM Model Sync Service
 *
 * Automatically registers enabled models with LiteLLM proxy via its /model/new API.
 * Called on:
 *   1. App startup (after DB migrations) — re-registers all active models
 *   2. Model enable via admin UI — registers newly added models
 *
 * This eliminates the need to manually edit litellm_config.yaml when new models
 * are added through the admin interface.
 */

import { getActiveModels } from '../db/compat/enabled-models';
import { getApiKey } from '../provider-helpers';
import { clearLiteLLMCache } from '../litellm-validator';

// Provider ID → LiteLLM model prefix and API key env var
const PROVIDER_MAP: Record<string, { prefix: string; envKey: string }> = {
  openai:    { prefix: 'openai/',    envKey: 'OPENAI_API_KEY' },
  anthropic: { prefix: 'anthropic/', envKey: 'ANTHROPIC_API_KEY' },
  gemini:    { prefix: 'gemini/',    envKey: 'GEMINI_API_KEY' },
  mistral:   { prefix: 'mistral/',   envKey: 'MISTRAL_API_KEY' },
  deepseek:  { prefix: 'deepseek/',  envKey: 'DEEPSEEK_API_KEY' },
  ollama:    { prefix: 'ollama/',    envKey: '' }, // Uses api_base instead
};

/**
 * Get the LiteLLM proxy root URL (without /v1 suffix)
 * Returns null if LiteLLM is not configured
 */
function getLiteLLMProxyUrl(): string | null {
  // Prefer LITELLM_ADMIN_URL for direct management API access (bypasses reverse proxy)
  if (process.env.LITELLM_ADMIN_URL) {
    return process.env.LITELLM_ADMIN_URL.replace(/\/$/, '');
  }

  const baseUrl = process.env.OPENAI_BASE_URL;
  if (!baseUrl) return null;

  // Strip /v1 suffix to get the proxy root
  return baseUrl.replace(/\/v1\/?$/, '');
}

/**
 * Fetch all existing model entries from LiteLLM, keyed by model_name.
 * Returns a map of model_name → array of internal LiteLLM model IDs (UUIDs).
 */
async function fetchExistingModelIds(
  proxyUrl: string,
  masterKey: string,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  try {
    const res = await fetch(`${proxyUrl}/model/info`, {
      headers: { 'Authorization': `Bearer ${masterKey}` },
    });
    if (!res.ok) return map;

    const info = await res.json();
    for (const m of info?.data ?? []) {
      const name = m.model_name;
      const id = m.model_info?.id;
      if (name && id) {
        const ids = map.get(name) ?? [];
        ids.push(id);
        map.set(name, ids);
      }
    }
  } catch {
    // Best effort — if we can't fetch, sync will still try create
  }
  return map;
}

/**
 * Delete all LiteLLM DB entries for a given model by their internal UUIDs.
 */
async function deleteModelEntries(
  proxyUrl: string,
  masterKey: string,
  internalIds: string[],
): Promise<void> {
  for (const id of internalIds) {
    try {
      await fetch(`${proxyUrl}/model/delete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${masterKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id }),
      });
    } catch { /* ignore */ }
  }
}

/**
 * Register a single model with LiteLLM proxy via POST /model/new
 *
 * @param existingModelIds - Pre-fetched map of model_name → LiteLLM internal IDs.
 *   If provided, stale entries are deleted before creating. Pass undefined to skip cleanup.
 * @returns true if sync succeeded, false otherwise
 */
export async function syncModelToLiteLLM(
  model: {
    id: string;
    providerId: string;
    toolCapable?: boolean;
    visionCapable?: boolean;
    maxInputTokens?: number | null;
  },
  existingModelIds?: Map<string, string[]>,
): Promise<boolean> {
  const proxyUrl = getLiteLLMProxyUrl();
  if (!proxyUrl) return false;

  const masterKey = process.env.LITELLM_MASTER_KEY;
  if (!masterKey) {
    console.warn('[LiteLLM Sync] LITELLM_MASTER_KEY not set, skipping sync');
    return false;
  }

  // Providers managed via litellm_config.yaml — skip dynamic sync
  // Ollama: YAML model names (e.g. "qwen2.5:3b") don't match DB IDs (e.g. "ollama-qwen2.5")
  // Fireworks: LiteLLM format ("fireworks_ai/accounts/fireworks/models/...") differs from DB IDs
  if (model.providerId === 'ollama' || model.providerId === 'fireworks') {
    return true;
  }

  const providerConfig = PROVIDER_MAP[model.providerId];
  if (!providerConfig) {
    console.warn(`[LiteLLM Sync] Unknown provider: ${model.providerId}, skipping ${model.id}`);
    return false;
  }

  // Build litellm_params based on provider
  const litellmParams: Record<string, string> = {
    model: `${providerConfig.prefix}${model.id}`,
  };

  // Use actual API key from app DB/env — LiteLLM does NOT resolve
  // os.environ/ references for models registered via /model/new (DB path)
  const apiKey = await getApiKey(model.providerId);
  litellmParams.api_key = apiKey ?? `os.environ/${providerConfig.envKey}`;

  const payload = {
    model_name: model.id,
    litellm_params: litellmParams,
    model_info: {
      supports_function_calling: model.toolCapable ?? false,
      supports_vision: model.visionCapable ?? false,
      ...(model.maxInputTokens ? { max_input_tokens: model.maxInputTokens } : {}),
    },
  };

  try {
    // Delete stale entries (old YAML-stored or broken syncs with os.environ/ literals)
    const staleIds = existingModelIds?.get(model.id);
    if (staleIds?.length) {
      await deleteModelEntries(proxyUrl, masterKey, staleIds);
    } else if (!existingModelIds) {
      // Single-model sync (from admin UI) — fetch + delete inline
      const map = await fetchExistingModelIds(proxyUrl, masterKey);
      const ids = map.get(model.id);
      if (ids?.length) {
        await deleteModelEntries(proxyUrl, masterKey, ids);
      }
    }

    const res = await fetch(`${proxyUrl}/model/new`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${masterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[LiteLLM Sync] Failed to register ${model.id}: ${res.status} ${text}`);
      return false;
    }

    return true;
  } catch (err) {
    console.warn(`[LiteLLM Sync] Error syncing ${model.id} (url: ${proxyUrl}/model/new):`, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Sync all active models from the database to LiteLLM proxy.
 * Called on app startup after DB migrations complete.
 *
 * @returns count of successfully synced and failed models
 */
export async function syncAllModelsToLiteLLM(): Promise<{ synced: number; failed: number }> {
  const proxyUrl = getLiteLLMProxyUrl();
  if (!proxyUrl) {
    return { synced: 0, failed: 0 };
  }

  const masterKey = process.env.LITELLM_MASTER_KEY;
  if (!masterKey) {
    return { synced: 0, failed: 0 };
  }

  let models;
  try {
    models = await getActiveModels();
  } catch (err) {
    console.warn('[LiteLLM Sync] Failed to fetch active models:', err instanceof Error ? err.message : err);
    return { synced: 0, failed: 0 };
  }

  if (models.length === 0) {
    return { synced: 0, failed: 0 };
  }

  // Fetch all existing LiteLLM model entries once (avoids N+1 API calls)
  const existingModelIds = await fetchExistingModelIds(proxyUrl, masterKey);

  let synced = 0;
  let failed = 0;

  for (const model of models) {
    const success = await syncModelToLiteLLM({
      id: model.id,
      providerId: model.providerId,
      toolCapable: model.toolCapable,
      visionCapable: model.visionCapable,
      maxInputTokens: model.maxInputTokens,
    }, existingModelIds);

    if (success) synced++;
    else failed++;
  }

  // Invalidate the parsed-models cache so capability checks pick up newly synced models
  clearLiteLLMCache();

  return { synced, failed };
}

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
 * Register a single model with LiteLLM proxy via POST /model/new
 *
 * @returns true if sync succeeded, false otherwise
 */
export async function syncModelToLiteLLM(model: {
  id: string;
  providerId: string;
  toolCapable?: boolean;
  visionCapable?: boolean;
  maxInputTokens?: number | null;
}): Promise<boolean> {
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
    // Delete any stale entry first (from previous YAML-stored or broken syncs)
    // This ensures we always create a fresh entry with the correct API key
    try {
      await fetch(`${proxyUrl}/model/delete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${masterKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: model.id }),
      });
    } catch { /* ignore — entry may not exist */ }

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

  let synced = 0;
  let failed = 0;

  for (const model of models) {
    const success = await syncModelToLiteLLM({
      id: model.id,
      providerId: model.providerId,
      toolCapable: model.toolCapable,
      visionCapable: model.visionCapable,
      maxInputTokens: model.maxInputTokens,
    });

    if (success) synced++;
    else failed++;
  }

  return { synced, failed };
}

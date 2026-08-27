/**
 * Ollama Cloud Service
 *
 * Provides model discovery, API calls, and database sync for Ollama Cloud
 * (https://ollama.com) hosted models via the native Ollama API.
 *
 * Route 5: Direct connection to Ollama Cloud (bypasses LiteLLM).
 * Uses native /api/chat format (not OpenAI-compatible).
 */

import { getProviderApiKey } from '@/lib/db/compat/llm-providers';
import { getEnabledModel, getModelsByProvider, createEnabledModel, updateEnabledModel } from '@/lib/db/compat/enabled-models';
import type { EnabledModel } from '@/lib/db/compat/enabled-models';
import { generateDisplayName } from '@/lib/llm-utils';
import type { DiscoveredModel } from './model-discovery';

// ============ Constants ============

export const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com/api';
export const OLLAMA_CLOUD_PROVIDER_ID = 'ollama-cloud';

// ============ Types ============

export interface OllamaCloudModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

// ============ API Key Management ============

/**
 * Get the Ollama Cloud API key from DB or environment variable
 */
export async function getOllamaCloudApiKey(): Promise<string | null> {
  return getProviderApiKey(OLLAMA_CLOUD_PROVIDER_ID);
}

/**
 * Check if Ollama Cloud is configured (has API key)
 */
export async function isOllamaCloudConfigured(): Promise<boolean> {
  const apiKey = await getOllamaCloudApiKey();
  return !!apiKey;
}

// ============ Model ID Pattern Detection ============

/**
 * Check if a model ID refers to an Ollama Cloud model.
 * Supports three patterns:
 * 1. Prefix: ollama-cloud/llama3.2
 * 2. Suffix: llama3.2-cloud
 * 3. Tag:    llama3.2:cloud
 */
export function isOllamaCloudModel(model: string): boolean {
  return (
    model.startsWith('ollama-cloud/') ||
    model.endsWith('-cloud') ||
    model.includes(':cloud')
  );
}

/**
 * Strip Ollama Cloud prefix/suffix to get the actual model name for the API.
 * e.g. "ollama-cloud/llama3.2-vision" → "llama3.2-vision"
 *       "llama3.2-cloud" → "llama3.2"
 *       "llama3.2:cloud" → "llama3.2"
 */
export function getOllamaCloudModelId(model: string): string {
  if (model.startsWith('ollama-cloud/')) {
    return model.slice('ollama-cloud/'.length);
  }
  if (model.endsWith('-cloud')) {
    return model.slice(0, -'-cloud'.length);
  }
  if (model.includes(':cloud')) {
    return model.replace(':cloud', '');
  }
  return model;
}

// ============ Capability Detection ============

// Known model capabilities for Ollama Cloud models
const KNOWN_MODEL_CAPABILITIES: Record<string, { toolCapable: boolean; visionCapable: boolean }> = {
  'llama3.2-vision': { toolCapable: true, visionCapable: true },
  'llama3.2': { toolCapable: true, visionCapable: false },
  'llama3.1': { toolCapable: true, visionCapable: false },
  'llama3': { toolCapable: true, visionCapable: false },
  'llama2': { toolCapable: false, visionCapable: false },
  'qwen2.5': { toolCapable: true, visionCapable: false },
  'qwen2.5-coder': { toolCapable: true, visionCapable: false },
  'qwen2.5-vl': { toolCapable: true, visionCapable: true },
  'qwen2': { toolCapable: true, visionCapable: false },
  'mistral': { toolCapable: true, visionCapable: false },
  'mistral-nemo': { toolCapable: true, visionCapable: false },
  'mixtral': { toolCapable: true, visionCapable: false },
  'codellama': { toolCapable: true, visionCapable: false },
  'deepseek-coder': { toolCapable: true, visionCapable: false },
  'deepseek-r1': { toolCapable: false, visionCapable: false },
  'phi3': { toolCapable: true, visionCapable: false },
  'phi3-vision': { toolCapable: true, visionCapable: true },
  'gemma2': { toolCapable: false, visionCapable: false },
  'nemotron': { toolCapable: false, visionCapable: false },
  'command-r': { toolCapable: true, visionCapable: false },
  'command-r-plus': { toolCapable: true, visionCapable: false },
};

/**
 * Detect capabilities for an Ollama Cloud model based on name patterns
 */
export function detectCapabilities(modelName: string): {
  toolCapable: boolean;
  visionCapable: boolean;
} {
  // Check known capabilities first
  const known = KNOWN_MODEL_CAPABILITIES[modelName];
  if (known) return { ...known };

  // Pattern-based detection
  const lowerName = modelName.toLowerCase();

  // Vision-capable patterns
  const visionCapable =
    lowerName.includes('vision') ||
    lowerName.includes('vl') ||
    lowerName.includes('multimodal') ||
    lowerName.includes('qvq');

  // Tool-capable patterns (most modern instruct/chat models support tools)
  const toolCapable =
    lowerName.includes('instruct') ||
    lowerName.includes('chat') ||
    lowerName.includes('coder') ||
    lowerName.includes('code') ||
    !lowerName.includes('embed') && !lowerName.includes('guard');

  return { toolCapable, visionCapable };
}

// ============ API Calls ============

/**
 * Fetch models from Ollama Cloud API
 */
export async function discoverOllamaCloudModels(): Promise<DiscoveredModel[]> {
  const apiKey = await getOllamaCloudApiKey();
  if (!apiKey) {
    throw new Error('Ollama Cloud API key not configured');
  }

  const response = await fetch(`${OLLAMA_CLOUD_BASE_URL}/tags`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Ollama Cloud API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { models: OllamaCloudModel[] };

  // Filter to chat models only (exclude embedding models)
  const chatModels = data.models.filter(m => {
    const name = m.name.split(':')[0].toLowerCase();
    return !name.includes('embed') && !name.includes('guard');
  });

  // Deduplicate: for each base model name, keep only unique tags.
  // If the only tag is "latest", use the base name. Otherwise use full "name:tag".
  const seen = new Set<string>();
  const uniqueModels = chatModels.filter(m => {
    const [base, tag] = m.name.split(':');
    // Normalize: "gemma3" and "gemma3:latest" are the same — use base name
    const normalized = (!tag || tag === 'latest') ? base : m.name;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  const models = await Promise.all(uniqueModels.map(async m => {
    const [base, tag] = m.name.split(':');
    const modelName = (!tag || tag === 'latest') ? base : m.name;
    const id = `ollama-cloud/${modelName}`;
    const caps = detectCapabilities(base);

    return {
      id,
      name: generateDisplayName(id),
      provider: OLLAMA_CLOUD_PROVIDER_ID,
      toolCapable: caps.toolCapable,
      visionCapable: caps.visionCapable,
      forcedToolCapable: false,
      maxInputTokens: null, // Ollama Cloud doesn't report this
      maxOutputTokens: 8192, // Conservative default
      isEnabled: !!(await getEnabledModel(id)),
    };
  }));

  return models.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Test connection to Ollama Cloud by fetching model list
 */
export async function testOllamaCloudConnection(): Promise<{
  success: boolean;
  message: string;
  modelCount?: number;
}> {
  try {
    const models = await discoverOllamaCloudModels();
    return {
      success: true,
      message: `Connected successfully. Found ${models.length} models.`,
      modelCount: models.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message };
  }
}

/**
 * Call Ollama Cloud native /api/chat endpoint
 * Uses native Ollama API format (not OpenAI-compatible)
 */
export async function callOllamaCloud(
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    think?: boolean;
  }
): Promise<Response> {
  const apiKey = await getOllamaCloudApiKey();
  if (!apiKey) {
    throw new Error('Ollama Cloud API key not configured');
  }

  const actualModel = getOllamaCloudModelId(model);

  // Convert OpenAI-style messages to Ollama native format
  // Ollama native API uses 'system' role directly (no separate system parameter)
  const ollamaMessages = messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  const body: Record<string, unknown> = {
    model: actualModel,
    messages: ollamaMessages,
    stream: options?.stream ?? false,
    ...(options?.think !== undefined ? { think: options.think } : {}),
    options: {
      temperature: options?.temperature ?? 0.7,
      ...(options?.maxTokens ? { num_predict: options.maxTokens } : {}),
    },
  };

  return fetch(`${OLLAMA_CLOUD_BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

// ============ Database Sync ============

/**
 * Sync discovered Ollama Cloud models to the enabled_models table
 * New models are added as disabled by default.
 * Routed through compat layer so the write-through mirror fires for both
 * enabled_models and model_catalog + organization_deployment.
 */
export async function syncCloudModelsToDatabase(): Promise<{
  added: number;
  total: number;
}> {
  const models = await discoverOllamaCloudModels();
  let added = 0;

  for (const model of models) {
    const existing = await getEnabledModel(model.id);
    if (!existing) {
      await createEnabledModel({
        id: model.id,
        providerId: OLLAMA_CLOUD_PROVIDER_ID,
        displayName: model.name,
        toolCapable: model.toolCapable,
        visionCapable: model.visionCapable,
        maxInputTokens: model.maxInputTokens ?? undefined,
        maxOutputTokens: model.maxOutputTokens ?? undefined,
        isDefault: false,
        enabled: false, // Disabled by default
        sortOrder: 9900,
      });
      added++;
    }
  }

  return { added, total: models.length };
}

// ============ Model Management ============

/**
 * Get all Ollama Cloud models from the database.
 * Routed through compat layer (MODEL_CATALOG_READS flag-aware).
 */
export async function getAllCloudModels(): Promise<EnabledModel[]> {
  return getModelsByProvider(OLLAMA_CLOUD_PROVIDER_ID);
}

/**
 * Get enabled Ollama Cloud models only.
 * Routed through compat layer (MODEL_CATALOG_READS flag-aware).
 */
export async function getEnabledCloudModels(): Promise<EnabledModel[]> {
  const all = await getModelsByProvider(OLLAMA_CLOUD_PROVIDER_ID);
  return all.filter((m) => m.enabled);
}

/**
 * Enable a specific Ollama Cloud model.
 * Routed through compat layer so the write-through mirror fires.
 */
export async function enableCloudModel(id: string): Promise<void> {
  await updateEnabledModel(id, { enabled: true });
}

/**
 * Disable a specific Ollama Cloud model.
 * Routed through compat layer so the write-through mirror fires.
 */
export async function disableCloudModel(id: string): Promise<void> {
  await updateEnabledModel(id, { enabled: false });
}

/**
 * Enable all Ollama Cloud models.
 * Routed through compat layer so the write-through mirror fires.
 */
export async function enableAllCloudModels(): Promise<number> {
  const models = await getModelsByProvider(OLLAMA_CLOUD_PROVIDER_ID);
  let count = 0;
  for (const model of models) {
    if (!model.enabled) {
      await updateEnabledModel(model.id, { enabled: true });
      count++;
    }
  }
  return count;
}

/**
 * Disable all Ollama Cloud models.
 * Routed through compat layer so the write-through mirror fires.
 */
export async function disableAllCloudModels(): Promise<number> {
  const models = await getModelsByProvider(OLLAMA_CLOUD_PROVIDER_ID);
  let count = 0;
  for (const model of models) {
    if (model.enabled) {
      await updateEnabledModel(model.id, { enabled: false });
      count++;
    }
  }
  return count;
}

/**
 * Batch update model status (enable/disable multiple models at once).
 * Routed through compat layer so the write-through mirror fires.
 */
export async function batchUpdateModelStatus(
  updates: Array<{ id: string; enabled: boolean }>
): Promise<number> {
  let updated = 0;

  for (const { id, enabled } of updates) {
    await updateEnabledModel(id, { enabled });
    updated++;
  }

  return updated;
}

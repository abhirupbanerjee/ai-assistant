/**
 * Model Discovery Service
 *
 * Discovers available models from LLM provider APIs (OpenAI, Gemini, Mistral, Ollama)
 */

import { getProviderApiKey, getProviderApiBase } from '../db/compat/llm-providers';
import { getEnabledModel } from '../db/compat/enabled-models';
import { generateDisplayName, getProviderFromModelPath } from '../litellm-validator';

// ============ Types ============

export interface DiscoveredModel {
  id: string;
  name: string;           // Display name
  provider: string;       // 'openai', 'gemini', 'mistral', 'ollama'
  toolCapable: boolean;
  visionCapable: boolean;
  maxInputTokens: number | null;
  maxOutputTokens: number;  // Provider-based default or API value
  isEnabled: boolean;     // Already enabled in Policy Bot
}

export interface DiscoveryResult {
  success: boolean;
  provider: string;
  models: DiscoveredModel[];
  error?: string;
}

// ============ Known Model Capabilities ============

// Models known to support function calling
const TOOL_CAPABLE_PATTERNS = [
  // OpenAI
  /^gpt-4/,
  /^gpt-5/,  // GPT-5 family
  /^gpt-3\.5-turbo/,
  /^o1/,
  /^o3/,
  /^o4/,  // Future-proofing
  // Gemini
  /^gemini/,
  // Mistral
  /^mistral-large/,
  /^mistral-small/,
  /^mistral-medium/,
  /^codestral/,
  /^pixtral/,
  // Anthropic Claude
  /^claude/,
  // DeepSeek (chat only — deepseek-reasoner does not support tool_choice)
  /^deepseek-chat/,
  // Ollama (some models)
  /^llama3/,
  /^llama4/,  // Future-proofing
  /^qwen/,
  /^mistral$/,
];

// Models known to support vision/images
const VISION_CAPABLE_PATTERNS = [
  // OpenAI
  /^gpt-4o/,
  /^gpt-4-turbo/,
  /^gpt-4\.1/,
  /^gpt-5/,  // GPT-5 family supports vision
  /^o1/,
  /^o3/,
  /^o4/,  // Future-proofing
  // Gemini
  /^gemini-2/,
  /^gemini-1\.5/,
  // Mistral
  /^pixtral/,
  /^mistral-large/,  // Mistral Large 3+ supports vision
  /^mistral-small-3/,
  // Anthropic Claude (all Claude 3+ models support vision)
  /^claude/,
  // Note: DeepSeek does NOT support vision
];

// Models known to reliably handle parallel tool calls (multiple tool_calls in one response)
const PARALLEL_TOOL_CAPABLE_PATTERNS = [
  // Anthropic Claude — excellent multi-tool support
  /^claude/,
  // Google Gemini — full parallel + compositional support
  /^gemini/,
  // Mistral Large — trained for parallel and sequential
  /^mistral-large/,
  // OpenAI — GPT-4.1 family, GPT-5-nano, GPT-5.2+ (GPT-5 base has ~90% failure rate)
  /^gpt-4\.1/,
  /^gpt-5-nano/,
  /^gpt-5\.2/,
  /^gpt-5\.3/,
  /^gpt-5\.4/,
  // Fireworks-hosted models (MiniMax, Kimi, etc.)
  /^fireworks\//,
  /^accounts\/fireworks/,
];
// NOT parallel capable (default=0 in DB):
//   gpt-5 (base) — 90% failure rate on parallel calls
//   deepseek-chat — weak multi-turn tool calling
//   ollama models — generally unreliable
//   o1, o3, o4 — reasoning models, tool_choice restrictions

// Models known to support thinking/reasoning content
// Used for UI display toggle — shows collapsible "Thinking" block in chat
const THINKING_CAPABLE_PATTERNS = [
  // Anthropic Claude — native thinking blocks
  /^claude/,
  // Think-tag models — <think>…</think> parsed via parseThinkChunk()
  /^qwen3/,
  /^qwq/,
  /^deepseek-r/,
  // OpenAI reasoning models
  /^o1/,
  /^o3/,
  /^o4/,
];

// Known context window sizes
const CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI - GPT-5 family (assuming similar to GPT-4.1)
  'gpt-5': 1000000,
  'gpt-5.1': 1000000,
  'gpt-5.2': 1000000,
  // OpenAI - GPT-4 family
  'gpt-4.1': 1000000,
  'gpt-4.1-mini': 1000000,
  'gpt-4.1-nano': 1000000,
  'gpt-5.4': 1000000,
  'gpt-5-mini': 1000000,
  'gpt-5-nano': 1000000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16385,
  // OpenAI - o-series
  'o1': 200000,
  'o1-preview': 128000,
  'o1-mini': 128000,
  'o3': 200000,
  'o3-mini': 200000,
  // Gemini
  'gemini-2.5-pro': 1000000,
  'gemini-2.5-flash': 1000000,
  'gemini-2.5-flash-lite': 1000000,
  'gemini-pro-latest': 1049000,
  'gemini-flash-latest': 1049000,
  'gemini-flash-lite-latest': 1049000,
  'gemini-1.5-pro': 1000000,
  'gemini-1.5-flash': 1000000,
  // Mistral
  'mistral-large-latest': 256000,
  'mistral-small-latest': 32000,
  // Anthropic Claude
  'claude-sonnet-4-6': 1000000,
  'claude-opus-4-6': 1000000,
  'claude-sonnet-4-5': 1000000,
  'claude-haiku-4-5': 1000000,
  'claude-opus-4-5': 1000000,
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  'claude-3-5-sonnet': 200000,
  // DeepSeek (use actual API model IDs)
  'deepseek-reasoner': 64000,
  'deepseek-chat': 128000,
};

// Provider-specific default output token limits
const DEFAULT_OUTPUT_TOKENS: Record<string, number> = {
  deepseek: 8000,
  ollama: 2000,
  openai: 16000,
  anthropic: 16000,
  gemini: 16000,
  mistral: 16000,
};

/**
 * Get default max output tokens for a provider
 */
export function getDefaultOutputTokens(provider: string): number {
  return DEFAULT_OUTPUT_TOKENS[provider] ?? 16000;
}

// ============ Capability Detection ============

/**
 * Returns true for models that embed reasoning inside <think>…</think> blocks
 * (Qwen3, QwQ, DeepSeek-R1). These need special streaming parsing.
 */
export function isThinkTagModel(modelId: string): boolean {
  let id = modelId.toLowerCase();
  // Strip single-segment prefixes (ollama-, ollama/, litellm/)
  id = id.replace(/^(ollama[-/]|litellm\/)/, '');
  // For path-style IDs (fireworks, together, openrouter, etc.)
  // e.g. "accounts/fireworks/models/qwen3-235b-a22b" → "qwen3-235b-a22b"
  const lastSlash = id.lastIndexOf('/');
  if (lastSlash !== -1) id = id.slice(lastSlash + 1);
  // Strip version/tag suffixes (e.g. ":8b", ":latest", "-instruct")
  id = id.replace(/:.*$/, '');
  return /^(qwen3|qwq|deepseek-r)/.test(id);
}

function isToolCapable(modelId: string): boolean {
  // Strip ollama- prefix so "ollama-qwen2.5" matches /^qwen/ patterns
  const id = modelId.toLowerCase().replace(/^ollama-/, '');
  return TOOL_CAPABLE_PATTERNS.some(pattern => pattern.test(id));
}

function isVisionCapable(modelId: string): boolean {
  // Strip ollama- prefix for consistent pattern matching
  const id = modelId.toLowerCase().replace(/^ollama-/, '');
  return VISION_CAPABLE_PATTERNS.some(pattern => pattern.test(id));
}

function isParallelToolCapable(modelId: string): boolean {
  const id = modelId.toLowerCase().replace(/^ollama-/, '');
  return PARALLEL_TOOL_CAPABLE_PATTERNS.some(pattern => pattern.test(id));
}

function isThinkingCapable(modelId: string): boolean {
  const id = modelId.toLowerCase().replace(/^ollama-/, '');
  return THINKING_CAPABLE_PATTERNS.some(pattern => pattern.test(id));
}

function getContextWindow(modelId: string): number | null {
  // Try exact match first
  if (CONTEXT_WINDOWS[modelId]) {
    return CONTEXT_WINDOWS[modelId];
  }

  // Try prefix match (sort by key length descending for most specific match)
  const sortedEntries = Object.entries(CONTEXT_WINDOWS)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [key, value] of sortedEntries) {
    if (modelId.startsWith(key)) {
      return value;
    }
  }

  // Fallback: Try to match base model family with regex
  const familyPatterns: [RegExp, number][] = [
    [/^gpt-5/, 1000000],
    [/^gpt-4\.1/, 1000000],
    [/^gpt-4o/, 128000],
    [/^gpt-4-turbo/, 128000],
    [/^gpt-4/, 8192],
    [/^gpt-3\.5/, 16385],
    [/^o[134]-/, 200000],
    [/^gemini-2\.5/, 1000000],
    [/^gemini-1\.5/, 1000000],
    [/^gemini-2/, 1000000],
    [/^mistral-large/, 256000],
    [/^mistral-small/, 32000],
    [/^claude/, 1000000],
    [/^deepseek-r/, 64000],
    [/^deepseek/, 128000],
  ];

  for (const [pattern, value] of familyPatterns) {
    if (pattern.test(modelId)) {
      return value;
    }
  }

  return null;
}

// ============ Model Filtering ============

// Models to exclude (embedding, audio, image generation, moderation, legacy)
const EXCLUDED_PATTERNS = [
  // Embedding models
  /embed/i,
  /text-embedding/i,
  // Audio models
  /whisper/i,
  /tts/i,
  /audio/i,
  /realtime/i,
  // Image generation
  /dall-e/i,
  /image/i,
  // Moderation & safety
  /text-moderation/i,
  /moderation/i,
  /omni-moderation/i,
  // Legacy/completion models (not chat)
  /babbage/i,
  /davinci/i,
  /curie/i,
  /ada(?!-)/i,  // ada but not ada-embedding
  /instruct(?!.*(gpt|turbo))/i,  // instruct models except gpt-instruct variants
  // Internal/preview/deprecated
  /canary/i,
  /deprecated/i,
  /preview.*audio/i,
  // Search/retrieval models
  /search/i,
  /similarity/i,
  // Code-specific non-chat models
  /code-davinci/i,
  /code-cushman/i,
  // Transcription
  /transcribe/i,
];

function isChatModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return !EXCLUDED_PATTERNS.some(pattern => pattern.test(id));
}

// ============ Provider Discovery ============

/**
 * Discover models from OpenAI API
 */
async function discoverOpenAIModels(apiKey: string): Promise<DiscoveredModel[]> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { data: Array<{ id: string }> };

  const filtered = data.data.filter(m => isChatModel(m.id));
  const models = await Promise.all(filtered.map(async m => ({
    id: m.id,
    name: generateDisplayName(m.id),
    provider: 'openai',
    toolCapable: isToolCapable(m.id),
    visionCapable: isVisionCapable(m.id),
    maxInputTokens: getContextWindow(m.id),
    maxOutputTokens: getDefaultOutputTokens('openai'),
    isEnabled: !!(await getEnabledModel(m.id)),
  })));
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Discover models from Google Gemini API
 */
async function discoverGeminiModels(apiKey: string): Promise<DiscoveredModel[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    models: Array<{
      name: string;
      supportedGenerationMethods: string[];
      inputTokenLimit?: number;
      outputTokenLimit?: number;
    }>;
  };

  const filtered = data.models.filter(m => {
    // Filter to generative models only
    const methods = m.supportedGenerationMethods || [];
    return methods.includes('generateContent') && isChatModel(m.name);
  });
  const models = await Promise.all(filtered.map(async m => {
    // Extract model ID from full name (e.g., "models/gemini-2.5-flash" -> "gemini-2.5-flash")
    const id = m.name.replace('models/', '');
    return {
      id,
      name: generateDisplayName(id),
      provider: 'gemini',
      toolCapable: isToolCapable(id),
      visionCapable: isVisionCapable(id),
      maxInputTokens: m.inputTokenLimit || getContextWindow(id),
      // Use actual outputTokenLimit from API if available, else provider default
      maxOutputTokens: m.outputTokenLimit || getDefaultOutputTokens('gemini'),
      isEnabled: !!(await getEnabledModel(id)),
    };
  }));
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Discover models from Mistral API
 */
async function discoverMistralModels(apiKey: string): Promise<DiscoveredModel[]> {
  const response = await fetch('https://api.mistral.ai/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Mistral API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { data: Array<{ id: string }> };

  const filtered = data.data.filter(m => isChatModel(m.id));
  const models = await Promise.all(filtered.map(async m => ({
    id: m.id,
    name: generateDisplayName(m.id),
    provider: 'mistral',
    toolCapable: isToolCapable(m.id),
    visionCapable: isVisionCapable(m.id),
    maxInputTokens: getContextWindow(m.id),
    maxOutputTokens: getDefaultOutputTokens('mistral'),
    isEnabled: !!(await getEnabledModel(m.id)),
  })));
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Discover models from Ollama local server
 */
async function discoverOllamaModels(apiBase: string): Promise<DiscoveredModel[]> {
  const baseUrl = apiBase.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/api/tags`);

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { models: Array<{ name: string }> };

  const filtered = data.models.filter(m => isChatModel(m.name));
  const models = await Promise.all(filtered.map(async m => {
    // Ollama model names often include tags like ":latest"
    const baseName = m.name.split(':')[0];
    const id = `ollama-${baseName}`;
    return {
      id,
      name: generateDisplayName(id),
      provider: 'ollama',
      toolCapable: isToolCapable(baseName),
      visionCapable: isVisionCapable(baseName),
      maxInputTokens: null,  // Ollama doesn't report this
      maxOutputTokens: getDefaultOutputTokens('ollama'),
      isEnabled: !!(await getEnabledModel(id)),
    };
  }));
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Discover models from Anthropic API
 * Uses the List Models endpoint: GET /v1/models
 */
async function discoverAnthropicModels(apiKey: string): Promise<DiscoveredModel[]> {
  const response = await fetch('https://api.anthropic.com/v1/models?limit=100', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    data: Array<{ id: string; display_name: string; created_at: string; type: string }>;
  };

  const filtered = data.data.filter(m => isChatModel(m.id));
  const models = await Promise.all(filtered.map(async m => ({
    id: m.id,
    name: generateDisplayName(m.id),
    provider: 'anthropic',
    toolCapable: isToolCapable(m.id),
    visionCapable: isVisionCapable(m.id),
    maxInputTokens: getContextWindow(m.id),
    maxOutputTokens: getDefaultOutputTokens('anthropic'),
    isEnabled: !!(await getEnabledModel(m.id)),
  })));
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Discover models from DeepSeek API
 */
async function discoverDeepSeekModels(apiKey: string): Promise<DiscoveredModel[]> {
  const response = await fetch('https://api.deepseek.com/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { data: Array<{ id: string }> };

  const filtered = data.data.filter(m => isChatModel(m.id));
  const models = await Promise.all(filtered.map(async m => ({
    id: m.id,
    name: generateDisplayName(m.id),
    provider: 'deepseek',
    toolCapable: isToolCapable(m.id),
    // DeepSeek does NOT support vision
    visionCapable: false,
    maxInputTokens: getContextWindow(m.id),
    maxOutputTokens: getDefaultOutputTokens('deepseek'),
    isEnabled: !!(await getEnabledModel(m.id)),
  })));
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Curated Fireworks AI models (Zero Data Retention, SOC2/GDPR/HIPAA)
 * Returns the 5 approved models rather than the full Fireworks catalog (300+)
 */
async function discoverFireworksModels(apiKey: string): Promise<DiscoveredModel[]> {
  // Validate API key by calling the models endpoint
  const response = await fetch('https://api.fireworks.ai/inference/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Fireworks API error: ${response.status} ${response.statusText}`);
  }

  const FIREWORKS_MODELS = [
    {
      id: 'fireworks/minimax-m2p5',
      name: 'MiniMax M2.5',
      toolCapable: true,
      visionCapable: true,
      maxInputTokens: 1000000,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/kimi-k2p5',
      name: 'Kimi K2.5',
      toolCapable: true,
      visionCapable: false,
      maxInputTokens: 131072,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/gpt-oss-120b',
      name: 'OpenAI GPT-OSS 120B',
      toolCapable: true,
      visionCapable: false,
      maxInputTokens: 131072,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/qwen3p6-plus',
      name: 'Qwen3 P6 Plus',
      toolCapable: true,
      visionCapable: true,
      maxInputTokens: 131072,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/minimax-m2p7',
      name: 'MiniMax M2.7',
      toolCapable: true,
      visionCapable: false,
      maxInputTokens: 131072,
      maxOutputTokens: 16384,
    },
  ];

  return Promise.all(
    FIREWORKS_MODELS.map(async m => ({
      ...m,
      provider: 'fireworks',
      isEnabled: !!(await getEnabledModel(m.id)),
    }))
  );
}

// ============ Main Discovery Function ============

/**
 * Discover available models from a provider
 */
export async function discoverModels(provider: string): Promise<DiscoveryResult> {
  try {
    let models: DiscoveredModel[];

    switch (provider) {
      case 'openai': {
        const apiKey = await getProviderApiKey('openai');
        if (!apiKey) {
          return { success: false, provider, models: [], error: 'API key not configured' };
        }
        models = await discoverOpenAIModels(apiKey);
        break;
      }

      case 'gemini': {
        const apiKey = await getProviderApiKey('gemini');
        if (!apiKey) {
          return { success: false, provider, models: [], error: 'API key not configured' };
        }
        models = await discoverGeminiModels(apiKey);
        break;
      }

      case 'mistral': {
        const apiKey = await getProviderApiKey('mistral');
        if (!apiKey) {
          return { success: false, provider, models: [], error: 'API key not configured' };
        }
        models = await discoverMistralModels(apiKey);
        break;
      }

      case 'ollama': {
        const apiBase = await getProviderApiBase('ollama');
        if (!apiBase) {
          return { success: false, provider, models: [], error: 'API base URL not configured' };
        }
        models = await discoverOllamaModels(apiBase);
        break;
      }

      case 'anthropic': {
        const apiKey = await getProviderApiKey('anthropic');
        if (!apiKey) {
          return { success: false, provider, models: [], error: 'API key not configured' };
        }
        models = await discoverAnthropicModels(apiKey);
        break;
      }

      case 'deepseek': {
        const apiKey = await getProviderApiKey('deepseek');
        if (!apiKey) {
          return { success: false, provider, models: [], error: 'API key not configured' };
        }
        models = await discoverDeepSeekModels(apiKey);
        break;
      }

      case 'fireworks': {
        const apiKey = await getProviderApiKey('fireworks');
        if (!apiKey) {
          return { success: false, provider, models: [], error: 'API key not configured' };
        }
        models = await discoverFireworksModels(apiKey);
        break;
      }

      default:
        return { success: false, provider, models: [], error: `Unknown provider: ${provider}` };
    }

    return { success: true, provider, models };

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Model Discovery] Error discovering ${provider} models:`, message);
    return { success: false, provider, models: [], error: message };
  }
}

/**
 * Test provider connection by attempting to list models
 */
export async function testProviderConnection(provider: string): Promise<{
  success: boolean;
  message: string;
  modelCount?: number;
}> {
  const result = await discoverModels(provider);

  if (result.success) {
    return {
      success: true,
      message: `Connected successfully. Found ${result.models.length} models.`,
      modelCount: result.models.length,
    };
  }

  return {
    success: false,
    message: result.error || 'Connection failed',
  };
}

/**
 * Discover models from all configured providers
 */
export async function discoverAllModels(): Promise<{
  providers: Record<string, DiscoveryResult>;
  totalModels: number;
}> {
  const providers = ['openai', 'gemini', 'mistral', 'ollama', 'anthropic', 'deepseek', 'fireworks'];
  const results: Record<string, DiscoveryResult> = {};
  let totalModels = 0;

  const discoveries = await Promise.allSettled(
    providers.map(async (provider) => {
      const result = await discoverModels(provider);
      return { provider, result };
    })
  );

  for (const discovery of discoveries) {
    if (discovery.status === 'fulfilled') {
      const { provider, result } = discovery.value;
      results[provider] = result;
      if (result.success) {
        totalModels += result.models.length;
      }
    }
  }

  return { providers: results, totalModels };
}

// ============ Exported Capability Functions ============
// Used by enabled-models.ts to refresh model capabilities

export { isToolCapable, isVisionCapable, isParallelToolCapable, isThinkingCapable, getContextWindow };

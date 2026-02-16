/**
 * Model Discovery Service
 *
 * Discovers available models from LLM provider APIs (OpenAI, Gemini, Mistral, Ollama)
 */

import { getProviderApiKey, getProviderApiBase } from '../db/llm-providers';
import { getEnabledModel } from '../db/enabled-models';
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
  // DeepSeek
  /^deepseek/,
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
  'gemini-1.5-pro': 1000000,
  'gemini-1.5-flash': 1000000,
  // Mistral
  'mistral-large-latest': 256000,
  'mistral-small-latest': 32000,
  // Anthropic Claude
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

function isToolCapable(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return TOOL_CAPABLE_PATTERNS.some(pattern => pattern.test(id));
}

function isVisionCapable(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return VISION_CAPABLE_PATTERNS.some(pattern => pattern.test(id));
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

  return data.data
    .filter(m => isChatModel(m.id))
    .map(m => ({
      id: m.id,
      name: generateDisplayName(m.id),
      provider: 'openai',
      toolCapable: isToolCapable(m.id),
      visionCapable: isVisionCapable(m.id),
      maxInputTokens: getContextWindow(m.id),
      maxOutputTokens: getDefaultOutputTokens('openai'),
      isEnabled: !!getEnabledModel(m.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

  return data.models
    .filter(m => {
      // Filter to generative models only
      const methods = m.supportedGenerationMethods || [];
      return methods.includes('generateContent') && isChatModel(m.name);
    })
    .map(m => {
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
        isEnabled: !!getEnabledModel(id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
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

  return data.data
    .filter(m => isChatModel(m.id))
    .map(m => ({
      id: m.id,
      name: generateDisplayName(m.id),
      provider: 'mistral',
      toolCapable: isToolCapable(m.id),
      visionCapable: isVisionCapable(m.id),
      maxInputTokens: getContextWindow(m.id),
      maxOutputTokens: getDefaultOutputTokens('mistral'),
      isEnabled: !!getEnabledModel(m.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

  return data.models
    .filter(m => isChatModel(m.name))
    .map(m => {
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
        isEnabled: !!getEnabledModel(id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Discover models from Anthropic API
 * Note: Anthropic doesn't have a public models list endpoint,
 * so we return a hardcoded list of known models
 */
async function discoverAnthropicModels(apiKey: string): Promise<DiscoveredModel[]> {
  // Verify API key by making a simple request
  // Anthropic doesn't have a models endpoint, so we test with a minimal completion
  const testResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });

  // Check if API key is valid (we don't need the response to succeed, just auth)
  if (testResponse.status === 401) {
    throw new Error('Anthropic API error: Invalid API key');
  }

  // Return hardcoded list of known Claude models
  const knownModels = [
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
    'claude-opus-4-5',
    'claude-3-5-sonnet',
    'claude-3-opus',
    'claude-3-sonnet',
    'claude-3-haiku',
  ];

  return knownModels
    .filter(m => isChatModel(m))
    .map(m => ({
      id: m,
      name: generateDisplayName(m),
      provider: 'anthropic',
      toolCapable: isToolCapable(m),
      visionCapable: isVisionCapable(m),
      maxInputTokens: getContextWindow(m),
      maxOutputTokens: getDefaultOutputTokens('anthropic'),
      isEnabled: !!getEnabledModel(m),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

  return data.data
    .filter(m => isChatModel(m.id))
    .map(m => ({
      id: m.id,
      name: generateDisplayName(m.id),
      provider: 'deepseek',
      toolCapable: isToolCapable(m.id),
      // DeepSeek does NOT support vision
      visionCapable: false,
      maxInputTokens: getContextWindow(m.id),
      maxOutputTokens: getDefaultOutputTokens('deepseek'),
      isEnabled: !!getEnabledModel(m.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
        const apiKey = getProviderApiKey('openai');
        if (!apiKey) {
          return { success: false, provider, models: [], error: 'API key not configured' };
        }
        models = await discoverOpenAIModels(apiKey);
        break;
      }

      case 'gemini': {
        const apiKey = getProviderApiKey('gemini');
        if (!apiKey) {
          return { success: false, provider, models: [], error: 'API key not configured' };
        }
        models = await discoverGeminiModels(apiKey);
        break;
      }

      case 'mistral': {
        const apiKey = getProviderApiKey('mistral');
        if (!apiKey) {
          return { success: false, provider, models: [], error: 'API key not configured' };
        }
        models = await discoverMistralModels(apiKey);
        break;
      }

      case 'ollama': {
        const apiBase = getProviderApiBase('ollama');
        if (!apiBase) {
          return { success: false, provider, models: [], error: 'API base URL not configured' };
        }
        models = await discoverOllamaModels(apiBase);
        break;
      }

      case 'anthropic': {
        const apiKey = getProviderApiKey('anthropic');
        if (!apiKey) {
          return { success: false, provider, models: [], error: 'API key not configured' };
        }
        models = await discoverAnthropicModels(apiKey);
        break;
      }

      case 'deepseek': {
        const apiKey = getProviderApiKey('deepseek');
        if (!apiKey) {
          return { success: false, provider, models: [], error: 'API key not configured' };
        }
        models = await discoverDeepSeekModels(apiKey);
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
  const providers = ['openai', 'gemini', 'mistral', 'ollama', 'anthropic', 'deepseek'];
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

export { isToolCapable, isVisionCapable, getContextWindow };

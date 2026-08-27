/**
 * Model Discovery Service
 *
 * Discovers available models from LLM provider APIs (OpenAI, Gemini, Mistral, Ollama)
 */

import { getProviderApiKey, getProviderApiBase } from '../db/compat/llm-providers';
import { getEnabledModel, getDeployedModelIds } from '../db/compat/enabled-models';
import { isLikelyThinkingCapableModel, isClaudeAdaptiveThinkingModel } from '@/lib/llm-thinking';
import { generateDisplayName, getProviderFromModelPath } from '../llm-utils';
import { getMoonshotBaseUrl } from '../moonshot-config';

// ============ Types ============

export interface DiscoveredModel {
  id: string;
  name: string;           // Display name
  provider: string;       // 'openai', 'gemini', 'mistral', 'ollama'
  toolCapable: boolean;
  visionCapable: boolean;
  forcedToolCapable: boolean;
  maxInputTokens: number | null;
  maxOutputTokens: number;  // Provider-based default or API value
  isEnabled: boolean;     // Already enabled in AI Assistant
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
  // Anthropic Claude
  /^claude/,
  // DeepSeek V4 (flash and pro both support tool calling)
  /^deepseek-v4-(flash|pro)/,
  /^fireworks\/deepseek-v4-(flash|pro)/,
  /^accounts\/fireworks\/models\/deepseek-v4-(flash|pro)/,
  // Moonshot / Kimi
  /^kimi/,
  /^moonshot/,
  /^fireworks\/kimi/,
  /^accounts\/fireworks\/models\/kimi/,
  // MiniMax
  /^fireworks\/minimax/,
  /^accounts\/fireworks\/models\/minimax/,
  // Fireworks-hosted chat models (serverless)
  /^fireworks\//,
  /^accounts\/fireworks\//,
  // Azure AI Foundry (Route 5)
  /^azure-foundry\//,
  // Ollama (some models)
  /^llama3/,
  /^llama4/,  // Future-proofing
  /^qwen/,
  /^mistral$/,
];

// Models known to support vision/images
const VISION_CAPABLE_PATTERNS = [
  // OpenAI
  /^gpt-4\.1/,
  /^gpt-5/,  // GPT-5 family supports vision
  // Gemini
  /^gemini-2/,
  /^gemini-3/,
  /^mistral-large/,  // Mistral Large 3+ supports vision
  /^mistral-small/,
  // Azure AI Foundry (Route 5) — same vision capabilities as OpenAI
  /^azure-foundry\/gpt-4/,
  // Anthropic Claude (all Claude 3+ models support vision)
  /^claude/,
  // MiniMax M3 is natively multimodal (text + image + video)
  /^fireworks\/minimax-m3/,
  /^accounts\/fireworks\/models\/minimax-m3/,
  // Kimi K2.x and Qwen3.7 Plus support vision on Fireworks
  /^fireworks\/kimi-k2p[567]/,
  /^accounts\/fireworks\/models\/kimi-k2p[567]/,
  /^fireworks\/kimi-k2-thinking/,
  /^accounts\/fireworks\/models\/kimi-k2-thinking/,
  /^fireworks\/qwen3p7-plus/,
  /^accounts\/fireworks\/models\/qwen3p7-plus/,
  // Qwen vision-language models
  /^fireworks\/qwen.*vl/,
  /^accounts\/fireworks\/models\/qwen.*vl/,
  // Llama / Gemma vision models
  /^fireworks\/llama.*vision/,
  /^fireworks\/llama4/,
  /^fireworks\/gemma-4/,
  // Note: DeepSeek does NOT support vision
];

// Models known to support forced tool_choice (required / specific function)
const FORCED_TOOL_CAPABLE_PATTERNS = [
  // OpenAI
  /^gpt-4/,
  /^gpt-5/,
  /^gpt-3\.5-turbo/,
  /^o1/,
  /^o3/,
  /^o4/,
  // Gemini
  /^gemini/,
  // Mistral
  /^mistral-large/,
  /^mistral-small/,
  /^mistral-medium/,
  /^codestral/,
  /^pixtral/,
  // Anthropic Claude (most models, but exceptions like fable-5 may not support forced)
  /^claude/,
  // DeepSeek V4
  /^deepseek-v4-(flash|pro)/,
  // Moonshot / Kimi
  /^kimi/,
  /^moonshot/,
  // Fireworks hosted
  /^fireworks\//,
  /^accounts\/fireworks/,
  // Azure AI Foundry (Route 5)
  /^azure-foundry\//,
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
  /^gpt-5\.5/,
  /^gpt-5\.6/,
  // Fireworks-hosted models (MiniMax, Kimi, etc.)
  /^fireworks\//,
  /^accounts\/fireworks/,
  // Azure AI Foundry (Route 5) — same parallel capabilities as OpenAI
  /^azure-foundry\//,
  // Moonshot / Kimi K2 — full tool calling with parallel support
  /^moonshot\/kimi/,
  // DeepSeek V4 — full tool calling with parallel support
  /^deepseek-v4-(flash|pro)/,
  /^fireworks\/deepseek-v4-(flash|pro)/,
  /^accounts\/fireworks\/models\/deepseek-v4-(flash|pro)/,
];
// NOT parallel capable (default=0 in DB):
//   gpt-5 (base) — 90% failure rate on parallel calls
//   legacy DeepSeek models (pre-V4) are intentionally excluded
//   ollama models — generally unreliable
//   o1, o3, o4 — reasoning models, tool_choice restrictions

// Models known to support thinking/reasoning content
// Used for UI display toggle — shows collapsible "Thinking" block in chat
const THINKING_CAPABLE_PATTERNS = [
  // Anthropic Claude — native thinking blocks
  /^claude/,
  // OpenAI GPT-5 family (excluding o-series in isLikelyThinkingCapableModel)
  /^gpt-5/,
  // Think-tag models — <think>…</think> parsed via parseThinkChunk()
  /^qwen3/,
  /^fireworks\/qwen3/,
  /^accounts\/fireworks\/models\/qwen3/,
  /^qwq/,
  /^deepseek-v4-(flash|pro)/,
  /^fireworks\/deepseek-v4-(flash|pro)/,
  /^accounts\/fireworks\/models\/deepseek-v4-(flash|pro)/,
  /^deepseek-reasoner/,
  // Moonshot / Kimi (future-proofing for reasoning mode exposure)
  /^kimi-k/,
  /^fireworks\/kimi-k/,
  /^accounts\/fireworks\/models\/kimi-k/,
  // Other exposed-reasoning families
  /^gpt-oss/,
  /^gemini-2\.5/,
  /^gemini-3/,
  /^magistral/,
  // MiniMax M3 exposes reasoning via the thinking parameter
  /^minimax-m3/,
  /^fireworks\/minimax-m3/,
  /^accounts\/fireworks\/models\/minimax-m3/,
];

// Models known to be deprecated or unavailable — warns on discovery
export const DEPRECATED_MODELS = new Set([
  'gpt-4.1-mini',
  'gpt-4.1-nano',
]);

// Known context window sizes (based on official OpenAI API docs, June 2026)
const CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI - GPT-5.5/5.4 family (1,050,000 tokens)
  'gpt-5.5': 1050000,
  'gpt-5.5-pro': 1050000,
  'gpt-5.4': 1050000,
  'gpt-5.4-mini': 1050000,
  'gpt-5.4-nano': 1050000,
  'gpt-5.4-pro': 1050000,
  // OpenAI - GPT-5.6 family (1,050,000 tokens)
  'gpt-5.6': 1050000,
  'gpt-5.6-sol': 1050000,
  'gpt-5.6-terra': 1050000,
  'gpt-5.6-luna': 1050000,
  'gpt-5.6-pro': 1050000,
  // OpenAI - GPT-5 base family (272K input + 128K output)
  'gpt-5': 272000,
  'gpt-5.1': 272000,
  'gpt-5.2': 272000,
  'gpt-5.3': 272000,
  'gpt-5-mini': 272000,
  'gpt-5-nano': 272000,
  'gpt-5-pro': 272000,
  'gpt-5-codex': 272000,
  // OpenAI - GPT-4 family
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4.1': 1000000,
  'gpt-4.1-mini': 1000000,
  'gpt-4.1-nano': 1000000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  // OpenAI - o-series
  'o1': 200000,
  'o1-preview': 128000,
  'o1-mini': 128000,
  'o3': 200000,
  'o3-mini': 200000,
  'o4-mini': 200000,
  // Gemini 2.5
  'gemini-2.5-pro': 1000000,
  'gemini-2.5-flash': 1000000,
  'gemini-2.5-flash-lite': 1000000,
  // Gemini 3.x
  'gemini-3-flash-preview': 1048576,
  'gemini-3.1-pro-preview': 1048576,
  'gemini-3.5-flash': 1048576,
  'gemini-3.5-flash-lite': 1048576,
  'gemini-3.6-flash': 1048576,
  'gemini-3.1-flash-lite': 1048576,
  // Gemini latest aliases
  'gemini-pro-latest': 1049000,
  'gemini-flash-latest': 1049000,
  'gemini-flash-lite-latest': 1049000,

  // Mistral
  'mistral-large-latest': 262144,
  'mistral-large-3': 262144,
  'mistral-large-2512': 262144,
  'mistral-medium-latest': 256000,
  'mistral-medium-3.5': 256000,
  'mistral-medium-3-5': 256000,
  'mistral-medium-3': 131072,
  'mistral-small-latest': 128000,
  'mistral-small-4': 128000,
  'mistral-small-3.2': 128000,
  'mistral-small-3': 32000,
  // Anthropic Claude
  'claude-sonnet-4-7': 1000000,
  'claude-sonnet-4-6': 1000000,
  'claude-opus-4-7': 1000000,
  'claude-opus-4-6': 1000000,
  'claude-fable-5': 1000000,
  'claude-sonnet-4-5': 1000000,
  'claude-haiku-4-5': 1000000,
  'claude-opus-4-5': 1000000,
  // Moonshot / Kimi K2 (native API)
  'moonshot/kimi-k2.6': 262144,
  'moonshot/kimi-k2.5': 262144,
  'kimi-k2.6': 262144,
  'kimi-k2.5': 262144,
  // Moonshot / Kimi K3 (native API) — 1M context
  'moonshot/kimi-k3': 1048576,
  'kimi-k3': 1048576,
  // Mistral legacy aliases
  'mistral-medium': 256000,
  'mistral-large': 262144,
  // DeepSeek V4 (native API)
  'deepseek-v4-flash': 1048576,
  'deepseek-v4-pro': 1048576,

  // Fireworks serverless chat models
  'fireworks/deepseek-v4-flash': 1048576,
  'fireworks/deepseek-v4-pro': 1048576,
  'fireworks/glm-5p2': 1048576,
  'fireworks/glm-5p1': 202752,
  'fireworks/glm-5': 202752,
  'fireworks/kimi-k2p6': 262144,
  'fireworks/kimi-k2p5': 262144,
  'fireworks/kimi-k2p7-code': 262144,
  'fireworks/kimi-k2-thinking': 262144,
  'fireworks/minimax-m2p5': 196608,
  'fireworks/minimax-m2p7': 196608,
  'fireworks/minimax-m3': 512000,
  'fireworks/gpt-oss-20b': 131072,
  'fireworks/gpt-oss-120b': 131072,
  'fireworks/nemotron-3-ultra-nvfp4': 262144,
  'fireworks/qwen3p7-plus': 262144,
  'accounts/fireworks/models/glm-5p2': 1048576,
  'accounts/fireworks/models/glm-5p1': 202752,
  'accounts/fireworks/models/glm-5': 202752,
  'accounts/fireworks/models/kimi-k2p6': 262144,
  'accounts/fireworks/models/kimi-k2p5': 262144,
  'accounts/fireworks/models/kimi-k2p7-code': 262144,
  'accounts/fireworks/models/kimi-k2-thinking': 262144,
  'accounts/fireworks/models/minimax-m2p5': 196608,
  'accounts/fireworks/models/minimax-m2p7': 196608,
  'accounts/fireworks/models/minimax-m3': 512000,
  'accounts/fireworks/models/gpt-oss-20b': 131072,
  'accounts/fireworks/models/gpt-oss-120b': 131072,
  'accounts/fireworks/models/nemotron-3-ultra-nvfp4': 262144,
  'accounts/fireworks/models/qwen3p7-plus': 262144,
  'accounts/fireworks/models/deepseek-v4-flash': 1048576,
  'accounts/fireworks/models/deepseek-v4-pro': 1048576,

};

// Provider-specific default output token limits
const DEFAULT_OUTPUT_TOKENS: Record<string, number> = {
  deepseek: 16000,
  ollama: 2000,
  openai: 128000,    // GPT-5 series supports up to 128K output
  anthropic: 32000,
  gemini: 65536,
  mistral: 8000,
  fireworks: 16384,
  'azure-foundry': 16000,
  moonshot: 16000,
};

/**
 * Get default max output tokens for a provider
 */
export function getDefaultOutputTokens(provider: string): number {
  return DEFAULT_OUTPUT_TOKENS[provider] ?? 16000;
}

function getFireworksOutputTokens(modelId: string): number {
  if (/minimax-m3/i.test(modelId)) return 32768;
  return getDefaultOutputTokens('fireworks');
}

// Fireworks-specific chat filter: keep instruct-tuned chat models,
// but drop embeddings, audio, image-generation, moderation, and non-chat models.
function isFireworksChatModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return EXCLUDED_PATTERNS.every(pattern => {
    // Don't reject instruct-tuned chat models on Fireworks (e.g. llama-v3p1-8b-instruct)
    if (pattern.source === 'instruct(?!.*(gpt|turbo))') return true;
    return !pattern.test(id);
  });
}

// ============ Capability Detection ============

/**
 * Returns true for models that embed reasoning inside <think>…</think> blocks
 * (Qwen3, QwQ, DeepSeek-R1). These need special streaming parsing.
 */
export function isThinkTagModel(modelId: string): boolean {
  let id = modelId.toLowerCase();
  // Strip single-segment prefixes (ollama-, ollama/)
  id = id.replace(/^(ollama[-/])/, '');
  // For path-style IDs (fireworks, together, openrouter, etc.)
  // e.g. "accounts/fireworks/models/qwen3-235b-a22b" → "qwen3-235b-a22b"
  const lastSlash = id.lastIndexOf('/');
  if (lastSlash !== -1) id = id.slice(lastSlash + 1);
  // Strip version/tag suffixes (e.g. ":8b", ":latest", "-instruct")
  id = id.replace(/:.*$/, '');
  return /^(qwen3|qwq|deepseek-v4-pro|kimi-k|gpt-oss)/.test(id);
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

function isForcedToolCapable(modelId: string): boolean {
  const id = modelId.toLowerCase().replace(/^ollama-/, '');
  // Reasoning / tag models and Ollama generally don't support forced tool choice reliably.
  // EXCEPTION: Kimi K3 and DeepSeek V4 Pro are newer reasoning models that DO support
  // tool_choice: 'required' (per official Moonshot and DeepSeek API docs). Without this
  // exemption, site_gen and other generative tools are never called by these models
  // because tool_choice gets downgraded to 'auto', letting the LLM choose text/web_search
  // over the intended tool.
  if (isThinkTagModel(modelId)) {
    // Normalize to last path segment for comparison (same logic as isThinkTagModel)
    let lastSeg = id;
    const slashIdx = lastSeg.lastIndexOf('/');
    if (slashIdx !== -1) lastSeg = lastSeg.slice(slashIdx + 1);
    lastSeg = lastSeg.replace(/:.*$/, '');
    if (lastSeg.startsWith('kimi-k3') || lastSeg.endsWith('deepseek-v4-pro')) {
      // These models support forced tool_choice — fall through to pattern check below
    } else {
      return false;
    }
  }
  if (id.startsWith('ollama-') || id.startsWith('ollama/') || id.startsWith('ollama-cloud/')) return false;
  // Claude adaptive-thinking models (e.g. claude-fable-5, opus-4.7+) reject forced
  // tool_choice — they decide their own reasoning/tool strategy. Exclude them even
  // though the blanket /^claude/ pattern below would otherwise match.
  if (isClaudeAdaptiveThinkingModel(modelId)) return false;
  return FORCED_TOOL_CAPABLE_PATTERNS.some(pattern => pattern.test(id));
}

function isThinkingCapable(modelId: string): boolean {
  const id = modelId.toLowerCase().replace(/^ollama-/, '');
  return THINKING_CAPABLE_PATTERNS.some(pattern => pattern.test(id)) || isLikelyThinkingCapableModel(modelId);
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
    [/^gpt-4-turbo/, 128000],
    [/^gpt-4/, 8192],
    [/^gemini-2\.5/, 1000000],
    [/^gemini-2/, 1000000],
    [/^mistral-large/, 256000],
    [/^mistral-small/, 32000],
    [/^claude/, 1000000],
    [/^deepseek-v4/, 1048576],
    [/^fireworks\/deepseek-v4/, 1048576],
    [/^accounts\/fireworks\/models\/deepseek-v4/, 1048576],
    [/^fireworks\/glm/, 200000],
    [/^accounts\/fireworks\/models\/glm/, 200000],
    [/^fireworks\/kimi-k2/, 262144],
    [/^accounts\/fireworks\/models\/kimi-k2/, 262144],
    [/^fireworks\/minimax-m2/, 200000],
    [/^accounts\/fireworks\/models\/minimax-m2/, 200000],
    [/^fireworks\/minimax-m3/, 512000],
    [/^accounts\/fireworks\/models\/minimax-m3/, 512000],
    [/^fireworks\/gpt-oss/, 131072],
    [/^accounts\/fireworks\/models\/gpt-oss/, 131072],
    [/^fireworks\/qwen3p7-plus/, 262144],
    [/^accounts\/fireworks\/models\/qwen3p7-plus/, 262144],
    [/^fireworks\/nemotron-3/, 262144],
    [/^accounts\/fireworks\/models\/nemotron-3/, 262144],
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
    forcedToolCapable: isForcedToolCapable(m.id),
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
      forcedToolCapable: isForcedToolCapable(id),
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
    forcedToolCapable: isForcedToolCapable(m.id),
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

  // Deduplicate: "model:latest" and "model" are the same — use base name.
  // Keep distinct size variants like "llama3.2:3b" and "llama3.2:7b" as separate entries.
  const seen = new Set<string>();
  const uniqueModels = filtered.filter(m => {
    const [base, tag] = m.name.split(':');
    const normalized = (!tag || tag === 'latest') ? base : m.name;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  const models = await Promise.all(uniqueModels.map(async m => {
    const [base, tag] = m.name.split(':');
    const modelName = (!tag || tag === 'latest') ? base : m.name;
    const id = `ollama-${modelName}`;
    return {
      id,
      name: generateDisplayName(id),
      provider: 'ollama',
      toolCapable: isToolCapable(base),
      visionCapable: isVisionCapable(base),
      forcedToolCapable: isForcedToolCapable(base),
      maxInputTokens: null,  // Ollama doesn't report this
      maxOutputTokens: getDefaultOutputTokens('ollama'),
      isEnabled: !!(await getEnabledModel(id)),
    };
  }));
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Verify an Ollama Cloud API key without reading its persisted configuration.
 * The API is OpenAI-compatible and accepts the account key on `/models`.
 */
async function discoverOllamaCloudModelsWithKey(apiKey: string, apiBase?: string): Promise<DiscoveredModel[]> {
  const baseUrl = (apiBase || 'https://api.ollama.com/v1').replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Ollama Cloud API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json() as { data?: Array<{ id: string }> };
  return (data.data ?? []).map((model) => ({
    id: `ollama-cloud/${model.id}`,
    name: generateDisplayName(model.id),
    provider: 'ollama-cloud',
    toolCapable: isToolCapable(model.id),
    visionCapable: isVisionCapable(model.id),
    forcedToolCapable: isForcedToolCapable(model.id),
    maxInputTokens: getContextWindow(model.id),
    maxOutputTokens: getDefaultOutputTokens('ollama-cloud'),
    isEnabled: false,
  }));
}

/** Verify a supplied Azure AI Foundry project endpoint using workload identity. */
async function discoverAzureFoundryModelsAtEndpoint(apiBase: string): Promise<DiscoveredModel[]> {
  const { AIProjectClient } = await import('@azure/ai-projects');
  const { DefaultAzureCredential } = await import('@azure/identity');
  const project = new AIProjectClient(apiBase.replace(/\/$/, ''), new DefaultAzureCredential());
  const deployments: DiscoveredModel[] = [];
  for await (const deployment of project.deployments.list()) {
    if (deployment.type === 'ModelDeployment' && 'modelName' in deployment && 'modelPublisher' in deployment) {
      const d = deployment as { name: string; modelName: string };
      deployments.push({
        id: `azure-foundry/${d.name}`,
        name: generateDisplayName(d.modelName),
        provider: 'azure-foundry',
        toolCapable: isToolCapable(`azure-foundry/${d.name}`),
        visionCapable: isVisionCapable(`azure-foundry/${d.name}`),
        forcedToolCapable: isForcedToolCapable(`azure-foundry/${d.name}`),
        maxInputTokens: getContextWindow(`azure-foundry/${d.name}`),
        maxOutputTokens: getDefaultOutputTokens('azure-foundry'),
        isEnabled: false,
      });
    }
  }
  return deployments.sort((a, b) => a.name.localeCompare(b.name));
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
    forcedToolCapable: isForcedToolCapable(m.id),
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

  const allowedDeepSeekModels = new Set(['deepseek-v4-pro', 'deepseek-v4-flash']);
  const filtered = data.data.filter(m => isChatModel(m.id) && allowedDeepSeekModels.has(m.id));
  const models = await Promise.all(filtered.map(async m => ({
    id: m.id,
    name: generateDisplayName(m.id),
    provider: 'deepseek',
    toolCapable: isToolCapable(m.id),
    // DeepSeek does NOT support vision
    visionCapable: false,
    forcedToolCapable: isForcedToolCapable(m.id),
    maxInputTokens: getContextWindow(m.id),
    maxOutputTokens: 16384,
    isEnabled: !!(await getEnabledModel(m.id)),
  })));
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Curated Fireworks AI serverless chat models
 *
 * Context windows, vision tags and pricing verified from the public Fireworks
 * serverless catalog (https://fireworks.ai/models?modelTypes=Serverless) and
 * pricing page (https://docs.fireworks.ai/serverless/pricing).
 *
 * For models not in this curated list, admins can use the Tavily-powered
 * "Get Model Details" endpoint at /api/admin/llm/models/get-details to auto-fill
 * capabilities and pricing from web search.
 */
/**
 * Fallback model list for Fireworks when the API returns no chat models.
 * **Exit Gate 2:** delete this array and the fallback branch below.
 */
const FIREWORKS_FALLBACK_MODELS = [
    {
      id: 'fireworks/glm-5p2',
      name: 'GLM 5.2',
      toolCapable: true,
      visionCapable: false,
      forcedToolCapable: true,
      maxInputTokens: 1048576,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/glm-5p1',
      name: 'GLM 5.1',
      toolCapable: true,
      visionCapable: false,
      forcedToolCapable: true,
      maxInputTokens: 202752,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/kimi-k2p7-code',
      name: 'Kimi K2.7 Code',
      toolCapable: true,
      visionCapable: true,
      forcedToolCapable: true,
      maxInputTokens: 262144,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/kimi-k2p6',
      name: 'Kimi K2.6',
      toolCapable: true,
      visionCapable: true,
      forcedToolCapable: true,
      maxInputTokens: 262144,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/kimi-k2p5',
      name: 'Kimi K2.5',
      toolCapable: true,
      visionCapable: true,
      forcedToolCapable: true,
      maxInputTokens: 262144,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/qwen3p7-plus',
      name: 'Qwen3.7 Plus',
      toolCapable: true,
      visionCapable: true,
      forcedToolCapable: true,
      maxInputTokens: 262144,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/minimax-m3',
      name: 'MiniMax M3',
      toolCapable: true,
      visionCapable: true,
      forcedToolCapable: true,
      maxInputTokens: 512000,
      maxOutputTokens: 32768,
    },
    {
      id: 'fireworks/minimax-m2p7',
      name: 'MiniMax M2.7',
      toolCapable: true,
      visionCapable: false,
      forcedToolCapable: true,
      maxInputTokens: 196608,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/minimax-m2p5',
      name: 'MiniMax M2.5',
      toolCapable: true,
      visionCapable: false,
      forcedToolCapable: true,
      maxInputTokens: 196608,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/gpt-oss-120b',
      name: 'OpenAI GPT-OSS 120B',
      toolCapable: true,
      visionCapable: false,
      forcedToolCapable: false,
      maxInputTokens: 131072,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/gpt-oss-20b',
      name: 'OpenAI GPT-OSS 20B',
      toolCapable: true,
      visionCapable: false,
      forcedToolCapable: false,
      maxInputTokens: 131072,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/nemotron-3-ultra-nvfp4',
      name: 'NVIDIA Nemotron 3 Ultra NVFP4',
      toolCapable: true,
      visionCapable: false,
      forcedToolCapable: true,
      maxInputTokens: 262144,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      toolCapable: true,
      visionCapable: false,
      forcedToolCapable: true,
      maxInputTokens: 1048576,
      maxOutputTokens: 16384,
    },
    {
      id: 'fireworks/deepseek-v4-pro',
      name: 'DeepSeek V4 Pro',
      toolCapable: true,
      visionCapable: false,
      forcedToolCapable: false,
      maxInputTokens: 1048576,
      maxOutputTokens: 16384,
    },
];

/**
 * Discover models from the Fireworks AI API.
 *
 * Calls `GET /v1/models`, parses the response (which returns only `{ id, object }` —
 * no capability metadata), applies the §3 alias transform
 * (`accounts/fireworks/models/<name>` → `fireworks/<name>`), filters to chat-only
 * models via `isFireworksChatModel()`, and classifies each model using the existing
 * pattern-matching functions.
 *
 * Falls back to `FIREWORKS_FALLBACK_MODELS` if the API returns zero chat models
 * (e.g. empty response, all models filtered out). **Exit Gate 2** removes the fallback.
 */
async function discoverFireworksModels(apiKey: string): Promise<DiscoveredModel[]> {
  const response = await fetch('https://api.fireworks.ai/inference/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Fireworks API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { data?: Array<{ id: string; object: string }> };
  const apiModels = data.data ?? [];

  // Alias transform: accounts/fireworks/models/<name> → fireworks/<name>
  const FIREWORKS_PREFIX = 'accounts/fireworks/models/';
  const aliasId = (transportId: string): string =>
    transportId.startsWith(FIREWORKS_PREFIX)
      ? 'fireworks/' + transportId.slice(FIREWORKS_PREFIX.length)
      : transportId;

  // Parse, filter, and classify each model from the API response
  const discovered: DiscoveredModel[] = [];
  for (const apiModel of apiModels) {
    const transportId = apiModel.id;
    // Filter: only chat models (drops embeddings, audio, image-gen, moderation, etc.)
    if (!isFireworksChatModel(transportId)) continue;

    const id = aliasId(transportId);
    const contextWindow = getContextWindow(id) ?? getContextWindow(transportId);

    discovered.push({
      id,
      name: generateDisplayName(id),
      provider: 'fireworks',
      toolCapable: isToolCapable(id),
      visionCapable: isVisionCapable(id),
      forcedToolCapable: isForcedToolCapable(id),
      maxInputTokens: contextWindow,
      maxOutputTokens: getFireworksOutputTokens(id),
      isEnabled: false, // set below
    });
  }

  // Resolve enabled status for each discovered model
  const withEnabled = await Promise.all(
    discovered.map(async m => ({
      ...m,
      isEnabled: !!(await getEnabledModel(m.id)),
    }))
  );

  // Fallback: if API returned no chat models, use the hardcoded list
  if (withEnabled.length === 0) {
    return Promise.all(
      FIREWORKS_FALLBACK_MODELS.map(async m => ({
        ...m,
        provider: 'fireworks',
        isEnabled: !!(await getEnabledModel(m.id)),
      }))
    );
  }

  return withEnabled;
}

/**
 * Discover models from Moonshot AI API
 * Uses OpenAI-compatible /v1/models endpoint
 */
async function discoverMoonshotModels(apiKey: string): Promise<DiscoveredModel[]> {
  const baseUrl = await getMoonshotBaseUrl();
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Moonshot API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { data: Array<{ id: string }> };

  const filtered = data.data.filter(m => isChatModel(m.id));
  const models = await Promise.all(filtered.map(async m => ({
    id: `moonshot/${m.id}`,
    name: generateDisplayName(m.id),
    provider: 'moonshot',
    toolCapable: isToolCapable(m.id),
    visionCapable: isVisionCapable(m.id),
    forcedToolCapable: isForcedToolCapable(m.id),
    maxInputTokens: getContextWindow(m.id),
    maxOutputTokens: getDefaultOutputTokens('moonshot'),
    isEnabled: !!(await getEnabledModel(`moonshot/${m.id}`)),
  })));
  return models.sort((a, b) => a.name.localeCompare(b.name));
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

      case 'ollama-cloud': {
        const apiKey = await getProviderApiKey('ollama-cloud');
        if (!apiKey) {
          return { success: false, provider, models: [], error: 'API key not configured' };
        }
        // Use the discoverOllamaCloudModels function from ollama-cloud service
        const { discoverOllamaCloudModels } = await import('./ollama-cloud');
        const cloudModels = await discoverOllamaCloudModels();
        models = cloudModels.map(m => ({
          id: m.id,
          name: m.name,
          provider: 'ollama-cloud',
          toolCapable: m.toolCapable,
          visionCapable: m.visionCapable,
          forcedToolCapable: false,
          maxInputTokens: m.maxInputTokens,
          maxOutputTokens: m.maxOutputTokens,
          isEnabled: m.isEnabled,
        }));
        break;
      }

      case 'moonshot': {
        const apiKey = await getProviderApiKey('moonshot');
        if (!apiKey) {
          return { success: false, provider, models: [], error: 'API key not configured' };
        }
        models = await discoverMoonshotModels(apiKey);
        break;
      }

      case 'azure-foundry': {
        const apiBase = await getProviderApiBase('azure-foundry');
        if (!apiBase) {
          return { success: false, provider, models: [], error: 'AZURE_FOUNDRY_ENDPOINT not configured' };
        }
        const discovered = await discoverAzureFoundryModelsAtEndpoint(apiBase);
        models = await Promise.all(discovered.map(async (model) => ({
          ...model,
          isEnabled: !!(await getEnabledModel(model.id)),
        })));
        break;
      }

      default:
        return { success: false, provider, models: [], error: `Unknown provider: ${provider}` };
    }

    // Batch-check actual deployment status (organization_deployment rows).
    // The per-discoverer isEnabled calls above use getEnabledModel() which
    // returns any model_catalog row regardless of status/deployment — so a
    // retired or `new` (never-deployed) model would incorrectly show as
    // enabled. Here we override with the correct batch check.
    if (models.length > 0) {
      const deployedIds = await getDeployedModelIds(models.map(m => m.id));
      models = models.map(m => ({ ...m, isEnabled: deployedIds.has(m.id) }));
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
 * Test a specific API key against a provider without reading from DB/ENV.
 * The key is used only for this test request — it is never stored or logged.
 *
 * @param provider  Provider ID (e.g. 'openai', 'anthropic')
 * @param apiKey    The API key to test
 * @param apiBase   Optional API base URL override (for ollama, azure-foundry)
 */
export async function testProviderConnectionWithKey(
  provider: string,
  apiKey: string,
  apiBase?: string,
): Promise<{
  success: boolean;
  message: string;
  modelCount?: number;
}> {
  try {
    let models: DiscoveredModel[];

    switch (provider) {
      case 'openai':
        models = await discoverOpenAIModels(apiKey);
        break;
      case 'gemini':
        models = await discoverGeminiModels(apiKey);
        break;
      case 'mistral':
        models = await discoverMistralModels(apiKey);
        break;
      case 'ollama':
        if (!apiBase) {
          return { success: false, message: 'API base URL is required for Ollama' };
        }
        models = await discoverOllamaModels(apiBase);
        break;
      case 'anthropic':
        models = await discoverAnthropicModels(apiKey);
        break;
      case 'deepseek':
        models = await discoverDeepSeekModels(apiKey);
        break;
      case 'fireworks':
        models = await discoverFireworksModels(apiKey);
        break;
      case 'ollama-cloud': {
        models = await discoverOllamaCloudModelsWithKey(apiKey, apiBase);
        break;
      }
      case 'moonshot':
        models = await discoverMoonshotModels(apiKey);
        break;
      case 'azure-foundry':
        if (!apiBase) {
          return { success: false, message: 'Azure Foundry endpoint URL is required' };
        }
        // Azure Foundry uses DefaultAzureCredential. Verify the supplied
        // endpoint directly rather than falling back to persisted settings.
        models = await discoverAzureFoundryModelsAtEndpoint(apiBase);
        break;
      default:
        return { success: false, message: `Unknown provider: ${provider}` };
    }

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
 * Discover models from all configured providers
 */
export async function discoverAllModels(): Promise<{
  providers: Record<string, DiscoveryResult>;
  totalModels: number;
}> {
  const providers = ['openai', 'gemini', 'mistral', 'ollama', 'anthropic', 'deepseek', 'fireworks', 'ollama-cloud', 'moonshot', 'azure-foundry'];
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
        // Warn about deprecated models so admins can remove them from the registry
        const deprecatedFound = result.models.filter(m => DEPRECATED_MODELS.has(m.id));
        if (deprecatedFound.length > 0) {
          console.warn(`[ModelDiscovery] Deprecated models found from ${provider}: ${deprecatedFound.map(m => m.id).join(', ')}. Consider removing these from enabled models.`);
        }
      }
    }
  }

  return { providers: results, totalModels };
}

// ============ Exported Capability Functions ============
// Used by enabled-models.ts to refresh model capabilities

export { isToolCapable, isVisionCapable, isParallelToolCapable, isThinkingCapable, isForcedToolCapable, getContextWindow };

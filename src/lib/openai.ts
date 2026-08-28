import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { isThinkTagModel } from '@/lib/services/model-discovery';
import {
  buildThinkingRequestProfile,
  isUnsupportedThinkingParamError,
  stripThinkingRequestParams,
  isTemperatureParamError,
  getTemperatureForModel,
  type ThinkingRequestProfile,
} from '@/lib/llm-thinking';
import type { Message, ToolCall, StreamingCallbacks, MessageVisualization, GeneratedDocumentInfo, GeneratedImageInfo, ImageContent, DiagramHint, PodcastHint, AgentResponseInfo } from '@/types';
import { isAgentTool } from './agent-registry/agent-tools';
import type { ModelSpec } from '@/types/agent';
import type { ToolExecutionRecord, FailureType } from '@/types/compliance';
import type { ImageCapabilities } from '@/lib/config-capability-checker';
import { getLlmSettings, getEmbeddingSettings, getLimitsSettings, getEffectiveMaxTokens, isToolCapableModelFromDb } from './db/compat/config';
import { isModelParallelToolCapable, isModelThinkingCapable, isModelForcedToolCapable } from './db/compat/enabled-models';
import { getToolDisplayName, getStreamingConfigMs } from './streaming/utils';
import { getToolDefinitions, executeTool, REQUEST_CLARIFICATION_TOOL } from './tools';
import { resolveToolRouting } from './tool-routing';
import { resolveSkills, determineToolChoice } from './skills/resolver';
import { toolsLogger as logger } from './logger';
import {
  DEFAULT_CONVERSATION_HISTORY_LIMIT,
  getEmbeddingModelById,
} from './constants';
import {
  isLocalEmbeddingModel,
  createLocalEmbedding,
  createLocalEmbeddings,
  resetLocalEmbedder,
  type LocalEmbeddingModel,
} from './local-embeddings';
import { recordTokenUsage } from './token-logger';
import { encoding_for_model, type TiktokenModel } from 'tiktoken';

// ============ Token Budget Management ============

/**
 * Count tokens in a string using tiktoken
 * Falls back to approximate count if tiktoken fails
 */
function countTokens(text: string, model: string = 'gpt-4o'): number {
  try {
    // Map model to tiktoken model name
    const tiktokenModel = mapToTiktokenModel(model);
    const encoder = encoding_for_model(tiktokenModel);
    const tokens = encoder.encode(text);
    encoder.free();
    return tokens.length;
  } catch {
    // Fallback: approximate 4 chars per token
    return Math.ceil(text.length / 4);
  }
}

/**
 * Map various model names to tiktoken model names
 */
function mapToTiktokenModel(model: string): TiktokenModel {
  const modelLower = model.toLowerCase();
  if (modelLower.includes('gpt-4o')) return 'gpt-4o';
  if (modelLower.includes('gpt-4')) return 'gpt-4';
  if (modelLower.includes('gpt-3.5')) return 'gpt-3.5-turbo';
  return 'gpt-4o';
}

/**
 * Truncate context to fit within token budget.
 * Returns the (possibly truncated) context and whether truncation occurred so
 * the caller can surface a user-visible notice when document context is incomplete.
 */
function truncateContextToBudget(
  context: string,
  systemPrompt: string,
  history: Message[],
  userMessage: string,
  maxTokens: number,
  model: string
): { context: string; wasTruncated: boolean } {
  // Calculate tokens for non-context parts
  const systemTokens = countTokens(systemPrompt, model);
  const historyTokens = history.reduce((sum, m) => sum + countTokens(m.content, model), 0);
  const userMessageTokens = countTokens(userMessage, model);
  const overheadTokens = 100; // Buffer for message formatting

  const usedTokens = systemTokens + historyTokens + userMessageTokens + overheadTokens;
  const availableTokens = maxTokens - usedTokens;

  if (availableTokens <= 0) {
    console.warn('[TokenBudget] No tokens available for context after accounting for system/history');
    return { context: '', wasTruncated: true };
  }

  const contextTokens = countTokens(context, model);

  if (contextTokens <= availableTokens) {
    return { context, wasTruncated: false }; // Context fits within budget
  }

  // Need to truncate - split by document sections and remove lowest scored
  const sections = context.split('---\n\n');
  let truncatedContext = '';
  let currentTokens = 0;
  let droppedSections = 0;

  // Keep adding sections until we hit the budget
  for (const section of sections) {
    const sectionTokens = countTokens(section, model);
    if (currentTokens + sectionTokens <= availableTokens) {
      truncatedContext += section + '---\n\n';
      currentTokens += sectionTokens;
    } else {
      droppedSections++;
    }
  }

  console.warn(
    `[TokenBudget] Context truncated from ${contextTokens} to ${currentTokens} tokens ` +
    `(${droppedSections} sections dropped, budget: ${availableTokens}, used: ${usedTokens})`
  );

  return { context: truncatedContext.trim(), wasTruncated: true };
}

// ============ Fallback Tracking ============
interface FallbackEvent {
  primaryModel: string;
  fallbackModel: string;
  error: string;
  timestamp: Date;
}

// Track recent fallback events (keep last 10)
const recentFallbackEvents: FallbackEvent[] = [];
const MAX_FALLBACK_EVENTS = 10;

/**
 * Record a fallback event
 */
function recordFallbackEvent(primaryModel: string, fallbackModel: string, error: Error | string): void {
  const event: FallbackEvent = {
    primaryModel,
    fallbackModel,
    error: error instanceof Error ? error.message : String(error),
    timestamp: new Date(),
  };
  recentFallbackEvents.unshift(event);
  if (recentFallbackEvents.length > MAX_FALLBACK_EVENTS) {
    recentFallbackEvents.pop();
  }
}

/**
 * Get recent fallback events
 */
export function getRecentFallbackEvents(): FallbackEvent[] {
  return [...recentFallbackEvents];
}

/**
 * Check if fallback was used recently (within last N minutes)
 */
export function wasFallbackUsedRecently(minutesAgo: number = 60): FallbackEvent | null {
  const cutoff = new Date(Date.now() - minutesAgo * 60 * 1000);
  return recentFallbackEvents.find(e => e.timestamp > cutoff) || null;
}

/**
 * Clear fallback events (e.g., after user acknowledges)
 */
export function clearFallbackEvents(): void {
  recentFallbackEvents.length = 0;
}
import {
  buildConversationContext,
  formatUserMessage,
  getHistoryForAPI,
  type ConversationContext,
} from './conversation-context';
import { resolveProviderCredentialForRequest, sharedProviderClientFactory } from './provider-credential';
import { isOllamaCloudModel, getOllamaCloudModelId, callOllamaCloud } from '@/lib/services/ollama-cloud';
import { isAzureFoundryModel, getAzureFoundryClient, stripAzureFoundryPrefix } from '@/lib/llm/providers/azure-foundry';
import { isMistralModel, stripMistralPrefix, streamMistralCompletion, isMistralEmbeddingModel, createMistralEmbedding, createMistralEmbeddings } from '@/lib/llm/providers/mistral';
import { isGeminiModel, streamGeminiCompletion, isGeminiEmbeddingModel, createGeminiEmbedding, createGeminiEmbeddings } from '@/lib/llm/providers/gemini';
import { isOpenAIModel, stripOpenAIPrefix, streamOpenAICompletion, requiresMaxCompletionTokens, isOpenAIEmbeddingModel, createOpenAIEmbedding, createOpenAIEmbeddings, getOpenAIDirectClient } from '@/lib/llm/providers/openai';

/**
 * Terminal tools that should stop the tool loop after successful execution.
 * These tools produce final outputs (images, documents) and should not be called again
 * unless the user explicitly requests it.
 *
 * Note: terminal status is backend loop-control only — it is never injected into the
 * LLM-facing function definitions, so nothing here discourages the model from emitting
 * multiple terminal tools in a single turn. All tool calls in one response execute and
 * emit artifacts regardless; this flag only stops the subsequent LLM iteration.
 */
export const TERMINAL_TOOLS = new Set([
  'image_gen', 'doc_gen', 'pptx_gen', 'xlsx_gen',
  'html_gen', 'site_gen', 'file_to_html',
  'chart_gen', 'diagram_gen', 'podcast_gen',
]);

/**
 * Tools that skills-based routing can map to via keyword matching.
 * Used to short-circuit `resolveSkills()` when all mappable tools are
 * excluded (common for sub-agents with narrow allowlists).
 */
export const SKILL_MAPPABLE_TOOLS = new Set([
  'web_search', 'web_extract', 'kb_search', 'kb_summary', 'kb_read',
  'doc_gen', 'pptx_gen', 'image_gen', 'xlsx_gen', 'chart_gen',
  'diagram_gen', 'podcast_gen', 'html_gen', 'site_gen',
  'data_source', 'aggregate_data', 'compliance_checker',
]);

/**
 * Check whether a tool name should be treated as terminal.
 * Built-in terminal membership is hardcoded in TERMINAL_TOOLS; MCP tools can be
 * marked terminal via their tool_configs metadata.
 */
export async function isTerminalTool(toolName: string): Promise<boolean> {
  if (TERMINAL_TOOLS.has(toolName)) return true;
  // Fast-path: only MCP tool names can be terminal beyond the hardcoded set.
  if (!toolName.startsWith('mcp_')) return false;
  // Avoid a circular import by lazy-loading the MCP module.
  const { isMcpTool, isMcpToolTerminal } = await import('./mcp/mcp-tools');
  if (isMcpTool(toolName)) {
    return isMcpToolTerminal(toolName);
  }
  return false;
}

// ============ Anthropic Direct Client ============

/**
 * Check if a model ID refers to a Claude/Anthropic model.
 * These models bypass LiteLLM and use the Anthropic SDK directly.
 */
function isClaudeModel(model: string): boolean {
  return model.startsWith('anthropic/') || model.startsWith('claude-');
}

/**
 * Strip provider prefix from model ID for the Anthropic API.
 * e.g. "anthropic/claude-sonnet-4-20250514" → "claude-sonnet-4-20250514"
 */
function getAnthropicModelId(model: string): string {
  return model.startsWith('anthropic/') ? model.slice('anthropic/'.length) : model;
}

async function getAnthropicClient(): Promise<Anthropic> {
  const cred = await resolveProviderCredentialForRequest('anthropic');
  const built = sharedProviderClientFactory.getClient({
    providerId: 'anthropic',
    credentialId: cred.credentialId,
    credentialVersion: cred.credentialVersion,
    apiKey: cred.apiKey,
    apiBase: null,
    timeoutMs: 300 * 1000, // 5 minutes — matches LiteLLM/OpenAI timeout
  });
  if (built.kind !== 'anthropic') {
    throw new Error('ProviderClientFactory returned a non-Anthropic client for anthropic');
  }
  return built.client;
}

// ============ Fireworks Direct Client ============

/**
 * Check if a model ID refers to a Fireworks AI model.
 * These models bypass LiteLLM and connect directly to api.fireworks.ai.
 */
export function isFireworksModel(model: string): boolean {
  return model.startsWith('fireworks/');
}

function getFireworksModelId(model: string): string {
  return model.startsWith('fireworks/')
    ? `accounts/fireworks/models/${model.slice('fireworks/'.length)}`
    : model;
}

async function getFireworksClient(): Promise<OpenAI> {
  const cred = await resolveProviderCredentialForRequest('fireworks');
  const built = sharedProviderClientFactory.getClient({
    providerId: 'fireworks',
    credentialId: cred.credentialId,
    credentialVersion: cred.credentialVersion,
    apiKey: cred.apiKey,
    apiBase: 'https://api.fireworks.ai/inference/v1',
    timeoutMs: 300 * 1000, // 5 minutes — matches LiteLLM/OpenAI/Anthropic timeout
  });
  if (built.kind !== 'openai') {
    throw new Error('ProviderClientFactory returned a non-OpenAI client for fireworks');
  }
  return built.client;
}

/**
 * Check if an embedding model is from Fireworks (routes direct, not via LiteLLM)
 */
function isFireworksEmbeddingModel(model: string): boolean {
  return model.startsWith('fireworks/') || model.startsWith('nomic-ai/');
}

/**
 * Convert internal embedding model ID to Fireworks API format.
 * Fireworks API expects `accounts/fireworks/models/<name>`.
 */
function getFireworksEmbeddingModelId(model: string): string {
  if (model.startsWith('fireworks/')) {
    return `accounts/fireworks/models/${model.slice('fireworks/'.length)}`;
  }
  if (model.startsWith('nomic-ai/')) {
    return `accounts/fireworks/models/${model.slice('nomic-ai/'.length)}`;
  }
  return model;
}

// ============ Ollama Direct Client ============

/**
 * Check if a model ID refers to an Ollama model.
 * These models bypass LiteLLM and connect directly to the local Ollama server.
 */
export function isOllamaModel(model: string): boolean {
  return (model.startsWith('ollama-') && !model.startsWith('ollama-cloud/')) || model.startsWith('ollama/');
}

/**
 * Strip provider prefix from model ID for the Ollama API.
 * e.g. "ollama/llama3.2:3b" → "llama3.2:3b", "ollama-llama3.2" → "llama3.2"
 */
function getOllamaModelId(model: string): string {
  if (model.startsWith('ollama/')) return model.slice('ollama/'.length);
  if (model.startsWith('ollama-')) return model.slice('ollama-'.length);
  return model;
}

async function getOllamaClient(): Promise<OpenAI> {
  const cred = await resolveProviderCredentialForRequest('ollama');
  const baseURL = ((cred.apiBase || 'http://localhost:11434').replace(/\/v1\/?$/, '')) + '/v1';
  const built = sharedProviderClientFactory.getClient({
    providerId: 'ollama',
    credentialId: cred.credentialId,
    credentialVersion: cred.credentialVersion,
    apiKey: 'ollama', // Ollama doesn't require a real API key
    apiBase: baseURL,
    timeoutMs: 300 * 1000, // 5 minutes — matches other clients
  });
  if (built.kind !== 'openai') {
    throw new Error('ProviderClientFactory returned a non-OpenAI client for ollama');
  }
  return built.client;
}

// ============ Moonshot Direct Client ============

/**
 * Check if a model ID refers to a Moonshot AI model.
 * These models bypass LiteLLM and connect directly to Moonshot
 * (base URL configurable via provider settings, default: api.moonshot.ai).
 */
export function isMoonshotModel(model: string): boolean {
  return model.startsWith('moonshot/');
}

/**
 * Check if a model ID refers to a DeepSeek model.
 * These models bypass LiteLLM and connect directly to DeepSeek.
 */
export function isDeepSeekModel(model: string): boolean {
  return model.startsWith('deepseek-') || model.startsWith('deepseek/');
}

/**
 * Strip provider prefix from model ID for the Moonshot API.
 * e.g. "moonshot/kimi-k2p5" → "kimi-k2p5"
 */
function getMoonshotModelId(model: string): string {
  return model.startsWith('moonshot/') ? model.slice('moonshot/'.length) : model;
}

async function getMoonshotClient(): Promise<OpenAI> {
  const cred = await resolveProviderCredentialForRequest('moonshot');
  const { getMoonshotBaseUrl } = await import('./moonshot-config');
  const baseURL = await getMoonshotBaseUrl();
  const built = sharedProviderClientFactory.getClient({
    providerId: 'moonshot',
    credentialId: cred.credentialId,
    credentialVersion: cred.credentialVersion,
    apiKey: cred.apiKey,
    apiBase: baseURL,
    timeoutMs: 300 * 1000, // 5 minutes — matches other clients
  });
  if (built.kind !== 'openai') {
    throw new Error('ProviderClientFactory returned a non-OpenAI client for moonshot');
  }
  return built.client;
}

/**
 * Strip provider prefix from model ID for the DeepSeek API.
 * e.g. "deepseek/deepseek-v4-flash" → "deepseek-v4-flash"
 */
function getDeepSeekModelId(model: string): string {
  return model.startsWith('deepseek/') ? model.slice('deepseek/'.length) : model;
}

async function getDeepSeekClient(): Promise<OpenAI> {
  const cred = await resolveProviderCredentialForRequest('deepseek');
  const baseURL = (cred.apiBase || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const built = sharedProviderClientFactory.getClient({
    providerId: 'deepseek',
    credentialId: cred.credentialId,
    credentialVersion: cred.credentialVersion,
    apiKey: cred.apiKey,
    apiBase: baseURL,
    timeoutMs: 300 * 1000, // 5 minutes — matches other clients
  });
  if (built.kind !== 'openai') {
    throw new Error('ProviderClientFactory returned a non-OpenAI client for deepseek');
  }
  return built.client;
}

/** Reset all cached LLM clients so they re-read API keys on next use */
export function resetLlmClients(): void {
  sharedProviderClientFactory.clear();
  // Reset Azure Foundry singleton (uses its own module-level cache)
  import('@/lib/llm/providers/azure-foundry').then(m => m.resetAzureFoundryClient()).catch(() => {});
  // Reset OpenAI direct singleton
  import('@/lib/llm/providers/openai').then(m => m.resetOpenAIClient()).catch(() => {});
}

/**
 * Record embedding usage with the credential that actually served the call.
 * Resolves the provider credential id (BYOK org credential vs platform) so
 * usage rows carry `credential_id`; `organization_id` is read from the request
 * context inside `recordTokenUsage`.
 */
async function recordEmbeddingUsage(opts: {
  providerId: string;
  model: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const cred = await resolveProviderCredentialForRequest(opts.providerId);
  recordTokenUsage({
    category: 'embeddings',
    model: opts.model,
    totalTokens: opts.totalTokens,
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    credentialId: cred.credentialId,
  });
}

export async function createEmbedding(text: string): Promise<number[]> {
  const embeddingSettings = await getEmbeddingSettings();
  // Use database config, fall back to env var for backward compatibility
  const model = embeddingSettings.model || process.env.EMBEDDING_MODEL || 'text-embedding-3-large';
  const fallbackModel = embeddingSettings.fallbackModel || 'text-embedding-3-large';

  try {
    // Route to local embeddings if local model
    if (isLocalEmbeddingModel(model)) {
      return await createLocalEmbedding(text, model as LocalEmbeddingModel);
    }

    // Route Fireworks embedding models directly (bypass LiteLLM)
    if (isFireworksEmbeddingModel(model)) {
      const fwClient = await getFireworksClient();
      const fwModel = getFireworksEmbeddingModelId(model);
      const response = await fwClient.embeddings.create({ model: fwModel, input: text });
      await recordEmbeddingUsage({
        providerId: 'fireworks',
        model,
        totalTokens: response.usage?.total_tokens ?? Math.ceil(text.length / 4),
        inputTokens: response.usage?.total_tokens ?? Math.ceil(text.length / 4),
        outputTokens: 0,
      });
      return response.data[0].embedding;
    }

    // Route Mistral embedding models directly (bypass LiteLLM)
    if (isMistralEmbeddingModel(model)) {
      const vector = await createMistralEmbedding(text);
      await recordEmbeddingUsage({
        providerId: 'mistral',
        model,
        totalTokens: Math.ceil(text.length / 4),
        inputTokens: Math.ceil(text.length / 4),
        outputTokens: 0,
      });
      return vector;
    }

    // Route Gemini embedding models directly (bypass LiteLLM)
    if (isGeminiEmbeddingModel(model)) {
      const vector = await createGeminiEmbedding(text);
      await recordEmbeddingUsage({
        providerId: 'gemini',
        model,
        totalTokens: Math.ceil(text.length / 4),
        inputTokens: Math.ceil(text.length / 4),
        outputTokens: 0,
      });
      return vector;
    }

    // Route OpenAI embedding models directly (bypass LiteLLM)
    if (isOpenAIEmbeddingModel(model)) {
      const vector = await createOpenAIEmbedding(text, model);
      await recordEmbeddingUsage({
        providerId: 'openai',
        model,
        totalTokens: Math.ceil(text.length / 4),
        inputTokens: Math.ceil(text.length / 4),
        outputTokens: 0,
      });
      return vector;
    }

    throw new Error(`Unsupported embedding model: ${model}. No direct provider route matched.`);
  } catch (error) {
    // If primary model fails and fallback is different, try fallback
    if (fallbackModel && fallbackModel !== model) {
      console.warn(`[Embedding] Primary model ${model} failed, falling back to ${fallbackModel}:`, error);

      // Record the fallback event for UI notification
      recordFallbackEvent(model, fallbackModel, error instanceof Error ? error : String(error));

      // Reset local embedder if switching from local to different model
      if (isLocalEmbeddingModel(model)) {
        resetLocalEmbedder();
      }

      // Try fallback model
      if (isLocalEmbeddingModel(fallbackModel)) {
        return await createLocalEmbedding(text, fallbackModel as LocalEmbeddingModel);
      }

      // Route Fireworks fallback models directly
      if (isFireworksEmbeddingModel(fallbackModel)) {
        const fwClient = await getFireworksClient();
        const fwModel = getFireworksEmbeddingModelId(fallbackModel);
        const response = await fwClient.embeddings.create({ model: fwModel, input: text });
        return response.data[0].embedding;
      }

      // Route Mistral fallback models directly
      if (isMistralEmbeddingModel(fallbackModel)) {
        return await createMistralEmbedding(text);
      }

      // Route Gemini fallback models directly
      if (isGeminiEmbeddingModel(fallbackModel)) {
        return await createGeminiEmbedding(text);
      }

      // Route OpenAI fallback models directly
      if (isOpenAIEmbeddingModel(fallbackModel)) {
        return await createOpenAIEmbedding(text, fallbackModel);
      }

      throw new Error(`Unsupported embedding fallback model: ${fallbackModel}. No direct provider route matched.`);
    }

    // No fallback or fallback is same as primary - rethrow
    throw error;
  }
}

export async function createEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const embeddingSettings = await getEmbeddingSettings();
  // Use database config, fall back to env var for backward compatibility
  const model = embeddingSettings.model || process.env.EMBEDDING_MODEL || 'text-embedding-3-large';
  const fallbackModel = embeddingSettings.fallbackModel || 'text-embedding-3-large';

  try {
    // Route to local embeddings if local model
    if (isLocalEmbeddingModel(model)) {
      console.log(`[Embedding] Using LOCAL model: ${model}`);
      const embeddings = await createLocalEmbeddings(texts, model as LocalEmbeddingModel);
      if (embeddings.length > 0) {
        console.log(`[Embedding] Local model dimensions: ${embeddings[0].length}`);
      }
      return embeddings;
    }

    // Route Fireworks embedding models directly (bypass LiteLLM)
    if (isFireworksEmbeddingModel(model)) {
      const fwClient = await getFireworksClient();
      const fwModel = getFireworksEmbeddingModelId(model);
      const response = await fwClient.embeddings.create({ model: fwModel, input: texts });
      const embeddings = response.data.map(d => d.embedding);
      await recordEmbeddingUsage({
        providerId: 'fireworks',
        model,
        totalTokens: response.usage?.total_tokens ?? texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
        inputTokens: response.usage?.total_tokens ?? texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
        outputTokens: 0,
      });
      if (embeddings.length > 0) {
        console.log(`[Embedding] Fireworks direct — Model: ${fwModel}, Dimensions: ${embeddings[0].length}, Count: ${embeddings.length}`);
      }
      return embeddings;
    }

    // Route Mistral embedding models directly (bypass LiteLLM)
    if (isMistralEmbeddingModel(model)) {
      const vectors = await createMistralEmbeddings(texts);
      await recordEmbeddingUsage({
        providerId: 'mistral',
        model,
        totalTokens: texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
        inputTokens: texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
        outputTokens: 0,
      });
      if (vectors.length > 0) {
        console.log(`[Embedding] Mistral direct — Model: ${model}, Dimensions: ${vectors[0].length}, Count: ${vectors.length}`);
      }
      return vectors;
    }

    // Route Gemini embedding models directly (bypass LiteLLM)
    if (isGeminiEmbeddingModel(model)) {
      const vectors = await createGeminiEmbeddings(texts);
      await recordEmbeddingUsage({
        providerId: 'gemini',
        model,
        totalTokens: texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
        inputTokens: texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
        outputTokens: 0,
      });
      if (vectors.length > 0) {
        console.log(`[Embedding] Gemini direct — Model: ${model}, Dimensions: ${vectors[0].length}, Count: ${vectors.length}`);
      }
      return vectors;
    }

    // Route OpenAI embedding models directly (bypass LiteLLM)
    if (isOpenAIEmbeddingModel(model)) {
      const vectors = await createOpenAIEmbeddings(texts, model);
      await recordEmbeddingUsage({
        providerId: 'openai',
        model,
        totalTokens: texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
        inputTokens: texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
        outputTokens: 0,
      });
      if (vectors.length > 0) {
        console.log(`[Embedding] OpenAI direct — Model: ${model}, Dimensions: ${vectors[0].length}, Count: ${vectors.length}`);
      }
      return vectors;
    }

    throw new Error(`Unsupported embedding model: ${model}. No direct provider route matched.`);
  } catch (error) {
    // If primary model fails and fallback is different, try fallback
    if (fallbackModel && fallbackModel !== model) {
      console.warn(`[Embedding] Primary model ${model} failed for batch, falling back to ${fallbackModel}:`, error);

      // Record the fallback event for UI notification
      recordFallbackEvent(model, fallbackModel, error instanceof Error ? error : String(error));

      // Reset local embedder if switching from local to different model
      if (isLocalEmbeddingModel(model)) {
        resetLocalEmbedder();
      }

      // Try fallback model
      if (isLocalEmbeddingModel(fallbackModel)) {
        return await createLocalEmbeddings(texts, fallbackModel as LocalEmbeddingModel);
      }

      // Route Fireworks fallback models directly
      if (isFireworksEmbeddingModel(fallbackModel)) {
        const fwClient = await getFireworksClient();
        const fwModel = getFireworksEmbeddingModelId(fallbackModel);
        const response = await fwClient.embeddings.create({ model: fwModel, input: texts });
        return response.data.map(d => d.embedding);
      }

      // Route Mistral fallback models directly
      if (isMistralEmbeddingModel(fallbackModel)) {
        return await createMistralEmbeddings(texts);
      }

      // Route Gemini fallback models directly
      if (isGeminiEmbeddingModel(fallbackModel)) {
        return await createGeminiEmbeddings(texts);
      }

      // Route OpenAI fallback models directly
      if (isOpenAIEmbeddingModel(fallbackModel)) {
        return await createOpenAIEmbeddings(texts, fallbackModel);
      }

      throw new Error(`Unsupported embedding fallback model: ${fallbackModel}. No direct provider route matched.`);
    }

    // No fallback or fallback is same as primary - rethrow
    throw error;
  }
}

/**
 * Streams a single LLM completion, accumulating content tokens and tool call fragments.
 * Calls onChunk for each content token (only fires when the model produces text, not tool calls).
 * Returns the fully assembled { content, tool_calls } mirroring the non-streaming message shape.
 */
// Streaming timeouts — generous to accommodate Ollama model loading
const FIRST_CHUNK_TIMEOUT_MS = 120_000;        // 2 min: cloud models
const FIRST_CHUNK_TIMEOUT_OLLAMA_MS = 180_000; // 3 min: Ollama (CPU cold-start)
// Inter-chunk timeout now loaded from DB via getStreamingConfigMs() (default 120s)

// Ollama per-request context window — overrides server-level OLLAMA_CONTEXT_LENGTH.
// Default 16384 balances capacity with memory on 4GB+ systems.
const OLLAMA_NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || '16384', 10);

// Tools safe for Ollama: no external API keys required, generate output locally
const OLLAMA_ALLOWED_TOOLS = new Set([
  'web_search',    // Tavily (already allowed)
  'doc_gen',       // Local PDF/Word generation via pdfkit/docx
  'html_gen',      // Local HTML generation
  'file_to_html',  // Local DOCX/PDF to HTML conversion
  'diagram_gen',   // Mermaid syntax, rendered client-side
  'xlsx_gen',      // Local Excel generation via ExcelJS
  'chart_gen',     // Chart config, rendered in frontend
  'pptx_gen',      // Local PowerPoint generation via pptx lib
]);

// ============ Think-tag parsing ============

/** Returns how many trailing chars of `s` could be the beginning of `tag` */
function findPartialSuffix(s: string, tag: string): number {
  for (let len = Math.min(tag.length - 1, s.length); len > 0; len--) {
    if (tag.startsWith(s.slice(-len))) return len;
  }
  return 0;
}

/**
 * Statefully splits a raw LLM chunk into visible content and thinking content.
 * Handles <think>…</think> blocks that may span chunk boundaries.
 * Mutates `state` in place to carry context across calls.
 */
function parseThinkChunk(
  raw: string,
  state: { inThink: boolean; tagBuf: string },
): { visible: string; thinking: string } {
  let input = state.tagBuf + raw;
  state.tagBuf = '';
  let visible = '';
  let thinking = '';

  while (input.length > 0) {
    const tag = state.inThink ? '</think>' : '<think>';
    const idx = input.indexOf(tag);
    const partial = findPartialSuffix(input, tag);

    if (idx !== -1) {
      const before = input.slice(0, idx);
      state.inThink ? (thinking += before) : (visible += before);
      input = input.slice(idx + tag.length);
      state.inThink = !state.inThink;
      // Skip optional leading newline after </think>
      if (!state.inThink && input.startsWith('\n')) input = input.slice(1);
    } else if (partial > 0) {
      const safe = input.slice(0, input.length - partial);
      state.inThink ? (thinking += safe) : (visible += safe);
      state.tagBuf = input.slice(-partial);
      break;
    } else {
      state.inThink ? (thinking += input) : (visible += input);
      break;
    }
  }

  return { visible, thinking };
}

// ============ Anthropic Helpers ============

/**
 * Convert OpenAI tool definitions to Anthropic format.
 * OpenAI: { type: 'function', function: { name, description, parameters } }
 * Anthropic: { name, description, input_schema }
 */
function convertToolsToAnthropic(
  tools: OpenAI.Chat.ChatCompletionTool[] | undefined,
): Anthropic.Tool[] | undefined {
  if (!tools?.length) return undefined;
  return tools
    .filter((t): t is OpenAI.Chat.ChatCompletionTool & { type: 'function'; function: { name: string; description?: string; parameters?: Record<string, unknown> } } =>
      'function' in t && t.type === 'function')
    .map(t => ({
      name: t.function.name,
      description: t.function.description || '',
      input_schema: (t.function.parameters || { type: 'object', properties: {} }) as Anthropic.Tool.InputSchema,
    }));
}

/**
 * Convert OpenAI tool_choice to Anthropic format.
 * OpenAI 'auto' → Anthropic { type: 'auto' }
 * OpenAI 'required' → Anthropic { type: 'any' }
 * OpenAI { type: 'function', function: { name } } → Anthropic { type: 'tool', name }
 * OpenAI 'none' → omit tool_choice (no equivalent — just don't send tools)
 */
function convertToolChoiceToAnthropic(
  choice: 'auto' | 'required' | 'none' | { type: 'function'; function: { name: string } } | undefined,
): Anthropic.ToolChoice | undefined {
  if (!choice || choice === 'auto') return { type: 'auto' };
  if (choice === 'required') return { type: 'any' };
  if (choice === 'none') return undefined;
  if (typeof choice === 'object' && choice.type === 'function') {
    return { type: 'tool', name: choice.function.name };
  }
  return { type: 'auto' };
}

/**
 * Build Anthropic message history from conversation context.
 * Converts OpenAI-shaped history messages to Anthropic MessageParam format.
 * Tool-related messages (role: 'tool', assistant with tool_calls) are skipped
 * since they reference prior tool call IDs that don't exist in the new session.
 */
function buildAnthropicHistory(
  historyMessages: Array<{ role: string; content: string; tool_calls?: unknown; tool_call_id?: string }>,
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  for (const msg of historyMessages) {
    // Skip tool-related history — tool_call_ids from prior sessions are invalid
    if (msg.role === 'tool') continue;
    if (msg.role === 'assistant' && msg.tool_calls) continue;

    if (msg.role === 'user' || msg.role === 'assistant') {
      result.push({ role: msg.role, content: msg.content });
    }
  }
  return result;
}

// ============ Anthropic Streaming ============

/**
 * Stream a completion from the Anthropic API directly (bypassing LiteLLM).
 * Returns the same shape as streamOneCompletion() so the tool loop can consume it uniformly.
 *
 * Anthropic's standard streaming guarantees valid JSON for tool inputs when
 * stop_reason is 'tool_use' or 'end_turn' (server-side buffers + validates).
 */
async function streamAnthropicCompletion(
  client: Anthropic,
  params: {
    model: string;
    messages: Anthropic.MessageParam[];
    system?: string;
    max_tokens: number;
    temperature?: number;
    tools?: Anthropic.Tool[];
    tool_choice?: Anthropic.ToolChoice;
    thinking?: Anthropic.ThinkingConfigParam;
    output_config?: Anthropic.OutputConfig;
  },
  onChunk?: (text: string) => void,
  onThinkingChunk?: (text: string) => void,
  interChunkTimeoutMsOverride?: number,
  firstChunkTimeoutMsOverride?: number,
): Promise<{ content: string | null; tool_calls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] | undefined; thinkingContent: string | null; stopReason: string | null; totalTokens: number }> {
  const controller = new AbortController();
  let wasAborted = false;

  const streamingConfig = await getStreamingConfigMs();
  const interChunkTimeoutMs = interChunkTimeoutMsOverride ?? streamingConfig.TOOL_TIMEOUT_MS;

  const firstChunkTimeoutMs = firstChunkTimeoutMsOverride ?? FIRST_CHUNK_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    logger.warn('Anthropic streaming timed out waiting for first chunk', { model: params.model });
    wasAborted = true;
    controller.abort();
  }, firstChunkTimeoutMs);

  const resetTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      logger.warn('Anthropic streaming timed out between chunks', { model: params.model });
      wasAborted = true;
      controller.abort();
    }, interChunkTimeoutMs);
  };

  let content = '';
  let thinkingContent = '';
  const toolCalls: { id: string; name: string; input: unknown }[] = [];
  let stopReason: string | null = null;
  let anthropicUsage: { input_tokens?: number; output_tokens?: number } = {};
  let refusalDetails: { type?: string; category?: string; explanation?: string } | undefined;

  // Track current tool_use input accumulation for manual assembly
  const toolInputBuffers = new Map<number, { id: string; name: string; json: string }>();

  try {
    const createParams: Anthropic.MessageCreateParamsStreaming = {
      model: params.model,
      messages: params.messages,
      max_tokens: params.max_tokens,
      stream: true,
      ...(params.system ? { system: params.system } : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params.tools?.length ? { tools: params.tools } : {}),
      ...(params.tool_choice ? { tool_choice: params.tool_choice } : {}),
      ...(params.thinking ? { thinking: params.thinking } : {}),
      ...(params.output_config ? { output_config: params.output_config } : {}),
    };

    const stream = client.messages.stream(createParams, { signal: controller.signal });

    // Use SDK event handlers for clean accumulation
    stream.on('text', (text) => {
      resetTimeout();
      content += text;
      onChunk?.(text);
    });

    stream.on('inputJson', (_partialJson, _snapshot) => {
      // Just reset the timeout — actual tool input is captured from finalMessage
      resetTimeout();
    });

    // Defensively capture raw refusal metadata if Anthropic sends it in the
    // message_delta event. The installed SDK (0.80.0) does not type or persist
    // stop_details on the final message, so we capture it from the raw event.
    stream.on('streamEvent', (event) => {
      if (event.type === 'message_delta') {
        const rawEvent = event as unknown as Record<string, unknown>;
        const delta = rawEvent.delta as Record<string, unknown> | undefined;
        if (delta && typeof delta.stop_details === 'object' && delta.stop_details !== null) {
          const details = delta.stop_details as Record<string, string>;
          refusalDetails = {
            type: details.type,
            category: details.category,
            explanation: details.explanation,
          };
        }
      }
    });

    // Wait for the full message
    const message = await stream.finalMessage();

    if (wasAborted) {
      throw new Error(
        `Anthropic streaming timeout (model: ${params.model}). ` +
        `The model may be unresponsive or unable to handle the requested tool_choice.`
      );
    }

    stopReason = message.stop_reason;
    anthropicUsage = message.usage || {};

    // Fable 5 returns stop_reason: 'refusal' for classifier-blocked prompts.
    // Surface a helpful message instead of silently returning empty content.
    const fableRefusal =
      stopReason === 'refusal' &&
      (params.model === 'claude-fable-5' || params.model.startsWith('claude-fable-5-'));
    if (fableRefusal) {
      const refusalMessage =
        'Claude Fable 5 refused this request due to its safety guardrails. Try a different model or rephrase your prompt.';
      content = refusalMessage;
      onChunk?.(refusalMessage);

      logger.warn('Claude Fable 5 refusal detected', {
        model: params.model,
        stopReason,
        refusalCategory: refusalDetails?.category,
        refusalExplanation: refusalDetails?.explanation,
      });
    }

    // Extract content blocks from the final message
    for (const block of message.content) {
      if (block.type === 'thinking') {
        thinkingContent += block.thinking;
        onThinkingChunk?.(block.thinking);
      } else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
      }
      // 'text' blocks are already captured by the stream.on('text') handler
    }

  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'APIUserAbortError' || error.message.includes('aborted'))) {
      throw new Error(
        `Anthropic streaming timeout (model: ${params.model}). ` +
        `The model may be unresponsive or unable to handle the requested tool_choice.`
      );
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  console.log(`[Anthropic] Stream complete — stop_reason: ${stopReason}, tool_calls: ${toolCalls.length}, model: ${params.model}`);

  // Convert Anthropic tool_use blocks to OpenAI-compatible shape
  // so the existing tool execution loop in generateResponseWithTools() works unchanged.
  const openaiToolCalls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] | undefined =
    toolCalls.length > 0
      ? toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        }))
      : undefined;

  // Extract token usage from finalMessage
  const anthropicTokens = (anthropicUsage.input_tokens ?? 0) + (anthropicUsage.output_tokens ?? 0);

  return { content: content || null, tool_calls: openaiToolCalls, thinkingContent: thinkingContent || null, stopReason, totalTokens: anthropicTokens };
}

// ============ OpenAI Streaming ============

async function streamOneCompletion(
  openai: OpenAI,
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, 'stream'>,
  onChunk?: (text: string) => void,
  onThinkingChunk?: (text: string) => void,
  interChunkTimeoutMsOverride?: number,
  firstChunkTimeoutMsOverride?: number,
): Promise<{ content: string | null; tool_calls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] | undefined; thinkingContent: string | null; totalTokens: number }> {
  const controller = new AbortController();
  // OpenAI SDK v6+ silently swallows AbortError in its stream iterator
  // (returns instead of throwing), so we track abort state explicitly
  let wasAborted = false;

  // Use DB-configurable inter-chunk timeout (default 120s, was hardcoded 60s)
  // Callers (e.g. subagent) may override for longer-running unattended tasks.
  const streamingConfig = await getStreamingConfigMs();
  const interChunkTimeoutMs = interChunkTimeoutMsOverride ?? streamingConfig.TOOL_TIMEOUT_MS;

  // Ollama models get a longer first-chunk timeout for CPU cold-start
  const isOllama = params.model?.startsWith('ollama-') || params.model?.startsWith('ollama/');
  const baseFirstChunkTimeout = isOllama ? FIRST_CHUNK_TIMEOUT_OLLAMA_MS : FIRST_CHUNK_TIMEOUT_MS;
  const firstChunkTimeout = firstChunkTimeoutMsOverride ?? baseFirstChunkTimeout;

  // Start with first-chunk timeout; reset to inter-chunk on each received chunk
  let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    logger.warn('LLM streaming timed out waiting for first chunk', { model: params.model });
    wasAborted = true;
    controller.abort();
  }, firstChunkTimeout);

  const resetTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      logger.warn('LLM streaming timed out between chunks', { model: params.model });
      wasAborted = true;
      controller.abort();
    }, interChunkTimeoutMs);
  };

  let content = '';
  let thinkingContent = '';
  let streamTotalTokens = 0;
  const thinkState = { inThink: false, tagBuf: '' };
  const thinkModel = isThinkTagModel(params.model ?? '');
  const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();

  try {
    const stream = await openai.chat.completions.create(
      { ...params, stream: true, stream_options: { include_usage: true } },
      { signal: controller.signal },
    );

    for await (const chunk of stream) {
      resetTimeout();

      // Capture usage from final chunk (sent when include_usage is true)
      if (chunk.usage) {
        streamTotalTokens = chunk.usage.total_tokens;
      }

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      const reasoningDelta = (delta as typeof delta & { reasoning_content?: string; reasoning?: string; thinking?: string }).reasoning_content
        || (delta as typeof delta & { reasoning_content?: string; reasoning?: string; thinking?: string }).reasoning
        || (delta as typeof delta & { reasoning_content?: string; reasoning?: string; thinking?: string }).thinking;
      if (reasoningDelta) {
        thinkingContent += reasoningDelta;
        onThinkingChunk?.(reasoningDelta);
      }

      if (delta.content) {
        if (thinkModel) {
          const { visible, thinking } = parseThinkChunk(delta.content, thinkState);
          if (thinking) { thinkingContent += thinking; onThinkingChunk?.(thinking); }
          if (visible)  { content += visible;           onChunk?.(visible); }
        } else {
          content += delta.content;
          onChunk?.(delta.content);
        }
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallMap.has(idx)) {
            toolCallMap.set(idx, { id: '', name: '', arguments: '' });
          }
          const acc = toolCallMap.get(idx)!;
          // id and name arrive complete in the first chunk for each tool call
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          // arguments arrive as partial JSON fragments — concatenate
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }
    }

    // SDK v6+ swallows AbortError (returns instead of throwing) — detect via flag
    // Without this check, incomplete tool arguments are silently returned,
    // causing JSON parse failures and infinite retry loops
    if (wasAborted) {
      throw new Error(
        `LLM streaming timeout (model: ${params.model}). ` +
        `The model may be unresponsive or unable to handle the requested tool_choice.`
      );
    }
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'APIUserAbortError')) {
      throw new Error(
        `LLM streaming timeout (model: ${params.model}). ` +
        `The model may be unresponsive or unable to handle the requested tool_choice.`
      );
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  const tool_calls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] | undefined =
    toolCallMap.size > 0
      ? [...toolCallMap.values()].map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }))
      : undefined;

  return { content: content || null, tool_calls, thinkingContent: thinkingContent || null, totalTokens: streamTotalTokens };
}

type StreamCompletionResult = Awaited<ReturnType<typeof streamOneCompletion>>;

async function streamOneCompletionWithThinkingRetry(
  openai: OpenAI,
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, 'stream'>,
  thinkingProfile: ThinkingRequestProfile,
  onChunk?: (text: string) => void,
  onThinkingChunk?: (text: string) => void,
  interChunkTimeoutMsOverride?: number,
  firstChunkTimeoutMsOverride?: number,
): Promise<StreamCompletionResult> {
  try {
    return await streamOneCompletion(openai, params, onChunk, onThinkingChunk, interChunkTimeoutMsOverride, firstChunkTimeoutMsOverride);
  } catch (error) {
    if (Object.keys(thinkingProfile.requestParams).length > 0 && isUnsupportedThinkingParamError(error)) {
      logger.warn('Retrying LLM request without thinking parameters', {
        model: params.model,
        error: error instanceof Error ? error.message : String(error),
      });
      const plainParams = stripThinkingRequestParams(params as unknown as Record<string, unknown>);
      return streamOneCompletion(
        openai,
        plainParams as Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, 'stream'>,
        onChunk,
        onThinkingChunk,
        interChunkTimeoutMsOverride,
      );
    }
    const currentTemp = params.temperature;
    if (isTemperatureParamError(error) && currentTemp != null) {
      const safeTemperature = getTemperatureForModel(params.model, currentTemp);
      if (safeTemperature !== params.temperature || safeTemperature === undefined) {
        logger.warn('Retrying LLM request with temperature correction', {
          model: params.model,
          original: params.temperature,
          corrected: safeTemperature,
          error: error instanceof Error ? error.message : String(error),
        });
        const correctedParams = { ...params, temperature: safeTemperature };
        if (safeTemperature === undefined) {
          delete (correctedParams as Record<string, unknown>).temperature;
        }
        return streamOneCompletion(
          openai,
          correctedParams as Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, 'stream'>,
          onChunk,
          onThinkingChunk,
          interChunkTimeoutMsOverride,
        );
      } else {
        // Temperature correction produced no change — the model is likely
        // temperature-locked but not yet recognized by isTemperatureLockedModel.
        // Log so the gap can be fixed in llm-thinking.ts.
        logger.warn('Temperature param error but getTemperatureForModel returned same value — possible gap in isTemperatureLockedModel', {
          model: params.model,
          temperature: currentTemp,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    throw error;
  }
}

// ============ Tool Completion Helpers (for subagent / autonomous loops) ============

/**
 * Convert OpenAI-shaped message history to Anthropic MessageParam format.
 * Preserves tool calls and tool results within the current session.
 * Batches consecutive tool messages into a single Anthropic user message.
 */
function convertOpenAIMessagesToAnthropic(
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
): { system?: string; anthropicMessages: Anthropic.MessageParam[] } {
  let system: string | undefined;
  const anthropicMessages: Anthropic.MessageParam[] = [];
  let i = 0;

  // Extract leading system messages ( Anthropic passes system separately )
  while (i < messages.length && messages[i].role === 'system') {
    const sysMsg = messages[i] as OpenAI.Chat.ChatCompletionSystemMessageParam;
    const sysContent = typeof sysMsg.content === 'string' ? sysMsg.content : JSON.stringify(sysMsg.content);
    system = system ? `${system}\n\n${sysContent}` : sysContent;
    i++;
  }

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === 'user') {
      const userMsg = msg as OpenAI.Chat.ChatCompletionUserMessageParam;
      const content = typeof userMsg.content === 'string' ? userMsg.content : JSON.stringify(userMsg.content);
      anthropicMessages.push({ role: 'user', content });
      i++;
    } else if (msg.role === 'assistant') {
      const assistantMsg = msg as OpenAI.Chat.ChatCompletionAssistantMessageParam;
      const contentBlocks: Anthropic.ContentBlockParam[] = [];

      if (assistantMsg.content) {
        const text = typeof assistantMsg.content === 'string' ? assistantMsg.content : assistantMsg.content.map(c => (c.type === 'text' ? c.text : '')).join('');
        contentBlocks.push({ type: 'text', text });
      }

      if (assistantMsg.tool_calls) {
        for (const tc of assistantMsg.tool_calls) {
          if (tc.type === 'function') {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: (() => {
                try { return JSON.parse(tc.function.arguments || '{}'); }
                catch { return {}; }
              })(),
            });
          }
        }
      }

      anthropicMessages.push({ role: 'assistant', content: contentBlocks });
      i++;
    } else if (msg.role === 'tool') {
      // Batch consecutive tool messages into a single Anthropic user message
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      while (i < messages.length && messages[i].role === 'tool') {
        const toolMsg = messages[i] as OpenAI.Chat.ChatCompletionToolMessageParam;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolMsg.tool_call_id,
          content: typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content),
        });
        i++;
      }
      anthropicMessages.push({ role: 'user', content: toolResults });
    } else {
      i++;
    }
  }

  return { system, anthropicMessages };
}

function detectProviderForToolCompletion(modelId: string): ModelSpec['provider'] {
  if (isClaudeModel(modelId)) return 'anthropic';
  if (isFireworksModel(modelId)) return 'fireworks';
  if (isOllamaCloudModel(modelId)) return 'ollama-cloud';
  if (isOllamaModel(modelId)) return 'ollama';
  if (isMoonshotModel(modelId)) return 'moonshot';
  if (isDeepSeekModel(modelId)) return 'deepseek';
  if (modelId.startsWith('azure-foundry/')) return 'azure-foundry';
  if (modelId.startsWith('gemini')) return 'gemini';
  if (modelId.startsWith('mistral') || modelId.startsWith('codestral') || modelId.startsWith('pixtral')) return 'mistral';
  return 'openai';
}

/**
 * Inter-chunk stream timeout for subagent / autonomous tool completions.
 * Larger than the chat default (typically 120s) because autonomous loops
 * run unattended and may use slower/reasoning models that pause between
 * tokens longer than a user-facing chat would tolerate.
 */
const SUBAGENT_INTER_CHUNK_TIMEOUT_MS = 300_000;

/**
 * Generate a single tool-completion turn across all supported routes.
 * Normalizes responses to OpenAI-shaped tool_calls so callers don't need
 * to know which provider executed the request.
 */
export async function generateToolCompletion(
  modelSpec: ModelSpec,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  tools?: OpenAI.Chat.ChatCompletionTool[],
  toolChoice?: 'auto' | 'required' | { type: 'function'; function: { name: string } } | undefined,
  temperature?: number,
  maxTokens?: number,
  firstChunkTimeoutMsOverride?: number,
): Promise<{ content: string | null; tool_calls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] | undefined; tokens_used: number; thinkingContent?: string }> {
  const effectiveModel = modelSpec.model;
  const effectiveTemperature = getTemperatureForModel(effectiveModel, temperature ?? modelSpec.temperature);
  const effectiveMaxTokens = maxTokens ?? modelSpec.max_tokens ?? 4096;

  const useAnthropicDirect = isClaudeModel(effectiveModel);
  const useFireworksDirect = isFireworksModel(effectiveModel);
  const useOllamaDirect = isOllamaModel(effectiveModel);
  const useOllamaCloudDirect = isOllamaCloudModel(effectiveModel);
  const useMoonshotDirect = isMoonshotModel(effectiveModel);
  const useDeepSeekDirect = isDeepSeekModel(effectiveModel);
  const useAzureFoundryDirect = isAzureFoundryModel(effectiveModel);
  const useGeminiDirect = isGeminiModel(effectiveModel);
  const useOpenAIDirect = isOpenAIModel(effectiveModel);

  // Build thinking profile (subagent doesn't need thinking, but some models require param handling)
  const modelThinkingCapable = await isModelThinkingCapable(effectiveModel);
  const thinkingProfile = buildThinkingRequestProfile({
    modelId: effectiveModel,
    thinkingCapable: modelThinkingCapable,
    thinkingEnabled: modelSpec.thinking_enabled ?? false,
    maxTokens: effectiveMaxTokens,
    toolsEnabled: Boolean(tools?.length),
  });

  if (useAnthropicDirect) {
    const client = await getAnthropicClient();
    const { system, anthropicMessages } = convertOpenAIMessagesToAnthropic(messages);

    const result = await streamAnthropicCompletion(
      client,
      {
        model: getAnthropicModelId(effectiveModel),
        messages: anthropicMessages,
        system,
        max_tokens: effectiveMaxTokens,
        temperature: effectiveTemperature,
        tools: convertToolsToAnthropic(tools),
        tool_choice: tools?.length ? convertToolChoiceToAnthropic(toolChoice) : undefined,
        thinking: thinkingProfile.enabled ? (thinkingProfile.requestParams.thinking as Anthropic.ThinkingConfigParam) : undefined,
        output_config: thinkingProfile.requestParams.output_config as Anthropic.OutputConfig | undefined,
      },
      undefined, // onChunk
      undefined, // onThinkingChunk
      SUBAGENT_INTER_CHUNK_TIMEOUT_MS,
      firstChunkTimeoutMsOverride,
    );

    return {
      content: result.content,
      tool_calls: result.tool_calls,
      tokens_used: result.totalTokens,
      thinkingContent: result.thinkingContent ?? undefined,
    };
  }

  if (useOllamaCloudDirect) {
    const ollamaMessages = messages.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const result = await streamOllamaCloudCompletion(
      effectiveModel,
      ollamaMessages,
      {
        temperature: effectiveTemperature,
        maxTokens: effectiveMaxTokens,
      },
      undefined,
      undefined,
      SUBAGENT_INTER_CHUNK_TIMEOUT_MS,
      firstChunkTimeoutMsOverride,
    );

    return {
      content: result.content,
      tool_calls: result.tool_calls,
      tokens_used: result.totalTokens,
      thinkingContent: result.thinkingContent ?? undefined,
    };
  }

  if (useGeminiDirect) {
    const geminiMessages = messages.map(m => ({
      role: m.role as string,
      content: m.content,
    }));
    const geminiResult = await streamGeminiCompletion(
      effectiveModel,
      geminiMessages,
      {
        temperature: effectiveTemperature,
        maxTokens: effectiveMaxTokens,
        tools: tools as any,
        toolChoice: toolChoice as any,
        thinkingConfig: thinkingProfile.enabled
          ? { thinkingBudget: -1 }
          : undefined,
      },
    );
    return {
      content: geminiResult.content,
      tool_calls: geminiResult.tool_calls as any,
      tokens_used: geminiResult.totalTokens,
      thinkingContent: geminiResult.thinkingContent ?? undefined,
    };
  }

  if (useOpenAIDirect) {
    // OpenAI direct (Route 2) — use native OpenAI SDK streaming
    const openaiMessages = messages.map(m => ({
      role: m.role as string,
      content: m.content,
    }));
    const openaiResult = await streamOpenAICompletion(
      effectiveModel,
      openaiMessages,
      {
        temperature: effectiveTemperature,
        maxTokens: effectiveMaxTokens,
        tools: tools as any,
        toolChoice: toolChoice as any,
      },
    );
    return {
      content: openaiResult.content,
      tool_calls: openaiResult.tool_calls as any,
      tokens_used: openaiResult.totalTokens,
      thinkingContent: openaiResult.thinkingContent ?? undefined,
    };
  }

  // OpenAI-compatible routes: Fireworks (Route 5), Ollama local, Moonshot, DeepSeek, Azure Foundry (Route 5)
  // (OpenAI direct already handled above — returns early)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openai: any = useFireworksDirect ? await getFireworksClient()
    : useOllamaDirect ? await getOllamaClient()
    : useMoonshotDirect ? await getMoonshotClient()
    : useDeepSeekDirect ? await getDeepSeekClient()
    : useAzureFoundryDirect ? await getAzureFoundryClient()
    : (() => { throw new Error(`Unsupported model for chat: ${effectiveModel}. No direct provider route matched.`); })();

  const completionModel = useFireworksDirect ? getFireworksModelId(effectiveModel)
    : useOllamaDirect ? getOllamaModelId(effectiveModel)
    : useMoonshotDirect ? getMoonshotModelId(effectiveModel)
    : useDeepSeekDirect ? getDeepSeekModelId(effectiveModel)
    : useAzureFoundryDirect ? stripAzureFoundryPrefix(effectiveModel)
    : effectiveModel;

  const completionParams: Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, 'stream'> = {
    model: completionModel,
    messages,
    tools,
    tool_choice: tools?.length ? toolChoice : undefined,
    max_tokens: effectiveMaxTokens,
    temperature: effectiveTemperature,
    ...(useOllamaDirect && { num_ctx: OLLAMA_NUM_CTX }),
    ...thinkingProfile.requestParams,
  } as Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, 'stream'>;

  const result = await streamOneCompletionWithThinkingRetry(
    openai,
    completionParams,
    thinkingProfile,
    undefined,
    undefined,
    SUBAGENT_INTER_CHUNK_TIMEOUT_MS,
    firstChunkTimeoutMsOverride,
  );

  return {
    content: result.content,
    tool_calls: result.tool_calls,
    tokens_used: result.totalTokens,
    thinkingContent: result.thinkingContent ?? undefined,
  };
}

/**
 * Generate tool completion with automatic fallback on recoverable errors.
 * Tries the requested model, then the global default, then the universal fallback.
 * Preserves the conversation state (messages[]) across fallback attempts.
 */
export async function generateToolCompletionWithFallback(
  modelSpec: ModelSpec,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  tools?: OpenAI.Chat.ChatCompletionTool[],
  toolChoice?: 'auto' | 'required' | { type: 'function'; function: { name: string } } | undefined,
  temperature?: number,
  maxTokens?: number,
  firstChunkTimeoutMsOverride?: number,
): Promise<{ content: string | null; tool_calls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] | undefined; tokens_used: number; model_used: string; thinkingContent?: string }> {
  const { isRecoverableApiError, markModelUnhealthy } = await import('./llm-fallback');

  const attemptModel = async (spec: ModelSpec): Promise<{ content: string | null; tool_calls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] | undefined; tokens_used: number; model_used: string; thinkingContent?: string }> => {
    const result = await generateToolCompletion(spec, messages, tools, toolChoice, temperature, maxTokens, firstChunkTimeoutMsOverride);
    return { ...result, model_used: spec.model };
  };

  try {
    return await attemptModel(modelSpec);
  } catch (error) {
    const reason = isRecoverableApiError(error as Error);
    if (!reason) throw error;

    console.warn(`[ToolCompletion] ${modelSpec.model} failed (${reason}), trying fallback chain...`);
    await markModelUnhealthy(modelSpec.model);

    const { getDefaultLLMModel } = await import('./config-loader');
    const { getLlmFallbackSettings } = await import('./db/compat/config');

    const globalDefault = getDefaultLLMModel();
    const fallbackSettings = await getLlmFallbackSettings();
    const maxRetryAttempts = Math.max(1, Math.min(3, Number(fallbackSettings.maxRetryAttempts || 2)));
    const universalFallback = fallbackSettings.universalFallback;

    const fallbackChain: string[] = [];
    if (globalDefault && globalDefault !== modelSpec.model) {
      fallbackChain.push(globalDefault);
    }
    if (universalFallback && universalFallback !== modelSpec.model && universalFallback !== globalDefault) {
      fallbackChain.push(universalFallback);
    }
    const allowedFallbacks = fallbackChain.slice(0, Math.max(0, maxRetryAttempts - 1));

    for (const fallbackModelId of allowedFallbacks) {
      try {
        const fallbackSpec: ModelSpec = {
          model: fallbackModelId,
          provider: detectProviderForToolCompletion(fallbackModelId),
          temperature: getTemperatureForModel(fallbackModelId, modelSpec.temperature),
          max_tokens: modelSpec.max_tokens,
        };
        console.log(`[ToolCompletion] Falling back to ${fallbackModelId}`);
        return await attemptModel(fallbackSpec);
      } catch (fallbackError) {
        const fallbackReason = isRecoverableApiError(fallbackError as Error);
        if (fallbackReason) {
          console.warn(`[ToolCompletion] ${fallbackModelId} also failed (${fallbackReason})`);
          await markModelUnhealthy(fallbackModelId);
          continue;
        }
        throw fallbackError;
      }
    }

    throw error;
  }
}

// ============ Ollama Cloud Streaming ============

/**
 * Stream a completion from the Ollama Cloud native API (bypassing LiteLLM).
 * Uses the native /api/chat endpoint with Bearer auth.
 * Returns the same shape as streamOneCompletion() so the tool loop can consume it uniformly.
 *
 * Note: Ollama Cloud uses native API format, not OpenAI-compatible.
 * Tool calls are not supported via the native API — only text completions.
 */
async function streamOllamaCloudCompletion(
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    think?: boolean;
  },
  onChunk?: (text: string) => void,
  onThinkingChunk?: (text: string) => void,
  interChunkTimeoutMsOverride?: number,
  firstChunkTimeoutMsOverride?: number,
): Promise<{ content: string | null; tool_calls: undefined; thinkingContent: string | null; totalTokens: number }> {
  const controller = new AbortController();
  let wasAborted = false;

  const streamingConfig = await getStreamingConfigMs();
  const interChunkTimeoutMs = interChunkTimeoutMsOverride ?? streamingConfig.TOOL_TIMEOUT_MS;

  const firstChunkTimeoutMs = firstChunkTimeoutMsOverride ?? FIRST_CHUNK_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    logger.warn('Ollama Cloud streaming timed out waiting for first chunk', { model });
    wasAborted = true;
    controller.abort();
  }, firstChunkTimeoutMs);

  const resetTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      logger.warn('Ollama Cloud streaming timed out between chunks', { model });
      wasAborted = true;
      controller.abort();
    }, interChunkTimeoutMs);
  };

  let content = '';
  let thinkingContent = '';
  let totalTokens = 0;

  try {
    const response = await callOllamaCloud(model, messages, {
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      think: options?.think,
      stream: true,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama Cloud API error: ${response.status} ${response.statusText} — ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Ollama Cloud response has no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      resetTimeout();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('{')) continue;

        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.done) {
            // Final message with stats
            totalTokens = (parsed.prompt_eval_count || 0) + (parsed.eval_count || 0);
          }
          if (parsed.message?.content) {
            content += parsed.message.content;
            onChunk?.(parsed.message.content);
          }
          if (parsed.message?.thinking) {
            thinkingContent += parsed.message.thinking;
            onThinkingChunk?.(parsed.message.thinking);
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    if (wasAborted) {
      throw new Error(
        `Ollama Cloud streaming timeout (model: ${model}). ` +
        `The model may be unresponsive.`
      );
    }
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))) {
      throw new Error(
        `Ollama Cloud streaming timeout (model: ${model}). ` +
        `The model may be unresponsive.`
      );
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  return { content: content || null, tool_calls: undefined, thinkingContent: thinkingContent || null, totalTokens };
}

export async function generateResponseWithTools(
  systemPrompt: string,
  conversationHistory: Message[],
  context: string,
  userMessage: string,
  enableTools: boolean = true,
  categoryIds?: number[],
  callbacks?: StreamingCallbacks,
  images?: ImageContent[],
  summaryContext?: string,
  memoryContext?: string,
  categorySlugs?: string[],
  excludeTools?: string[],
  imageCapabilities?: ImageCapabilities,
  modelOverride?: string,  // Optional model ID to override the default
  enableClarification?: boolean,  // Inject request_clarification meta-tool when preflight skill is active
  userId?: string,   // For cache isolation — prevents cross-user cache collisions
  threadId?: string,  // For cache isolation — prevents cross-thread cache collisions
  thinkingEnabled: boolean = false,
  styleContext?: string  // Resolved response style for cache-key isolation
): Promise<{
  content: string;
  toolCalls?: ToolCall[];
  fullHistory: OpenAI.Chat.ChatCompletionMessageParam[];
  cacheKey: string;
  cacheable: boolean;
  toolExecutionResults: ToolExecutionRecord[];
  totalTokens: number;
}> {
  const llmSettings = await getLlmSettings();

  // Use model override if provided, otherwise use default from settings
  const effectiveModel = modelOverride || llmSettings.model;
  const effectiveTemperature = getTemperatureForModel(effectiveModel, llmSettings.temperature);

  // Detect direct-route models — bypass LiteLLM
  const useAnthropicDirect = isClaudeModel(effectiveModel);
  const useFireworksDirect = isFireworksModel(effectiveModel);
  const useOllamaDirect = isOllamaModel(effectiveModel);
  const useOllamaCloudDirect = isOllamaCloudModel(effectiveModel);
  const useMoonshotDirect = isMoonshotModel(effectiveModel);
  const useDeepSeekDirect = isDeepSeekModel(effectiveModel);
  const useAzureFoundryDirect = isAzureFoundryModel(effectiveModel);
  const useMistralDirect = isMistralModel(effectiveModel);
  const useGeminiDirect = isGeminiModel(effectiveModel);
  const useOpenAIDirect = isOpenAIModel(effectiveModel);
  const routeLabel = useAnthropicDirect ? 'Anthropic SDK directly'
    : useFireworksDirect ? 'Fireworks AI directly'
    : useOllamaDirect ? 'Ollama directly'
    : useOllamaCloudDirect ? 'Ollama Cloud directly'
    : useMoonshotDirect ? 'Moonshot AI directly'
    : useDeepSeekDirect ? 'DeepSeek API directly'
    : useAzureFoundryDirect ? 'Azure AI Foundry (Route 5)'
    : useMistralDirect ? 'Mistral AI directly (Route 2)'
    : useGeminiDirect ? 'Gemini directly (Route 2)'
    : 'OpenAI directly (Route 2)';
  console.log(`[Chat] Using ${routeLabel} for model: ${effectiveModel}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openai: any = useAnthropicDirect ? null
    : useFireworksDirect ? await getFireworksClient()
    : useOllamaDirect ? await getOllamaClient()
    : useMoonshotDirect ? await getMoonshotClient()
    : useDeepSeekDirect ? await getDeepSeekClient()
    : useOllamaCloudDirect ? null // Ollama Cloud uses native API, not OpenAI SDK
    : useAzureFoundryDirect ? await getAzureFoundryClient()
    : useMistralDirect ? null // Mistral uses native SDK, not OpenAI SDK
    : useGeminiDirect ? null // Gemini uses native @google/genai SDK, not OpenAI SDK
    : useOpenAIDirect ? await getOpenAIDirectClient() // OpenAI direct (Route 2)
    : (() => { throw new Error(`Unsupported model for chat: ${effectiveModel}. No direct provider route matched.`); })();
  const anthropicClient = useAnthropicDirect ? await getAnthropicClient() : null;

  // Check if model supports tools, disable gracefully if not
  // Use DB-aware check so models added via admin UI (enabled_models) are recognized
  const modelSupportsTools = await isToolCapableModelFromDb(effectiveModel);
  const effectiveEnableTools = enableTools && modelSupportsTools;

  if (enableTools && !modelSupportsTools) {
    logger.warn(`Model ${effectiveModel} does not support tools, disabling`);
  }

  // Get effective max tokens early for token budget management
  const effectiveMaxTokens = await getEffectiveMaxTokens(effectiveModel);

  // Build unified conversation context with anchors, follow-up detection, and cache keys
  const limitsSettings = await getLimitsSettings();
  const ctx = buildConversationContext(conversationHistory, userMessage, {
    maxMessages: limitsSettings.conversationHistoryMessages,
    maxTokens: 6000,
    summaryContext,
    memoryContext,
    categorySlugs,
    styleContext,
    userId,
    threadId,
  });

  // Log context info for debugging
  if (ctx.followUp.isFollowUp) {
    logger.debug('Follow-up detected', {
      confidence: ctx.followUp.confidence,
      historyCount: ctx.history.all.length,
    });
  }

  // Build messages array (OpenAI format — used for fullHistory return and OpenAI API calls)
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Anthropic messages array — maintained in parallel for Claude direct path
  const anthropicMessages: Anthropic.MessageParam[] = [];

  // Add conversation history from context manager (anchors + recent)
  const historyForAPI = getHistoryForAPI(ctx);
  for (const msg of historyForAPI) {
    if (msg.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: msg.tool_call_id!,
        content: msg.content,
      });
    } else if (msg.role === 'assistant' && msg.tool_calls) {
      messages.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls,
      });
    } else {
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  // Build Anthropic history (skips tool-related messages from prior sessions)
  if (useAnthropicDirect) {
    anthropicMessages.push(...buildAnthropicHistory(historyForAPI));
  }

  // DESIGN FIX: Apply token budget management to prevent silent truncation by API
  // Calculate effective max tokens and truncate context if needed
  const truncationResult = truncateContextToBudget(
    context,
    systemPrompt,
    historyForAPI,
    userMessage,
    effectiveMaxTokens,
    effectiveModel
  );

  // Surface truncation to user so they know document context may be incomplete
  let truncatedContext = truncationResult.context;
  if (truncationResult.wasTruncated) {
    const truncationNote = '[System Note: The retrieved document context exceeded the model\'s token limit and was truncated. Some document sections may not be included in this response. Consider asking a more specific question or reducing conversation history.]\n\n';
    truncatedContext = truncationNote + truncatedContext;
  }

  // Format user message with proper context ordering (follow-up hint, summary, RAG)
  const textContent = formatUserMessage(ctx, truncatedContext, userMessage);

  if (images && images.length > 0) {
    // Determine image handling strategy based on capabilities
    const strategy = imageCapabilities?.strategy || 'vision-and-ocr';

    if (strategy === 'vision-and-ocr' || strategy === 'vision-only') {
      // Strategy: Send images to vision-capable model for visual analysis
      const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [
        { type: 'text', text: textContent },
      ];

      // Add each image as visual content
      for (const img of images) {
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${img.mimeType};base64,${img.base64}`,
            detail: 'high', // Use high detail for better analysis
          },
        });
        // Add filename context so LLM knows which image is which
        contentParts.push({
          type: 'text',
          text: `[Above image: ${img.filename}]`,
        });
      }

      messages.push({
        role: 'user',
        content: contentParts,
      });

      logger.info(`Vision+OCR: ${images.length} image(s) sent for visual analysis`);
    } else if (strategy === 'ocr-only') {
      // Strategy: Images processed via OCR only, text already in RAG context
      // Don't send images to LLM - just include text with OCR note
      const ocrNote = `\n\n---\n[Note: ${images.length} image(s) processed via OCR text extraction. Visual analysis not available with current model.]`;
      messages.push({
        role: 'user',
        content: textContent + ocrNote,
      });

      logger.info(`OCR-only: ${images.length} image(s) processed via text extraction (no visual analysis)`);
    } else {
      // Strategy: No processing available - should have been blocked upstream
      const warningNote = `\n\n---\n[Warning: ${images.length} image(s) could not be processed. Please enable OCR or use a vision-capable model.]`;
      messages.push({
        role: 'user',
        content: textContent + warningNote,
      });

      logger.warn(`No image processing: ${images.length} image(s) skipped`);
    }
  } else {
    // Standard text-only message
    messages.push({
      role: 'user',
      content: textContent,
    });
  }

  // Build Anthropic user message (with images in Anthropic format if needed)
  if (useAnthropicDirect) {
    if (images && images.length > 0) {
      const strategy = imageCapabilities?.strategy || 'vision-and-ocr';
      if (strategy === 'vision-and-ocr' || strategy === 'vision-only') {
        const parts: Anthropic.ContentBlockParam[] = [
          { type: 'text', text: textContent },
        ];
        for (const img of images) {
          parts.push({
            type: 'image',
            source: { type: 'base64', media_type: img.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: img.base64 },
          });
          parts.push({ type: 'text', text: `[Above image: ${img.filename}]` });
        }
        anthropicMessages.push({ role: 'user', content: parts });
      } else {
        // OCR-only or no processing — just text
        const suffix = strategy === 'ocr-only'
          ? `\n\n---\n[Note: ${images.length} image(s) processed via OCR text extraction. Visual analysis not available with current model.]`
          : `\n\n---\n[Warning: ${images.length} image(s) could not be processed.]`;
        anthropicMessages.push({ role: 'user', content: textContent + suffix });
      }
    } else {
      anthropicMessages.push({ role: 'user', content: textContent });
    }
  }

  // Prepare completion params - pass categoryIds for dynamic Function API tools
  let tools = effectiveEnableTools ? await getToolDefinitions(categoryIds) : undefined;

  // Filter out excluded tools if specified
  if (tools && excludeTools && excludeTools.length > 0) {
    tools = tools.filter(tool => {
      const toolName = tool.function?.name;
      return toolName && !excludeTools.includes(toolName);
    });
  }

  // Apply tool routing to determine tool_choice
  // Check both legacy tool-routing and skills-based tool routing
  let toolChoice: 'auto' | 'required' | { type: 'function'; function: { name: string } } | undefined;
  let toolChoiceAppliedByRouting = false;
  // Map of tool name -> config override from skill-level tool_config_override
  const toolConfigOverrides = new Map<string, Record<string, unknown>>();

  if (effectiveEnableTools && tools && tools.length > 0) {
    // Phase 6 optimization: short-circuit skills resolution when all
    // skill-mappable tools are excluded (common for sub-agents with narrow
    // allowlists, e.g., doc-executor only has doc_gen).
    const allSkillToolsExcluded = excludeTools &&
      excludeTools.length > 0 &&
      [...SKILL_MAPPABLE_TOOLS].every(t => excludeTools.includes(t));

    if (!allSkillToolsExcluded) {
    // First, check skills-based tool routing (new unified system)
    const skillsResult = await resolveSkills(categoryIds || [], userMessage);
    if (skillsResult.toolRouting && skillsResult.toolRouting.matches.length > 0) {
      // Filter out matches for excluded tools (e.g., web_search disabled via chat preferences)
      const validMatches = skillsResult.toolRouting.matches.filter(
        match => !excludeTools?.includes(match.toolName)
      );

      if (validMatches.length > 0) {
        // Recalculate tool choice based on valid matches only
        toolChoice = determineToolChoice(validMatches);
        toolChoiceAppliedByRouting = true;

        // Collect config overrides from valid matches only
        for (const match of validMatches) {
          if (match.configOverride) {
            toolConfigOverrides.set(match.toolName, match.configOverride);
          }
        }

        logger.info('Skills-based tool routing applied', {
          matches: validMatches.map((m) => `${m.toolName}:${m.forceMode}`),
          toolChoice:
            typeof toolChoice === 'object' ? toolChoice.function.name : toolChoice,
          hasConfigOverrides: toolConfigOverrides.size > 0,
          excludedMatches: skillsResult.toolRouting.matches.length - validMatches.length,
        });
      } else if (skillsResult.toolRouting.matches.length > 0) {
        // All matches were excluded - log for debugging
        logger.info('Skills-based tool routing skipped - all matched tools excluded', {
          originalMatches: skillsResult.toolRouting.matches.map((m) => `${m.toolName}:${m.forceMode}`),
          excludeTools,
        });
      }
    }

    } // end if (!allSkillToolsExcluded)

    // Fall back to legacy tool-routing rules if no skills-based routing matched
    if (!toolChoiceAppliedByRouting) {
      const routing = await resolveToolRouting(userMessage, categoryIds || []);

      // Filter out matches for excluded tools
      const validMatches = routing.matches.filter(
        match => !excludeTools?.includes(match.toolName)
      );

      if (validMatches.length > 0) {
        // Recalculate tool choice based on valid matches
        // Use same logic as skills-based routing for consistency
        const toolMatchesForChoice = validMatches.map(m => ({
          skillId: 0, // Legacy routing doesn't have skill IDs
          skillName: m.matchedPattern,
          toolName: m.toolName,
          forceMode: m.forceMode,
        }));
        toolChoice = determineToolChoice(toolMatchesForChoice);
        toolChoiceAppliedByRouting = true;
        logger.info('Legacy tool routing applied', {
          matches: validMatches.map((m) => `${m.toolName}:${m.matchedPattern}`),
          toolChoice:
            typeof toolChoice === 'object' ? toolChoice.function.name : toolChoice,
          excludedMatches: routing.matches.length - validMatches.length,
        });
      } else if (routing.matches.length > 0) {
        // All matches were excluded - log for debugging
        logger.info('Legacy tool routing skipped - all matched tools excluded', {
          originalMatches: routing.matches.map((m) => `${m.toolName}:${m.matchedPattern}`),
          excludeTools,
        });
      }
    }
  }

  // Ollama small models can't reliably handle most tools and the tool definitions
  // consume thousands of tokens. Keep only local-generation tools that don't need external APIs.
  const isOllama = isOllamaModel(effectiveModel);
  let effectiveToolChoice = toolChoice;
  if (isOllama) {
    if (tools?.length) {
      const allowedTools = tools.filter(t => t.function?.name && OLLAMA_ALLOWED_TOOLS.has(t.function.name));
      const strippedCount = tools.length - allowedTools.length;
      tools = allowedTools.length > 0 ? allowedTools : undefined;
      logger.info('Filtered tools for Ollama model', {
        model: effectiveModel,
        kept: allowedTools.length,
        stripped: strippedCount,
        allowed: Array.from(OLLAMA_ALLOWED_TOOLS),
      });
    }
    logger.info('Ollama context configured', {
      model: effectiveModel,
      num_ctx: OLLAMA_NUM_CTX,
      max_tokens: effectiveMaxTokens,
    });
  }

  // Downgrade forced tool_choice for models that don't support it
  const modelSupportsForcedTool = await isModelForcedToolCapable(effectiveModel);
  if (!modelSupportsForcedTool && (typeof effectiveToolChoice === 'object' || effectiveToolChoice === 'required')) {
    const originalToolChoice = typeof effectiveToolChoice === 'object' ? effectiveToolChoice.function.name : effectiveToolChoice;
    effectiveToolChoice = 'auto' as const;
    logger.info('Downgraded tool_choice for model without forced-tool support', { model: effectiveModel, original: originalToolChoice });
  }

  // Inject request_clarification meta-tool when preflight skill is active OR
  // when any kb_* tool is present (kb_read AMBIGUOUS confidence relies on it to
  // ask the user which document they meant). Skipped for Ollama: small models
  // struggle with meta-tools and context is already tight — kb_read degrades
  // gracefully by returning candidates + a plain-text ask hint instead.
  const hasKbTool = Boolean(tools?.some(t => t.function?.name?.startsWith('kb_')));
  if ((enableClarification || hasKbTool) && modelSupportsTools && !isOllama) {
    tools = [...(tools || []), REQUEST_CLARIFICATION_TOOL];
  }

  const modelThinkingCapable = await isModelThinkingCapable(effectiveModel);
  const baseThinkingProfile = buildThinkingRequestProfile({
    modelId: effectiveModel,
    thinkingCapable: modelThinkingCapable,
    thinkingEnabled,
    maxTokens: effectiveMaxTokens,
    toolsEnabled: Boolean(tools?.length),
  });
  const disableClaudeThinkingForTools = useAnthropicDirect && baseThinkingProfile.enabled && Boolean(tools?.length);
  if (disableClaudeThinkingForTools) {
    logger.warn('Claude thinking disabled for tool turn because thinking block preservation is not complete', {
      model: effectiveModel,
    });
  }
  const thinkingProfile = disableClaudeThinkingForTools
    ? buildThinkingRequestProfile({
        modelId: effectiveModel,
        thinkingCapable: modelThinkingCapable,
        thinkingEnabled,
        maxTokens: effectiveMaxTokens,
        toolsEnabled: Boolean(tools?.length),
        forcePlain: true,
      })
    : baseThinkingProfile;

  // Gemini does not accept reasoning_effort — rewrite to native thinkingConfig
  const geminiModel = /^gemini[-/]/.test(effectiveModel);
  if (geminiModel && thinkingProfile.requestParams.reasoning_effort) {
    thinkingProfile.requestParams = {
      ...thinkingProfile.requestParams,
      reasoning_effort: undefined,
      thinkingConfig: { thinkingBudget: -1 },
    };
  }

  const completionParams: Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, 'stream'> = {
    model: useFireworksDirect ? getFireworksModelId(effectiveModel)
      : useOllamaDirect ? getOllamaModelId(effectiveModel)
      : useMoonshotDirect ? getMoonshotModelId(effectiveModel)
      : useDeepSeekDirect ? getDeepSeekModelId(effectiveModel)
      : useAzureFoundryDirect ? stripAzureFoundryPrefix(effectiveModel)
      : effectiveModel,
    messages,
    tools,
    tool_choice: tools?.length ? effectiveToolChoice : undefined,
    ...(useOpenAIDirect && requiresMaxCompletionTokens(effectiveModel)
      ? { max_completion_tokens: effectiveMaxTokens }
      : { max_tokens: effectiveMaxTokens }),
    temperature: effectiveTemperature,
    ...(isOllama && { num_ctx: OLLAMA_NUM_CTX }),
    ...thinkingProfile.requestParams,
  } as Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, 'stream'>;

  // First API call — streaming so content tokens are forwarded via onChunk if no tool calls
  let responseMessage: { content: string | null; tool_calls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] | undefined; thinkingContent: string | null; totalTokens: number };
  let accumulatedTokens = 0;

  if (useAnthropicDirect && anthropicClient) {
    const anthropicResult = await streamAnthropicCompletion(
      anthropicClient,
      {
        model: getAnthropicModelId(effectiveModel),
        messages: anthropicMessages,
        system: systemPrompt,
        max_tokens: effectiveMaxTokens,
        temperature: effectiveTemperature,
        tools: convertToolsToAnthropic(tools),
        tool_choice: tools?.length ? convertToolChoiceToAnthropic(effectiveToolChoice) : undefined,
        thinking: thinkingProfile.enabled ? thinkingProfile.requestParams.thinking as Anthropic.ThinkingConfigParam : undefined,
        output_config: thinkingProfile.requestParams.output_config as Anthropic.OutputConfig | undefined,
      },
      callbacks?.onChunk,
      callbacks?.onThinkingChunk,
    );
    responseMessage = anthropicResult;
    accumulatedTokens += anthropicResult.totalTokens;
  } else if (useOllamaCloudDirect) {
    // Ollama Cloud uses native API — no tool support, text-only streaming
    const ollamaMessages = messages.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
    responseMessage = await streamOllamaCloudCompletion(
      effectiveModel,
      ollamaMessages,
      {
        temperature: effectiveTemperature,
        maxTokens: effectiveMaxTokens,
        think: thinkingProfile.enabled ? Boolean(thinkingProfile.requestParams.think) : undefined,
      },
      callbacks?.onChunk,
      callbacks?.onThinkingChunk,
    );
    accumulatedTokens += responseMessage.totalTokens;
  } else if (useMistralDirect) {
    // Mistral direct (Route 2) — use native SDK streaming
    const mistralMessages = messages.map(m => ({
      role: m.role as string,
      content: m.content,
    }));
    const mistralResult = await streamMistralCompletion(
      effectiveModel,
      mistralMessages,
      {
        temperature: effectiveTemperature,
        maxTokens: effectiveMaxTokens,
        tools: tools as any,
        toolChoice: effectiveToolChoice as any,
        onChunk: callbacks?.onChunk,
        onThinkingChunk: callbacks?.onThinkingChunk,
      },
    );
    responseMessage = {
      content: mistralResult.content,
      tool_calls: mistralResult.tool_calls as any,
      thinkingContent: mistralResult.thinkingContent,
      totalTokens: mistralResult.totalTokens,
    };
    accumulatedTokens += mistralResult.totalTokens;
  } else if (useGeminiDirect) {
    // Gemini direct (Route 2) — use native @google/genai SDK streaming
    const geminiMessages = messages.map(m => ({
      role: m.role as string,
      content: m.content,
    }));
    const geminiResult = await streamGeminiCompletion(
      effectiveModel,
      geminiMessages,
      {
        temperature: effectiveTemperature,
        maxTokens: effectiveMaxTokens,
        tools: tools as any,
        toolChoice: effectiveToolChoice as any,
        systemPrompt,
        thinkingConfig: thinkingProfile.enabled
          ? { thinkingBudget: -1 }
          : undefined,
        onChunk: callbacks?.onChunk,
        onThinkingChunk: callbacks?.onThinkingChunk,
      },
    );
    responseMessage = {
      content: geminiResult.content,
      tool_calls: geminiResult.tool_calls as any,
      thinkingContent: geminiResult.thinkingContent,
      totalTokens: geminiResult.totalTokens,
    };
    accumulatedTokens += geminiResult.totalTokens;
  } else if (useOpenAIDirect) {
    // OpenAI direct (Route 2) — use native OpenAI SDK streaming
    const openaiMessages = messages.map(m => ({
      role: m.role as string,
      content: m.content,
    }));
    const openaiResult = await streamOpenAICompletion(
      effectiveModel,
      openaiMessages,
      {
        temperature: effectiveTemperature,
        maxTokens: effectiveMaxTokens,
        tools: tools as any,
        toolChoice: effectiveToolChoice as any,
        systemPrompt,
        reasoningEffort: thinkingProfile.requestParams.reasoning_effort as string | undefined,
        onChunk: callbacks?.onChunk,
        onThinkingChunk: callbacks?.onThinkingChunk,
      },
    );
    responseMessage = {
      content: openaiResult.content,
      tool_calls: openaiResult.tool_calls as any,
      thinkingContent: openaiResult.thinkingContent,
      totalTokens: openaiResult.totalTokens,
    };
    accumulatedTokens += openaiResult.totalTokens;
  } else {
    responseMessage = await streamOneCompletionWithThinkingRetry(openai!, completionParams, thinkingProfile, callbacks?.onChunk, callbacks?.onThinkingChunk);
    accumulatedTokens += responseMessage.totalTokens;
  }

  // Tool call loop (max iterations to prevent runaway)
  // Load tool call limits from DB (defaults: 50 total, 10 per tool)
  const { maxTotalToolCalls, maxPerToolCalls } = await getLimitsSettings();

  let iterations = 0;
  let totalToolCalls = 0;
  const toolCallCounts = new Map<string, number>();
  // Phase 6: Track agent invocations for cap enforcement (max 2 per agent per turn)
  const agentInvocationCaps = new Set<string>();
  // Accumulate agent results for context bridging (Fix 2)
  const priorAgentResults: Array<{ toolName: string; artifactContent: string; confidence: number; suggestedReason: string }> = [];
  let terminalToolSucceeded = false;
  // Collect every successful terminal tool's metadata so the post-loop status marker
  // can name the correct count. Previously a scalar that was overwritten on each
  // success, causing the summary to mention only the last artifact. The handoff
  // branch deliberately does NOT push here — it emits its own `handoff` SSE event
  // and sets only `terminalToolSucceeded`, mirroring this array staying empty.
  let terminalToolResults: Array<{ toolName: string; parsedResult: Record<string, unknown> }> = [];

  // Collect tool execution results for compliance checking
  const toolExecutionResults: ToolExecutionRecord[] = [];
  // Phase 6.1 — accumulate inline mermaid fences emitted by diagram_gen so they
  // can be appended to responseMessage.content after the tool loop (mirrors the
  // terminal-tool status-marker pattern). This keeps the inline render in shared
  // threads / persisted history, not just the live SSE stream.
  const inlineDiagramFences: string[] = [];

  // Check if this model supports parallel tool execution
  const parallelToolCapable = await isModelParallelToolCapable(effectiveModel);

  while (responseMessage.tool_calls && totalToolCalls < maxTotalToolCalls && !terminalToolSucceeded) {
    iterations++;
    logger.debug(`Tool call iteration ${iterations}, total calls ${totalToolCalls}/${maxTotalToolCalls}`);

    // Add assistant's tool call message (OpenAI format for fullHistory)
    const assistantToolMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam & { reasoning_content?: string } = {
      role: 'assistant',
      content: responseMessage.content,
      tool_calls: responseMessage.tool_calls,
    };
    // Preserve reasoning_content for any model that returns it (Moonshot, Claude, DeepSeek, etc.)
    if (responseMessage.thinkingContent) {
      assistantToolMessage.reasoning_content = responseMessage.thinkingContent;
    }
    messages.push(assistantToolMessage);

    // Add assistant's tool call message (Anthropic format for API calls)
    if (useAnthropicDirect) {
      const contentBlocks: Anthropic.ContentBlockParam[] = [];
      if (responseMessage.content) {
        contentBlocks.push({ type: 'text', text: responseMessage.content });
      }
      for (const tc of responseMessage.tool_calls!) {
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || '{}'),
        });
      }
      anthropicMessages.push({ role: 'assistant', content: contentBlocks });
    }

    // Collect tool results for Anthropic (batched into a single 'user' message after all executions)
    const anthropicToolResults: Anthropic.ToolResultBlockParam[] = [];

    // ── Helper: process a single tool call result (error detection, artifacts, terminal tools, compliance) ──
    const processToolResult = async (
      toolName: string,
      toolCallId: string,
      result: string,
      success: boolean,
      errorMsg: string | undefined,
      startTime: number,
    ) => {
      // Parse result for error detection, artifacts, terminal tool check
      try {
        const parsed = JSON.parse(result);

        const hasError = parsed.error || parsed.errorCode || parsed.success === false;
        const errorValue = parsed.error;

        if (hasError) {
          success = false;
          if (typeof errorValue === 'string') {
            errorMsg = errorValue;
          } else if (typeof errorValue === 'object' && errorValue?.message) {
            errorMsg = errorValue.message;
          } else if (parsed.errorCode) {
            errorMsg = `Tool error: ${parsed.errorCode}`;
          } else {
            errorMsg = 'Tool execution failed';
          }
        } else {
          // Extract artifacts for streaming callbacks
          if (callbacks?.onArtifact) {
            try {
              if (parsed.success && parsed.data && parsed.visualizationHint) {
                const viz: MessageVisualization = {
                  chartType: parsed.visualizationHint.chartType,
                  data: parsed.data,
                  xField: parsed.visualizationHint.xField,
                  yField: parsed.visualizationHint.yField,
                  yFields: parsed.visualizationHint.yFields,
                  groupBy: parsed.visualizationHint.groupBy,
                  title: parsed.chartTitle,
                  notes: parsed.notes,
                  seriesMode: parsed.seriesMode,
                };
                callbacks.onArtifact('visualization', viz);
              }
              if (parsed.success && parsed.document) {
                const doc: GeneratedDocumentInfo = {
                  id: parsed.document.id,
                  filename: parsed.document.filename,
                  fileType: parsed.document.fileType,
                  fileSize: parsed.document.fileSize || 0,
                  fileSizeFormatted: parsed.document.fileSizeFormatted || '',
                  downloadUrl: parsed.document.downloadUrl,
                  expiresAt: parsed.document.expiresAt || null,
                };
                callbacks.onArtifact('document', doc);
              }
              if (parsed.success && parsed.imageHint) {
                const img: GeneratedImageInfo = {
                  id: parsed.imageHint.id,
                  url: parsed.imageHint.url,
                  thumbnailUrl: parsed.imageHint.thumbnailUrl,
                  width: parsed.imageHint.width,
                  height: parsed.imageHint.height,
                  alt: parsed.imageHint.alt || 'Generated image',
                  provider: parsed.metadata?.provider,
                  model: parsed.metadata?.model,
                  expiresAt: null,
                };
                callbacks.onArtifact('image', img);
              }
              if (parsed.success && parsed.diagramHint) {
                const diagram: DiagramHint = {
                  code: parsed.diagramHint.code,
                  type: parsed.diagramHint.type,
                  title: parsed.diagramHint.title,
                };
                callbacks.onArtifact('diagram', diagram);
                // Phase 6.1 — inline streaming continuity: accumulate the mermaid
                // fence so it can be emitted into BOTH the live content stream
                // (onChunk) and the persisted responseMessage.content AFTER the
                // tool loop, BEFORE the terminal-tool status marker. Emitting at
                // a single post-loop point guarantees the live SSE order matches
                // the persisted/shared-thread order (fence → status marker).
                const fence = '```mermaid\n' + parsed.diagramHint.code + '\n```';
                inlineDiagramFences.push(fence);
              }
              if (parsed.success && parsed.podcastHint) {
                callbacks.onArtifact('podcast', parsed.podcastHint);
              }
              if (parsed.success && parsed.browserSession) {
                callbacks.onBrowserSessionStarted?.(parsed.browserSession);
              }
              // Phase 2.2 — agent-as-tool return-result: surface the agent's
              // contract envelope as an `agent` artifact so the client renders
              // an "Answered by agent X" card. `executeAgentTool` injects
              // `agentName` at the top level (not part of AgentResponse).
              if (isAgentTool(toolName) && parsed.artifact) {
                const info: AgentResponseInfo = {
                  agentId: String(parsed.agentId ?? toolName),
                  agentName: typeof parsed.agentName === 'string' ? parsed.agentName : String(parsed.agentId ?? toolName),
                  roleFamily: parsed.roleFamily ?? 'executor',
                  artifact: {
                    // Preserve the full artifact type union ('text' | 'table' |
                    // 'file_ref' | 'structured' | 'error') rather than collapsing
                    // table/file_ref to 'structured'. The AgentResponseCard can
                    // render these distinctly. Unknown values fall back to
                    // 'structured' for forward-compat safety.
                    type: ((): AgentResponseInfo['artifact']['type'] => {
                      const t = parsed.artifact.type;
                      if (t === 'text' || t === 'table' || t === 'file_ref' || t === 'structured' || t === 'error') {
                        return t;
                      }
                      return 'structured';
                    })(),
                    content: typeof parsed.artifact.content === 'string' ? parsed.artifact.content : JSON.stringify(parsed.artifact.content),
                  },
                  confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
                  suggestedNextReason: parsed.suggestedNext?.reason,
                };
                callbacks.onArtifact('agent', info);

                // Phase 6 (Fix 1): Confidence-gated termination for agent tools.
                // High-confidence agents that declare completion are treated as terminal,
                // stopping the tool loop without needing a separate LLM call.
                const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
                const suggestedAction = parsed.suggestedNext?.action;

                if (confidence >= 0.8 && suggestedAction === 'complete') {
                  logger.info(`[Tools] Agent ${toolName} terminal (confidence=${confidence}, action=${suggestedAction})`);
                  terminalToolSucceeded = true;
                  terminalToolResults.push({ toolName, parsedResult: parsed });
                }

                // Phase 6 (Fix 1): Track per-agent invocation count for cap enforcement.
                // After 2 invocations of the same agent, force synthesis.
                const agentCount = toolCallCounts.get(toolName) ?? 0;
                if (agentCount >= 2) {
                  agentInvocationCaps.add(toolName);
                  logger.warn(`[Tools] Agent ${toolName} invocation cap reached (${agentCount}), synthesis directive will be injected`);
                }

                // Phase 6 (Fix 2): Accumulate agent results for context bridging.
                // When the same agent is re-invoked, the prior output is injected as feedback.
                const artifactContent = typeof parsed.artifact?.content === 'string'
                  ? parsed.artifact.content.slice(0, 2000)
                  : JSON.stringify(parsed.artifact ?? parsed).slice(0, 2000);
                priorAgentResults.push({
                  toolName,
                  artifactContent,
                  confidence,
                  suggestedReason: typeof parsed.suggestedNext?.reason === 'string' ? parsed.suggestedNext.reason : '',
                });
              }
            } catch (artifactError) {
              logger.error(`Artifact callback error for tool ${toolName}:`, artifactError);
            }
          }

          // Phase 2.2 — handoff_to_category: the executor returns a
          // handoff-request envelope and performs no DB mutation. Fire the
          // onHandoff callback so the route layer can transfer thread
          // ownership, emit the `handoff` SSE event, and end the turn. We treat
          // the handoff as terminal by setting ONLY `terminalToolSucceeded`
          // (which breaks the tool loop at the `while` guard and the post-loop
          // `break`). We intentionally do NOT push to `terminalToolResults`, so
          // the post-loop status marker (`terminalToolSucceeded && length > 0`)
          // is skipped — handoffs produce no artifact to summarize, and an extra
          // summary LLM call would stream spurious `chunk` text after the
          // `handoff` SSE event, contradicting the "turn ends" semantics.
          if (toolName === 'handoff_to_category' && parsed.handoff === true && parsed.targetCategoryId) {
            try {
              callbacks?.onHandoff?.({
                targetCategoryId: parsed.targetCategoryId,
                targetCategoryName: String(parsed.targetCategoryName ?? ''),
                targetCategorySlug: String(parsed.targetCategorySlug ?? ''),
                reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
              });
            } catch (handoffError) {
              logger.error(`Handoff callback error for tool ${toolName}:`, handoffError);
            }
            logger.info(`[Tools] handoff_to_category succeeded (target=${parsed.targetCategorySlug}), stopping tool loop (no summary)`);
            terminalToolSucceeded = true;
            // Deliberately do NOT push to terminalToolResults — see comment above.
          }

          // Check if terminal tool succeeded
          if (parsed.success && (await isTerminalTool(toolName))) {
            logger.info(`[Tools] Terminal tool ${toolName} succeeded, stopping tool loop`);
            terminalToolSucceeded = true;
            terminalToolResults.push({ toolName, parsedResult: parsed });
          }
        }
      } catch {
        logger.debug(`Tool ${toolName} returned non-JSON result, treating as text response`);
      }

      const duration = Date.now() - startTime;
      callbacks?.onToolEnd?.(toolName, success, duration, errorMsg);

      // Build compliance record
      const executionRecord: ToolExecutionRecord = {
        toolName,
        success,
        duration,
        executedAt: new Date().toISOString(),
      };
      if (errorMsg) {
        executionRecord.error = errorMsg;
        executionRecord.failureType = 'error' as FailureType;
      }
      try {
        const parsed = JSON.parse(result);
        if (parsed.success !== false) {
          if (Array.isArray(parsed.data)) {
            executionRecord.resultCount = parsed.data.length;
          } else if (parsed.results && Array.isArray(parsed.results)) {
            executionRecord.resultCount = parsed.results.length;
          } else if (parsed.data) {
            executionRecord.resultCount = 1;
          }
          if (parsed.document?.downloadUrl) {
            executionRecord.artifactUrl = parsed.document.downloadUrl;
          } else if (parsed.website?.downloadUrl) {
            executionRecord.artifactUrl = parsed.website.downloadUrl;
          } else if (parsed.imageHint?.url) {
            executionRecord.artifactUrl = parsed.imageHint.url;
          }
          if (parsed.data && Array.isArray(parsed.data)) {
            executionRecord.dataPoints = parsed.data.length;
          }
        } else if (!executionRecord.failureType) {
          executionRecord.failureType = 'empty' as FailureType;
          executionRecord.resultCount = 0;
        }
      } catch {
        // Non-JSON result
      }
      toolExecutionResults.push(executionRecord);

      // Push to message arrays
      messages.push({ role: 'tool', tool_call_id: toolCallId, content: result });
      if (useAnthropicDirect) {
        anthropicToolResults.push({
          type: 'tool_result',
          tool_use_id: toolCallId,
          content: result,
          ...(success ? {} : { is_error: true }),
        });
      }

      return { success, errorMsg, duration };
    };

    // ── Helper: handle request_clarification meta-tool ──
    const handleClarification = async (toolCall: { id: string; function: { name: string; arguments: string } }) => {
      let clarificationAnswer = 'No clarification provided, proceed with best interpretation.';
      if (callbacks?.onClarification) {
        try {
          const args = JSON.parse(toolCall.function.arguments) as {
            question: string;
            options: string[];
            allowFreeText?: boolean;
          };
          const answer = await callbacks.onClarification(
            args.question,
            args.options || [],
            args.allowFreeText ?? false,
          );
          if (answer) clarificationAnswer = answer;
        } catch (parseErr) {
          logger.warn('Failed to parse request_clarification arguments', { error: String(parseErr) });
        }
      }
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: clarificationAnswer });
      if (useAnthropicDirect) {
        anthropicToolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: clarificationAnswer });
      }
    };

    // ── Execute tool calls: sequential or parallel based on model capability ──
    const useParallel = parallelToolCapable && responseMessage.tool_calls.length > 1;

    if (!useParallel) {
      // ── Sequential path (existing behavior) ──
      for (const toolCall of responseMessage.tool_calls) {
        const toolName = toolCall.function.name;

        // Per-tool and total call limit checks (skip meta-tools)
        if (toolName !== 'request_clarification') {
          const toolCount = toolCallCounts.get(toolName) ?? 0;
          if (toolCount >= maxPerToolCalls) {
            const limitMsg = `Tool limit reached: ${toolName} has been called ${toolCount} times (max ${maxPerToolCalls} per session). Use a different approach.`;
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: limitMsg });
            if (useAnthropicDirect) {
              anthropicToolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, content: limitMsg });
            }
            continue;
          }
          totalToolCalls++;
          toolCallCounts.set(toolName, toolCount + 1);
        }

        if (toolName === 'request_clarification') {
          await handleClarification(toolCall);
          continue;
        }

        const displayName = getToolDisplayName(toolName);
        const startTime = Date.now();
        logger.info(`[Tools] Executing tool: ${toolName}`);
        callbacks?.onToolStart?.(toolName, displayName);

        let result: string;
        let success = true;
        let errorMsg: string | undefined;

        try {
          const configOverride = toolConfigOverrides.get(toolName);
          result = await executeTool(toolName, toolCall.function.arguments, configOverride, threadId);
        } catch (error) {
          success = false;
          errorMsg = error instanceof Error ? error.message : 'Unknown error';
          result = JSON.stringify({ error: errorMsg, errorCode: 'EXECUTION_ERROR' });
        }

        await processToolResult(toolName, toolCall.id, result, success, errorMsg, startTime);
      }
    } else {
      // ── Parallel path: execute independent tool calls concurrently ──
      logger.debug(`Parallel tool execution: ${responseMessage.tool_calls.length} calls`);

      // 1. Partition: separate request_clarification (HITL, must be sync) from regular calls
      const clarificationCalls: typeof responseMessage.tool_calls = [];
      const regularCalls: typeof responseMessage.tool_calls = [];

      for (const tc of responseMessage.tool_calls) {
        if (tc.function.name === 'request_clarification') {
          clarificationCalls.push(tc);
        } else {
          regularCalls.push(tc);
        }
      }

      // 2. Handle clarification calls first, sequentially (HITL needs user interaction)
      for (const tc of clarificationCalls) {
        await handleClarification(tc);
      }

      // 3. Pre-validate per-tool + total limits atomically for the batch
      const validCalls: typeof regularCalls = [];
      for (const tc of regularCalls) {
        const toolName = tc.function.name;
        const toolCount = toolCallCounts.get(toolName) ?? 0;

        if (toolCount >= maxPerToolCalls) {
          const limitMsg = `Tool limit reached: ${toolName} has been called ${toolCount} times (max ${maxPerToolCalls} per session). Use a different approach.`;
          messages.push({ role: 'tool', tool_call_id: tc.id, content: limitMsg });
          if (useAnthropicDirect) {
            anthropicToolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: limitMsg });
          }
          continue;
        }

        if (totalToolCalls >= maxTotalToolCalls) {
          const limitMsg = `Total tool call limit reached (${maxTotalToolCalls}). Cannot execute more tools.`;
          messages.push({ role: 'tool', tool_call_id: tc.id, content: limitMsg });
          if (useAnthropicDirect) {
            anthropicToolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: limitMsg });
          }
          continue;
        }

        // Reserve the slot
        totalToolCalls++;
        toolCallCounts.set(toolName, toolCount + 1);
        validCalls.push(tc);
      }

      // 4. Fire all onToolStart callbacks
      for (const tc of validCalls) {
        callbacks?.onToolStart?.(tc.function.name, getToolDisplayName(tc.function.name));
      }

      // 5. Execute all valid calls in parallel (each tracks its own start time)
      const parallelResults = await Promise.allSettled(
        validCalls.map(async (tc) => {
          const startTime = Date.now();
          const configOverride = toolConfigOverrides.get(tc.function.name);
          logger.info(`[Tools] Executing tool (parallel): ${tc.function.name}`);
          try {
            const result = await executeTool(tc.function.name, tc.function.arguments, configOverride, threadId);
            return { result, success: true as boolean, errorMsg: undefined as string | undefined, startTime };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            return {
              result: JSON.stringify({ error: errorMsg, errorCode: 'EXECUTION_ERROR' }),
              success: false,
              errorMsg,
              startTime,
            };
          }
        })
      );

      // 6. Process results IN ORIGINAL ORDER (important for message array consistency)
      for (let i = 0; i < validCalls.length; i++) {
        const tc = validCalls[i];
        const toolName = tc.function.name;
        const settled = parallelResults[i];

        if (settled.status === 'fulfilled') {
          const { result, success, errorMsg, startTime } = settled.value;
          await processToolResult(toolName, tc.id, result, success, errorMsg, startTime);
        } else {
          // Should not happen since we catch inside the map, but handle gracefully
          const errorMsg = settled.reason instanceof Error ? settled.reason.message : 'Unknown error';
          const result = JSON.stringify({ error: errorMsg, errorCode: 'EXECUTION_ERROR' });
          await processToolResult(toolName, tc.id, result, false, errorMsg, Date.now());
        }
      }
    }

    // Push all tool results as a single Anthropic 'user' message
    if (useAnthropicDirect && anthropicToolResults.length > 0) {
      anthropicMessages.push({ role: 'user', content: anthropicToolResults });
    }

    // Phase 6 (Fix 2): Inject prior agent context before the next LLM call.
    // When agents have been invoked in this turn, provide structured feedback
    // so the LLM either passes corrective context or synthesizes from results.
    if (priorAgentResults.length > 0) {
      for (const result of priorAgentResults) {
        const capReached = agentInvocationCaps.has(result.toolName);
        const feedbackNote =
          `[AGENT FEEDBACK — ${result.toolName}]\n` +
          `Prior output: ${result.artifactContent}\n` +
          `Confidence: ${result.confidence}\n` +
          (result.suggestedReason ? `Agent suggested: ${result.suggestedReason}\n` : '') +
          (capReached
            ? `CAP REACHED: Do NOT re-invoke ${result.toolName}. Synthesize final answer from available results.\n`
            : `If re-invoking ${result.toolName}, pass the above as "context" and address any feedback.`);

        messages.push({
          role: 'user',
          content: feedbackNote,
        });
        if (useAnthropicDirect) {
          anthropicMessages.push({
            role: 'user',
            content: feedbackNote,
          });
        }
      }
      // Clear accumulated results after injection to avoid duplicate messages
      priorAgentResults.length = 0;
    }

    // If a terminal tool succeeded, skip getting another response
    if (terminalToolSucceeded) {
      break;
    }

    // Get next response with tool results — streaming so the final text answer is forwarded live
    // Only apply forced tool_choice on first iteration, then let LLM decide
    if (useAnthropicDirect && anthropicClient) {
      responseMessage = await streamAnthropicCompletion(
        anthropicClient,
        {
          model: getAnthropicModelId(effectiveModel),
          messages: anthropicMessages,
          system: systemPrompt,
          max_tokens: effectiveMaxTokens,
          temperature: effectiveTemperature,
          tools: convertToolsToAnthropic(tools),
          tool_choice: toolChoiceAppliedByRouting
            ? convertToolChoiceToAnthropic('auto')
            : convertToolChoiceToAnthropic(effectiveToolChoice),
          thinking: thinkingProfile.enabled ? thinkingProfile.requestParams.thinking as Anthropic.ThinkingConfigParam : undefined,
          output_config: thinkingProfile.requestParams.output_config as Anthropic.OutputConfig | undefined,
        },
        callbacks?.onChunk,
        callbacks?.onThinkingChunk,
      );
      accumulatedTokens += responseMessage.totalTokens;
    } else if (useMistralDirect) {
      const mistralMessages = messages.map(m => ({
        role: m.role as string,
        content: m.content,
      }));
      const mistralResult = await streamMistralCompletion(
        effectiveModel,
        mistralMessages,
        {
          temperature: effectiveTemperature,
          maxTokens: effectiveMaxTokens,
          tools: tools as any,
          toolChoice: toolChoiceAppliedByRouting ? 'auto' : (effectiveToolChoice as any),
          onChunk: callbacks?.onChunk,
          onThinkingChunk: callbacks?.onThinkingChunk,
        },
      );
      responseMessage = {
        content: mistralResult.content,
        tool_calls: mistralResult.tool_calls as any,
        thinkingContent: mistralResult.thinkingContent,
        totalTokens: mistralResult.totalTokens,
      };
      accumulatedTokens += mistralResult.totalTokens;
    } else if (useGeminiDirect) {
      const geminiMessages = messages.map(m => ({
        role: m.role as string,
        content: m.content,
      }));
      const geminiResult = await streamGeminiCompletion(
        effectiveModel,
        geminiMessages,
        {
          temperature: effectiveTemperature,
          maxTokens: effectiveMaxTokens,
          tools: tools as any,
          toolChoice: toolChoiceAppliedByRouting ? 'auto' : (effectiveToolChoice as any),
          systemPrompt,
          thinkingConfig: thinkingProfile.enabled
            ? { thinkingBudget: -1 }
            : undefined,
          onChunk: callbacks?.onChunk,
          onThinkingChunk: callbacks?.onThinkingChunk,
        },
      );
      responseMessage = {
        content: geminiResult.content,
        tool_calls: geminiResult.tool_calls as any,
        thinkingContent: geminiResult.thinkingContent,
        totalTokens: geminiResult.totalTokens,
      };
      accumulatedTokens += geminiResult.totalTokens;
    } else {
      responseMessage = await streamOneCompletionWithThinkingRetry(
        openai!,
        {
          ...completionParams,
          messages,
          tool_choice: toolChoiceAppliedByRouting ? 'auto' : completionParams.tool_choice,
        },
        thinkingProfile,
        callbacks?.onChunk,
        callbacks?.onThinkingChunk,
      );
      accumulatedTokens += responseMessage.totalTokens;
    }
  }

  if (totalToolCalls >= maxTotalToolCalls && responseMessage.tool_calls) {
    logger.warn('[Tools] Max tool call iterations reached');

    const maxToolsMsg = 'You have reached the maximum number of tool calls. Based on all the information gathered so far, please provide a complete and helpful response to the original question.';

    if (useAnthropicDirect && anthropicClient) {
      anthropicMessages.push({ role: 'user', content: maxToolsMsg });
      responseMessage = await streamAnthropicCompletion(
        anthropicClient,
        {
          model: getAnthropicModelId(effectiveModel),
          messages: anthropicMessages,
          system: systemPrompt,
          max_tokens: effectiveMaxTokens,
          temperature: effectiveTemperature,
          // No tools — force text-only response
          thinking: thinkingProfile.enabled ? thinkingProfile.requestParams.thinking as Anthropic.ThinkingConfigParam : undefined,
          output_config: thinkingProfile.requestParams.output_config as Anthropic.OutputConfig | undefined,
        },
        callbacks?.onChunk,
        callbacks?.onThinkingChunk,
      );
      accumulatedTokens += responseMessage.totalTokens;
    } else if (useMistralDirect || useGeminiDirect) {
      // Mistral/Gemini: push user message and re-call with tools disabled
      messages.push({ role: 'user' as const, content: maxToolsMsg } as any);
      const finalMessages = messages.map(m => ({
        role: m.role as string,
        content: m.content,
      }));
      if (useMistralDirect) {
        const mistralResult = await streamMistralCompletion(
          effectiveModel,
          finalMessages,
          {
            temperature: effectiveTemperature,
            maxTokens: effectiveMaxTokens,
            onChunk: callbacks?.onChunk,
            onThinkingChunk: callbacks?.onThinkingChunk,
          },
        );
        responseMessage = {
          content: mistralResult.content,
          tool_calls: undefined,
          thinkingContent: mistralResult.thinkingContent,
          totalTokens: mistralResult.totalTokens,
        };
        accumulatedTokens += mistralResult.totalTokens;
      } else {
        const geminiResult = await streamGeminiCompletion(
          effectiveModel,
          finalMessages,
          {
            temperature: effectiveTemperature,
            maxTokens: effectiveMaxTokens,
            systemPrompt,
            thinkingConfig: thinkingProfile.enabled
              ? { thinkingBudget: -1 }
              : undefined,
            onChunk: callbacks?.onChunk,
            onThinkingChunk: callbacks?.onThinkingChunk,
          },
        );
        responseMessage = {
          content: geminiResult.content,
          tool_calls: undefined,
          thinkingContent: geminiResult.thinkingContent,
          totalTokens: geminiResult.totalTokens,
        };
        accumulatedTokens += geminiResult.totalTokens;
      }
    } else {
      const finalMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        ...messages,
        { role: 'user' as const, content: maxToolsMsg },
      ];
      responseMessage = await streamOneCompletionWithThinkingRetry(
        openai!,
        {
          model: completionParams.model,
          messages: finalMessages,
          max_tokens: completionParams.max_tokens,
          temperature: completionParams.temperature,
          tools: completionParams.tools,
          tool_choice: 'none',
          ...thinkingProfile.requestParams,
        },
        thinkingProfile,
        callbacks?.onChunk,
        callbacks?.onThinkingChunk,
      );
      accumulatedTokens += responseMessage.totalTokens;
    }
  }

  // Phase 6.1 — emit inline mermaid fences into BOTH the live content stream
  // (onChunk) and the persisted content BEFORE the terminal-tool status marker.
  // Doing both at a single post-loop point guarantees the live SSE order matches
  // the persisted/shared-thread order (fence → status marker), avoiding the
  // out-of-order mismatch that occurred when the fence was emitted via onChunk
  // during tool execution but appended to content after the status marker.
  if (inlineDiagramFences.length > 0) {
    const fenceBlock = inlineDiagramFences.join('\n\n');
    callbacks?.onChunk?.('\n\n' + fenceBlock + '\n');
    responseMessage = {
      ...responseMessage,
      content: (responseMessage.content ? responseMessage.content + '\n\n' : '') + fenceBlock,
    };
  }

  // Terminal tool success — stream a one-line status marker instead of making an
  // extra LLM summary call. The artifact cards (already emitted via onArtifact)
  // carry the full metadata (filename, alt, title, provider, etc.) and render as
  // collapsible cards in the client, so no prose summary is needed. This mirrors
  // the handoff branch's "terminal-stop without summary" precedent and eliminates
  // a redundant LLM completion per terminal turn — which compounds across nested
  // agent loops (return-result mode) and future Phase 3 swarm Executor calls,
  // since they all reuse this function.
  //
  // The status line is streamed via onChunk so it persists as the assistant
  // message text (so shared threads / history show something and the bubble is
  // never empty). The rich per-artifact detail lives in the cards below it.
  if (terminalToolSucceeded && terminalToolResults.length > 0) {
    const count = terminalToolResults.length;
    const statusLine = count === 1
      ? 'Tool run completed — 1 artifact generated below.'
      : `Tool run completed — ${count} artifacts generated below.`;
    logger.info(`[Tools] Terminal turn completed with ${count} artifact(s); streaming status marker (no summary LLM call)`);
    callbacks?.onChunk?.(statusLine);
    // Ensure responseMessage.content carries the marker so callers that read
    // `content` (e.g. the agent invoker's rawOutput) see it instead of ''.
    responseMessage = {
      ...responseMessage,
      content: (responseMessage.content ? responseMessage.content + '\n\n' : '') + statusLine,
    };
  }

  return {
    content: responseMessage.content || '',
    toolCalls: responseMessage.tool_calls as ToolCall[] | undefined,
    fullHistory: messages,
    cacheKey: ctx.cache.key,
    cacheable: ctx.cache.isCacheable,
    toolExecutionResults,
    totalTokens: accumulatedTokens,
  };
}


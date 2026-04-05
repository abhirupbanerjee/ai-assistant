import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { isThinkTagModel } from '@/lib/services/model-discovery';
import type { Message, ToolCall, StreamingCallbacks, MessageVisualization, GeneratedDocumentInfo, GeneratedImageInfo, ImageContent, DiagramHint, PodcastHint } from '@/types';
import type { ToolExecutionRecord, FailureType } from '@/types/compliance';
import type { ImageCapabilities } from '@/lib/config-capability-checker';
import { getLlmSettings, getEmbeddingSettings, getLimitsSettings, getEffectiveMaxTokens, isToolCapableModelFromDb } from './db/compat/config';
import { isModelParallelToolCapable } from './db/compat/enabled-models';
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
import { getApiKey, getApiBase } from '@/lib/provider-helpers';

/**
 * Terminal tools that should stop the tool loop after successful execution.
 * These tools produce final outputs (images, documents) and should not be called again
 * unless the user explicitly requests it.
 */
export const TERMINAL_TOOLS = new Set(['image_gen', 'doc_gen', 'chart_gen', 'diagram_gen', 'podcast_gen']);

/**
 * Generate a prompt for the LLM to summarize a terminal tool result.
 * Works generically for any terminal tool.
 */
function getTerminalToolSummaryPrompt(toolName: string): string {
  // Convert tool name to human-readable format (e.g., "image_gen" -> "image generation")
  const toolLabel = toolName
    .replace(/_gen$/, ' generation')
    .replace(/_/g, ' ');

  return `The ${toolLabel} tool has completed successfully. Based on the tool result above, provide a brief, helpful summary (1-2 sentences) explaining what was created. Mention key details like the output type/format and how the user can access or download it. Do not use markdown formatting.`;
}

let openaiClient: OpenAI | null = null;

async function getOpenAI(): Promise<OpenAI> {
  if (!openaiClient) {
    // When using LiteLLM proxy, use LITELLM_MASTER_KEY for authentication
    // Otherwise use centralized provider helper (DB-first, then env var fallback)
    const apiKey = process.env.OPENAI_BASE_URL
      ? (process.env.LITELLM_MASTER_KEY || await getApiKey('openai'))
      : await getApiKey('openai');

    openaiClient = new OpenAI({
      apiKey: apiKey || undefined,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      timeout: 300 * 1000, // 5 minutes — matches maxDuration in route.ts and LiteLLM request_timeout
    });
  }
  return openaiClient;
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

let anthropicClient: Anthropic | null = null;

async function getAnthropicClient(): Promise<Anthropic> {
  if (!anthropicClient) {
    const apiKey = await getApiKey('anthropic');
    anthropicClient = new Anthropic({
      apiKey: apiKey || undefined,
      timeout: 300 * 1000, // 5 minutes — matches LiteLLM/OpenAI timeout
    });
  }
  return anthropicClient;
}

// ============ Fireworks Direct Client ============

/**
 * Check if a model ID refers to a Fireworks AI model.
 * These models bypass LiteLLM and connect directly to api.fireworks.ai.
 */
export function isFireworksModel(model: string): boolean {
  return model.startsWith('fireworks/');
}

let fireworksClient: OpenAI | null = null;

async function getFireworksClient(): Promise<OpenAI> {
  if (!fireworksClient) {
    const apiKey = await getApiKey('fireworks');
    fireworksClient = new OpenAI({
      apiKey: apiKey || undefined,
      baseURL: 'https://api.fireworks.ai/inference/v1',
      timeout: 300 * 1000, // 5 minutes ��� matches LiteLLM/OpenAI/Anthropic timeout
    });
  }
  return fireworksClient;
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
  return model.startsWith('ollama-') || model.startsWith('ollama/');
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

let ollamaClient: OpenAI | null = null;

async function getOllamaClient(): Promise<OpenAI> {
  if (!ollamaClient) {
    const apiBase = await getApiBase('ollama');
    const baseURL = ((apiBase || 'http://localhost:11434').replace(/\/v1\/?$/, '')) + '/v1';
    ollamaClient = new OpenAI({
      apiKey: 'ollama', // Ollama doesn't require a real API key
      baseURL,
      timeout: 300 * 1000, // 5 minutes — matches other clients
    });
  }
  return ollamaClient;
}

/**
 * Add LiteLLM provider prefix to non-OpenAI embedding model names.
 * LiteLLM requires prefixes like `gemini/` or `mistral/` to route correctly.
 * Only applies when using LiteLLM proxy (OPENAI_BASE_URL is set).
 */
function getLiteLLMEmbeddingModelId(model: string): string {
  if (!process.env.OPENAI_BASE_URL) return model;
  const modelDef = getEmbeddingModelById(model);
  if (modelDef && modelDef.provider !== 'openai') {
    return `${modelDef.provider}/${model}`;
  }
  return model;
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
      recordTokenUsage({
        category: 'embeddings',
        model,
        totalTokens: response.usage?.total_tokens ?? Math.ceil(text.length / 4),
      });
      return response.data[0].embedding;
    }

    // Cloud provider path (OpenAI, Mistral, Gemini via LiteLLM)
    const openai = await getOpenAI();
    const litellmModel = getLiteLLMEmbeddingModelId(model);
    const response = await openai.embeddings.create({
      model: litellmModel,
      input: text,
    });
    recordTokenUsage({
      category: 'embeddings',
      model,
      totalTokens: response.usage?.total_tokens ?? Math.ceil(text.length / 4),
    });
    return response.data[0].embedding;
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

      const openai = await getOpenAI();
      const litellmModel = getLiteLLMEmbeddingModelId(fallbackModel);
      const response = await openai.embeddings.create({
        model: litellmModel,
        input: text,
      });
      return response.data[0].embedding;
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
      recordTokenUsage({
        category: 'embeddings',
        model,
        totalTokens: response.usage?.total_tokens ?? texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
      });
      if (embeddings.length > 0) {
        console.log(`[Embedding] Fireworks direct — Model: ${fwModel}, Dimensions: ${embeddings[0].length}, Count: ${embeddings.length}`);
      }
      return embeddings;
    }

    // Cloud provider path (OpenAI, Mistral, Gemini via LiteLLM)
    const openai = await getOpenAI();
    const litellmModel = getLiteLLMEmbeddingModelId(model);
    const response = await openai.embeddings.create({
      model: litellmModel,
      input: texts,
    });
    const embeddings = response.data.map(d => d.embedding);
    recordTokenUsage({
      category: 'embeddings',
      model,
      totalTokens: response.usage?.total_tokens ?? texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0),
    });
    // Debug: Log embedding dimensions
    if (embeddings.length > 0) {
      console.log(`[Embedding] Model: ${model}, Dimensions: ${embeddings[0].length}, Count: ${embeddings.length}`);
    }
    return embeddings;
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

      const openai = await getOpenAI();
      const litellmModel = getLiteLLMEmbeddingModelId(fallbackModel);
      const response = await openai.embeddings.create({
        model: litellmModel,
        input: texts,
      });
      return response.data.map(d => d.embedding);
    }

    // No fallback or fallback is same as primary - rethrow
    throw error;
  }
}

export async function generateResponse(
  systemPrompt: string,
  conversationHistory: Message[],
  context: string,
  userMessage: string
): Promise<string> {
  // Get LLM settings from database config
  const llmSettings = await getLlmSettings();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Add conversation history (last N messages)
  const recentHistory = conversationHistory.slice(-DEFAULT_CONVERSATION_HISTORY_LIMIT);
  for (const msg of recentHistory) {
    // Skip tool messages in non-tool-calling flow
    if (msg.role === 'tool') continue;

    messages.push({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    });
  }

  // Add context and current question
  messages.push({
    role: 'user',
    content: `Organizational Knowledge Base:\n${context}\n\n---\n\nQuestion: ${userMessage}`,
  });

  const isOllama = isOllamaModel(llmSettings.model);
  const openai = isOllama ? await getOllamaClient() : await getOpenAI();

  // Get effective max tokens (uses per-model override if configured, otherwise preset default)
  const effectiveMaxTokens = await getEffectiveMaxTokens(llmSettings.model);

  const response = await openai.chat.completions.create({
    model: isOllama ? getOllamaModelId(llmSettings.model) : llmSettings.model,
    messages,
    max_tokens: effectiveMaxTokens,
    temperature: llmSettings.temperature,
    ...(isOllama && { num_ctx: OLLAMA_NUM_CTX }),
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);

  return response.choices[0].message.content || '';
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
  },
  onChunk?: (text: string) => void,
  onThinkingChunk?: (text: string) => void,
): Promise<{ content: string | null; tool_calls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] | undefined; thinkingContent: string | null; stopReason: string | null; totalTokens: number }> {
  const controller = new AbortController();
  let wasAborted = false;

  const streamingConfig = await getStreamingConfigMs();
  const interChunkTimeoutMs = streamingConfig.TOOL_TIMEOUT_MS;

  let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    logger.warn('Anthropic streaming timed out waiting for first chunk', { model: params.model });
    wasAborted = true;
    controller.abort();
  }, FIRST_CHUNK_TIMEOUT_MS);

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
): Promise<{ content: string | null; tool_calls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] | undefined; thinkingContent: string | null; totalTokens: number }> {
  const controller = new AbortController();
  // OpenAI SDK v6+ silently swallows AbortError in its stream iterator
  // (returns instead of throwing), so we track abort state explicitly
  let wasAborted = false;

  // Use DB-configurable inter-chunk timeout (default 120s, was hardcoded 60s)
  const streamingConfig = await getStreamingConfigMs();
  const interChunkTimeoutMs = streamingConfig.TOOL_TIMEOUT_MS;

  // Ollama models get a longer first-chunk timeout for CPU cold-start
  const isOllama = params.model?.startsWith('ollama-') || params.model?.startsWith('ollama/');
  const firstChunkTimeout = isOllama ? FIRST_CHUNK_TIMEOUT_OLLAMA_MS : FIRST_CHUNK_TIMEOUT_MS;

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
  enableClarification?: boolean  // Inject request_clarification meta-tool when preflight skill is active
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

  // Detect direct-route models — bypass LiteLLM
  const useAnthropicDirect = isClaudeModel(effectiveModel);
  const useFireworksDirect = isFireworksModel(effectiveModel);
  const useOllamaDirect = isOllamaModel(effectiveModel);
  const routeLabel = useAnthropicDirect ? 'Anthropic SDK directly'
    : useFireworksDirect ? 'Fireworks AI directly'
    : useOllamaDirect ? 'Ollama directly'
    : 'LiteLLM/OpenAI path';
  console.log(`[Chat] Using ${routeLabel} for model: ${effectiveModel}`);
  const openai = useAnthropicDirect ? null
    : useFireworksDirect ? await getFireworksClient()
    : useOllamaDirect ? await getOllamaClient()
    : await getOpenAI();
  const anthropicClient = useAnthropicDirect ? await getAnthropicClient() : null;

  // Check if model supports tools, disable gracefully if not
  // Use DB-aware check so models added via admin UI (enabled_models) are recognized
  const modelSupportsTools = await isToolCapableModelFromDb(effectiveModel);
  const effectiveEnableTools = enableTools && modelSupportsTools;

  if (enableTools && !modelSupportsTools) {
    logger.warn(`Model ${effectiveModel} does not support tools, disabling`);
  }

  // Build unified conversation context with anchors, follow-up detection, and cache keys
  const limitsSettings = await getLimitsSettings();
  const ctx = buildConversationContext(conversationHistory, userMessage, {
    maxMessages: limitsSettings.conversationHistoryMessages,
    maxTokens: 6000,
    summaryContext,
    memoryContext,
    categorySlugs,
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

  // Format user message with proper context ordering (follow-up hint, summary, RAG)
  const textContent = formatUserMessage(ctx, context, userMessage);

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

  // Get effective max tokens (uses per-model override if configured, otherwise preset default)
  const effectiveMaxTokens = await getEffectiveMaxTokens(effectiveModel);

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
    // Ollama doesn't support forced tool_choice — downgrade to auto
    if (typeof effectiveToolChoice === 'object') {
      effectiveToolChoice = 'auto' as const;
    }
    logger.info('Ollama context configured', {
      model: effectiveModel,
      num_ctx: OLLAMA_NUM_CTX,
      max_tokens: effectiveMaxTokens,
    });
  }

  // Reasoning models (DeepSeek-R1, QwQ, etc.) may not support tool_choice — downgrade to auto
  if (isThinkTagModel(effectiveModel) && typeof effectiveToolChoice === 'object') {
    effectiveToolChoice = 'auto' as const;
    logger.info('Downgraded tool_choice for reasoning model', { model: effectiveModel });
  }

  // Inject request_clarification meta-tool when preflight skill is active.
  // Skipped for Ollama: small models struggle with meta-tools and context is already tight.
  if (enableClarification && modelSupportsTools && !isOllama) {
    tools = [...(tools || []), REQUEST_CLARIFICATION_TOOL];
  }

  const completionParams: Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, 'stream'> = {
    model: useOllamaDirect ? getOllamaModelId(effectiveModel) : effectiveModel,
    messages,
    tools,
    tool_choice: tools?.length ? effectiveToolChoice : undefined,
    max_tokens: effectiveMaxTokens,
    temperature: llmSettings.temperature,
    ...(isOllama && { num_ctx: OLLAMA_NUM_CTX }),
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
        temperature: llmSettings.temperature,
        tools: convertToolsToAnthropic(tools),
        tool_choice: tools?.length ? convertToolChoiceToAnthropic(effectiveToolChoice) : undefined,
      },
      callbacks?.onChunk,
      callbacks?.onThinkingChunk,
    );
    responseMessage = anthropicResult;
    accumulatedTokens += anthropicResult.totalTokens;
  } else {
    responseMessage = await streamOneCompletion(openai!, completionParams, callbacks?.onChunk, callbacks?.onThinkingChunk);
    accumulatedTokens += responseMessage.totalTokens;
  }

  // Tool call loop (max iterations to prevent runaway)
  // Load tool call limits from DB (defaults: 50 total, 10 per tool)
  const { maxTotalToolCalls, maxPerToolCalls } = await getLimitsSettings();

  let iterations = 0;
  let totalToolCalls = 0;
  const toolCallCounts = new Map<string, number>();
  let terminalToolSucceeded = false;
  let terminalToolResult: { toolName: string; parsedResult: Record<string, unknown> } | null = null;

  // Collect tool execution results for compliance checking
  const toolExecutionResults: ToolExecutionRecord[] = [];

  // Check if this model supports parallel tool execution
  const parallelToolCapable = await isModelParallelToolCapable(effectiveModel);

  while (responseMessage.tool_calls && totalToolCalls < maxTotalToolCalls && !terminalToolSucceeded) {
    iterations++;
    logger.debug(`Tool call iteration ${iterations}, total calls ${totalToolCalls}/${maxTotalToolCalls}`);

    // Add assistant's tool call message (OpenAI format for fullHistory)
    messages.push({
      role: 'assistant',
      content: responseMessage.content,
      tool_calls: responseMessage.tool_calls,
    });

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
    const processToolResult = (
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
              }
              if (parsed.success && parsed.podcastHint) {
                callbacks.onArtifact('podcast', parsed.podcastHint);
              }
            } catch (artifactError) {
              logger.error(`Artifact callback error for tool ${toolName}:`, artifactError);
            }
          }

          // Check if terminal tool succeeded
          if (TERMINAL_TOOLS.has(toolName) && parsed.success) {
            logger.debug(`Terminal tool ${toolName} succeeded, stopping tool loop`);
            terminalToolSucceeded = true;
            terminalToolResult = { toolName, parsedResult: parsed };
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
        logger.debug(`Executing tool: ${toolName}`);
        callbacks?.onToolStart?.(toolName, displayName);

        let result: string;
        let success = true;
        let errorMsg: string | undefined;

        try {
          const configOverride = toolConfigOverrides.get(toolName);
          result = await executeTool(toolName, toolCall.function.arguments, configOverride);
        } catch (error) {
          success = false;
          errorMsg = error instanceof Error ? error.message : 'Unknown error';
          result = JSON.stringify({ error: errorMsg, errorCode: 'EXECUTION_ERROR' });
        }

        processToolResult(toolName, toolCall.id, result, success, errorMsg, startTime);
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
          try {
            const result = await executeTool(tc.function.name, tc.function.arguments, configOverride);
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
          processToolResult(toolName, tc.id, result, success, errorMsg, startTime);
        } else {
          // Should not happen since we catch inside the map, but handle gracefully
          const errorMsg = settled.reason instanceof Error ? settled.reason.message : 'Unknown error';
          const result = JSON.stringify({ error: errorMsg, errorCode: 'EXECUTION_ERROR' });
          processToolResult(toolName, tc.id, result, false, errorMsg, Date.now());
        }
      }
    }

    // Push all tool results as a single Anthropic 'user' message
    if (useAnthropicDirect && anthropicToolResults.length > 0) {
      anthropicMessages.push({ role: 'user', content: anthropicToolResults });
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
          temperature: llmSettings.temperature,
          tools: convertToolsToAnthropic(tools),
          tool_choice: toolChoiceAppliedByRouting
            ? convertToolChoiceToAnthropic('auto')
            : convertToolChoiceToAnthropic(effectiveToolChoice),
        },
        callbacks?.onChunk,
        callbacks?.onThinkingChunk,
      );
      accumulatedTokens += responseMessage.totalTokens;
    } else {
      responseMessage = await streamOneCompletion(
        openai!,
        {
          ...completionParams,
          messages,
          tool_choice: toolChoiceAppliedByRouting ? 'auto' : completionParams.tool_choice,
        },
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
          temperature: llmSettings.temperature,
          // No tools — force text-only response
        },
        callbacks?.onChunk,
        callbacks?.onThinkingChunk,
      );
      accumulatedTokens += responseMessage.totalTokens;
    } else {
      const finalMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        ...messages,
        { role: 'user' as const, content: maxToolsMsg },
      ];
      responseMessage = await streamOneCompletion(
        openai!,
        {
          model: completionParams.model,
          messages: finalMessages,
          max_tokens: completionParams.max_tokens,
          temperature: completionParams.temperature,
          tools: completionParams.tools,
          tool_choice: 'none',
        },
        callbacks?.onChunk,
        callbacks?.onThinkingChunk,
      );
      accumulatedTokens += responseMessage.totalTokens;
    }
  }

  // Generate LLM summary for terminal tool success
  // terminalToolResult is set inside processToolResult closure — TS can't track this
  const finalTerminalResult = terminalToolResult as { toolName: string; parsedResult: Record<string, unknown> } | null;
  if (terminalToolSucceeded && finalTerminalResult) {
    const summaryPrompt = getTerminalToolSummaryPrompt(finalTerminalResult.toolName);

    logger.debug(`Generating summary for terminal tool: ${finalTerminalResult.toolName}`);

    if (useAnthropicDirect && anthropicClient) {
      anthropicMessages.push({ role: 'user', content: summaryPrompt });
      const summaryResponse = await streamAnthropicCompletion(
        anthropicClient,
        {
          model: getAnthropicModelId(effectiveModel),
          messages: anthropicMessages,
          system: systemPrompt,
          max_tokens: effectiveMaxTokens,
          temperature: llmSettings.temperature,
          tools: convertToolsToAnthropic(tools),
          // Don't set tool_choice — Anthropic handles this via the message flow
        },
        callbacks?.onChunk,
        callbacks?.onThinkingChunk,
      );
      responseMessage = summaryResponse;
      accumulatedTokens += summaryResponse.totalTokens;
    } else {
      // Add the summary request to messages (tool result already present from tool execution)
      const summaryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        ...messages,
        { role: 'user' as const, content: summaryPrompt },
      ];

      // Make final LLM call for summary
      // Anthropic requires tools array when messages contain tool_calls/tool responses
      // Use tool_choice: 'none' to prevent new tool calls
      const summaryResponse = await streamOneCompletion(
        openai!,
        {
          model: completionParams.model,
          messages: summaryMessages,
          max_tokens: completionParams.max_tokens,
          temperature: completionParams.temperature,
          tools: completionParams.tools,
          tool_choice: 'none',
        },
        callbacks?.onChunk,
        callbacks?.onThinkingChunk,
      );
      responseMessage = summaryResponse;
      accumulatedTokens += summaryResponse.totalTokens;
    }
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

export async function transcribeAudio(audioBuffer: Buffer, filename: string): Promise<{ text: string; duration: number }> {
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/webm' });
  const file = new File([blob], filename, { type: 'audio/webm' });

  const openai = await getOpenAI();
  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    response_format: 'verbose_json',
  });

  return {
    text: response.text,
    duration: response.duration || 0,
  };
}

export default getOpenAI;

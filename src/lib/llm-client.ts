/**
 * Internal LLM Client
 *
 * Shared utility for internal services (memory extraction, summarization,
 * prompt optimization, translation) with multi-route fallback.
 *
 * Route 1: LiteLLM proxy (OpenAI, Gemini, Mistral)
 * Route 2: DeepSeek direct + Moonshot AI direct + Claude (Anthropic) direct
 * Route 3: Ollama direct (local / air-gapped)
 * Route 4: Ollama Cloud direct (hosted models)
 * Route 5: Aggregator gateways (Azure AI Foundry, Fireworks AI, Ollama Cloud)
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getLlmSettings, getRoutesSettings } from './db/compat/config';
import { getApiKey, getApiBase } from '@/lib/provider-helpers';
import { isOllamaCloudModel, getOllamaCloudModelId, callOllamaCloud } from './services/ollama-cloud';
import { isAzureFoundryModel, getAzureFoundryClient, resetAzureFoundryClient, stripAzureFoundryPrefix } from './llm/providers/azure-foundry';
import { isMistralModel, stripMistralPrefix, callMistralChat } from './llm/providers/mistral';
import { isGeminiModel, stripGeminiPrefix, callGeminiChat } from './llm/providers/gemini';
import { isOpenAIModel, stripOpenAIPrefix, callOpenAIChat } from './llm/providers/openai';
import { getTemperatureForModel } from './llm-thinking';


const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const FIREWORKS_FALLBACK_MODEL = 'fireworks/minimax-m2p5';
const DEEPSEEK_FALLBACK_MODEL = 'deepseek-v4-flash';
const MOONSHOT_FALLBACK_MODEL = 'moonshot/kimi-k2p5';
const CLAUDE_FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

// Strip <think>…</think> reasoning blocks that thinking-mode models emit before
// the actual response. Without this, downstream JSON parsers choke on the
// reasoning prose. Mirrors extractThinkTags() in agent/llm-router.ts.
function stripThinkTags(content: string): string {
  if (!content) return content;
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^\s+/, '');
}

// ============ Types ============

export interface InternalCompletionOptions {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Optional callback invoked with token usage data after a successful completion. */
  onUsage?: (usage: { inputTokens: number; outputTokens: number; model: string }) => void;
  /** Optional JSON schema for Gemini native responseSchema enforcement. Ignored by non-Gemini providers. */
  responseSchema?: object;
  /** Optional response_format for OpenAI-native structured output. Passed directly to the OpenAI API. */
  responseFormat?: { type: 'json_object' | 'text' } | { type: 'json_schema'; json_schema: { name: string; schema: object; strict?: boolean } };
}

// ============ Usage helper ============

function emitUsage(
  opts: InternalCompletionOptions,
  usage: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number } | undefined,
  model: string,
): void {
  if (!opts.onUsage || !usage) return;
  const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  if (inputTokens > 0 || outputTokens > 0) {
    opts.onUsage({ inputTokens, outputTokens, model });
  }
}

// ============ Clients (lazy singletons) ============

let litellmClient: OpenAI | null = null;
let fireworksClient: OpenAI | null = null;
let anthropicClient: Anthropic | null = null;
let ollamaClient: OpenAI | null = null;
let moonshotClient: OpenAI | null = null;
let deepseekClient: OpenAI | null = null;

/**
 * @deprecated This legacy client routes through LiteLLM proxy. All OpenAI/Gemini/Mistral
 * models now use direct Route 2 providers. This function remains as a safety-net fallback
 * for unrecognized models and will be removed when LiteLLM is fully retired.
 */
async function getLiteLLMClient(): Promise<OpenAI> {
  if (!litellmClient) {
    const baseURL = process.env.OPENAI_BASE_URL || undefined;
    const apiKey = process.env.OPENAI_BASE_URL
      ? (process.env.LITELLM_MASTER_KEY || await getApiKey('openai'))
      : await getApiKey('openai');
    litellmClient = new OpenAI({ baseURL, apiKey: apiKey || '' });
  }
  return litellmClient;
}

async function getFireworksClient(): Promise<OpenAI> {
  if (!fireworksClient) {
    const apiKey = await getApiKey('fireworks');
    fireworksClient = new OpenAI({
      apiKey: apiKey || undefined,
      baseURL: FIREWORKS_BASE_URL,
    });
  }
  return fireworksClient;
}

async function getAnthropicClient(): Promise<Anthropic> {
  if (!anthropicClient) {
    const apiKey = await getApiKey('anthropic');
    anthropicClient = new Anthropic({ apiKey: apiKey || undefined });
  }
  return anthropicClient;
}

async function getOllamaClient(): Promise<OpenAI> {
  if (!ollamaClient) {
    const apiBase = await getApiBase('ollama');
    const baseURL = ((apiBase || 'http://localhost:11434').replace(/\/v1\/?$/, '')) + '/v1';
    ollamaClient = new OpenAI({
      apiKey: 'ollama',
      baseURL,
    });
  }
  return ollamaClient;
}

async function getMoonshotClient(): Promise<OpenAI> {
  if (!moonshotClient) {
    const apiKey = await getApiKey('moonshot');
    const { getMoonshotBaseUrl } = await import('./moonshot-config');
    moonshotClient = new OpenAI({
      apiKey: apiKey || undefined,
      baseURL: await getMoonshotBaseUrl(),
    });
  }
  return moonshotClient;
}

async function getDeepSeekClient(): Promise<OpenAI> {
  if (!deepseekClient) {
    const apiKey = await getApiKey('deepseek');
    const apiBase = await getApiBase('deepseek');
    const baseURL = (apiBase || DEEPSEEK_BASE_URL).replace(/\/+$/, '');
    deepseekClient = new OpenAI({
      apiKey: apiKey || undefined,
      baseURL,
    });
  }
  return deepseekClient;
}

/** Reset all cached LLM clients so they re-read API keys on next use */
export function resetLlmClients(): void {
  litellmClient = null;
  fireworksClient = null;
  anthropicClient = null;
  ollamaClient = null;
  moonshotClient = null;
  deepseekClient = null;
  resetAzureFoundryClient();
}

// ============ Provider Callers ============

async function callLiteLLM(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getLiteLLMClient();
  // Non-streaming OpenAI API requires stream=true for max_tokens > 4096.
  // Cap at 4096 to avoid the error: "Requests with max_tokens > 4096 must have stream=true"
  const maxTokens = Math.min(opts.maxTokens ?? 2000, 4096);
  const baseTemp = opts.temperature ?? 0.3;
  const response = await client.chat.completions.create({
    model,
    messages: opts.messages,
    temperature: getTemperatureForModel(model, baseTemp),
    max_tokens: maxTokens,
  });
  emitUsage(opts, response.usage, model);
  return stripThinkTags(response.choices[0]?.message?.content?.trim() || '');
}

async function callFireworks(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getFireworksClient();
  const fireworksModel = model.startsWith('fireworks/')
    ? `accounts/fireworks/models/${model.slice('fireworks/'.length)}`
    : model;
  // Non-streaming OpenAI-compatible API requires stream=true for max_tokens > 4096.
  // Cap at 4096 to avoid the error: "Requests with max_tokens > 4096 must have stream=true"
  const maxTokens = Math.min(opts.maxTokens ?? 2000, 4096);
  const baseTemp = opts.temperature ?? 0.3;
  const response = await client.chat.completions.create({
    model: fireworksModel,
    messages: opts.messages,
    temperature: getTemperatureForModel(model, baseTemp),
    max_tokens: maxTokens,
  });
  emitUsage(opts, response.usage, model);
  return stripThinkTags(response.choices[0]?.message?.content?.trim() || '');
}

async function callAnthropic(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getAnthropicClient();
  // Separate system message from conversation messages
  const systemMsg = opts.messages.find(m => m.role === 'system')?.content || '';
  const conversationMsgs = opts.messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const baseTemp = opts.temperature ?? 0.3;
  const response = await client.messages.create({
    model: model.startsWith('anthropic/') ? model.slice('anthropic/'.length) : model,
    system: systemMsg || undefined,
    messages: conversationMsgs,
    max_tokens: opts.maxTokens ?? 2000,
    temperature: getTemperatureForModel(model, baseTemp),
  });

  emitUsage(opts, { input_tokens: response.usage?.input_tokens, output_tokens: response.usage?.output_tokens }, model);
  const textBlock = response.content.find(b => b.type === 'text');
  return stripThinkTags(textBlock?.text?.trim() || '');
}

async function callOllama(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getOllamaClient();
  // Strip ollama- or ollama/ prefix for the API call
  const ollamaModel = model.startsWith('ollama/') ? model.slice('ollama/'.length)
    : model.startsWith('ollama-') ? model.slice('ollama-'.length)
    : model;
  const baseTemp = opts.temperature ?? 0.3;
  const response = await client.chat.completions.create({
    model: ollamaModel,
    messages: opts.messages,
    temperature: getTemperatureForModel(model, baseTemp),
    max_tokens: opts.maxTokens ?? 2000,
  });
  emitUsage(opts, response.usage, model);
  return stripThinkTags(response.choices[0]?.message?.content?.trim() || '');
}

async function callMoonshot(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getMoonshotClient();
  const moonshotModel = model.startsWith('moonshot/') ? model.slice('moonshot/'.length) : model;
  // Non-streaming OpenAI-compatible API may require stream=true for max_tokens > 4096.
  // Cap at 4096 to avoid the error.
  const maxTokens = Math.min(opts.maxTokens ?? 2000, 4096);
  const baseTemp = opts.temperature ?? 0.3;
  const response = await client.chat.completions.create({
    model: moonshotModel,
    messages: opts.messages,
    temperature: getTemperatureForModel(model, baseTemp),
    max_tokens: maxTokens,
  });
  emitUsage(opts, response.usage, model);
  return stripThinkTags(response.choices[0]?.message?.content?.trim() || '');
}

async function callDeepSeek(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getDeepSeekClient();
  const deepseekModel = model.startsWith('deepseek/') ? model.slice('deepseek/'.length) : model;
  const maxTokens = Math.min(opts.maxTokens ?? 2000, 4096);
  const baseTemp = opts.temperature ?? 0.3;
  const response = await client.chat.completions.create({
    model: deepseekModel,
    messages: opts.messages,
    temperature: getTemperatureForModel(model, baseTemp),
    max_tokens: maxTokens,
  });
  emitUsage(opts, response.usage, model);
  return stripThinkTags(response.choices[0]?.message?.content?.trim() || '');
}

/**
 * Call Ollama Cloud for non-streaming internal completions.
 * Uses the native /api/chat endpoint via callOllamaCloud().
 */
async function callOllamaCloudDirect(model: string, opts: InternalCompletionOptions): Promise<string> {
  const baseTemp = opts.temperature ?? 0.3;
  const response = await callOllamaCloud(model, opts.messages, {
    temperature: getTemperatureForModel(model, baseTemp),
    maxTokens: opts.maxTokens,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Ollama Cloud API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { message?: { content: string } };
  return stripThinkTags(data.message?.content?.trim() || '');
}

/**
 * Call Azure AI Foundry (Route 5) — OpenAI-compatible API
 */
async function callAzureFoundry(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getAzureFoundryClient();
  const baseTemp = opts.temperature ?? 0.3;
  // Strip azure-foundry/ prefix for temperature lookup (bare model name used in overrides)
  const cleanModel = stripAzureFoundryPrefix(model);
  const response = await client.chat.completions.create({
    model, // Provider strips prefix internally for API call
    messages: opts.messages.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    })),
    temperature: getTemperatureForModel(cleanModel, baseTemp),
    max_tokens: opts.maxTokens ?? 4096,
  });
  const result = response.choices[0]?.message?.content || '';
  emitUsage(opts, response.usage, model);
  return result;
}

// ============ Route Classification ============

function isClaudeModel(model: string): boolean {
  return model.startsWith('anthropic/') || model.startsWith('claude-');
}

function isFireworksModel(model: string): boolean {
  return model.startsWith('fireworks/');
}

function isOllamaModel(model: string): boolean {
  return model.startsWith('ollama-') || model.startsWith('ollama/');
}

function isOllamaCloudModelFn(model: string): boolean {
  return isOllamaCloudModel(model);
}

function isMoonshotModel(model: string): boolean {
  return model.startsWith('moonshot/');
}

function isDeepSeekModel(model: string): boolean {
  return model.startsWith('deepseek-') || model.startsWith('deepseek/');
}

// ============ Main Entry Point ============

/**
 * Create a completion using the configured LLM route with automatic fallback.
 *
 * - Route 2 models (Fireworks, DeepSeek, Moonshot, Claude) always go direct.
 * - Route 3 models (Ollama) always go direct.
 * - Route 1 models go via LiteLLM; on failure, fall back to Route 2/3 if enabled.
 */
export async function createInternalCompletion(opts: InternalCompletionOptions): Promise<string> {
  const model = opts.model || (await getLlmSettings()).model;
  const routes = await getRoutesSettings();

  // Route 2 models → always direct, no LiteLLM involved
  if (isClaudeModel(model)) {
    return callAnthropic(model, opts);
  }
  if (isFireworksModel(model)) {
    return callFireworks(model, opts);
  }
  if (isMoonshotModel(model)) return callMoonshot(model, opts);
  if (isDeepSeekModel(model)) return callDeepSeek(model, opts);
  if (isMistralModel(model)) {
    const result = await callMistralChat(model, opts.messages as Array<{ role: string; content: string }>, {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
    });
    return result.content;
  }
  if (isGeminiModel(model)) {
    const result = await callGeminiChat(model, opts.messages, {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      ...(opts.responseSchema && { responseSchema: opts.responseSchema }),
    });
    return result.content;
  }
  if (isOpenAIModel(model)) {
    const result = await callOpenAIChat(model, opts.messages, {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      ...(opts.responseSchema && { responseSchema: opts.responseSchema }),
      ...(opts.responseFormat && { responseFormat: opts.responseFormat }),
    });
    return result.content;
  }

  // Route 3 models → always direct to Ollama
  if (isOllamaModel(model)) {
    return callOllama(model, opts);
  }

  // Route 4 models → always direct to Ollama Cloud
  if (isOllamaCloudModelFn(model)) {
    return callOllamaCloudDirect(model, opts);
  }

  // Route 5 models → aggregator gateways
  if (isAzureFoundryModel(model)) {
    return callAzureFoundry(model, opts);
  }

  // Route 1 → try LiteLLM, fall back to Route 2/3/4/5 if enabled
  try {
    return await callLiteLLM(model, opts);
  } catch (err) {
    const hasRoute2 = routes.route2Enabled;
    const hasRoute3 = routes.route3Enabled;
    const hasRoute5 = routes.route5Enabled;
    if (!hasRoute2 && !hasRoute3 && !hasRoute5) throw err;

    console.warn('[llm-client] Route 1 failed, trying fallback routes:', err instanceof Error ? err.message : err);

    // Try Route 2 first (DeepSeek → Moonshot → Claude), then Route 3 (Ollama), then Route 5 (Fireworks)
    if (hasRoute2) {
      try {
        return await callFireworks(FIREWORKS_FALLBACK_MODEL, opts);
      } catch (fwErr) {
        console.warn('[llm-client] Fireworks fallback failed:', fwErr instanceof Error ? fwErr.message : fwErr);
        try {
          return await callDeepSeek(DEEPSEEK_FALLBACK_MODEL, opts);
        } catch (deepseekErr) {
          console.warn('[llm-client] DeepSeek fallback failed:', deepseekErr instanceof Error ? deepseekErr.message : deepseekErr);
          try {
            return await callMoonshot(MOONSHOT_FALLBACK_MODEL, opts);
          } catch (moonshotErr) {
            console.warn('[llm-client] Moonshot fallback failed:', moonshotErr instanceof Error ? moonshotErr.message : moonshotErr);
            try {
              return await callAnthropic(CLAUDE_FALLBACK_MODEL, opts);
            } catch (claudeErr) {
              console.warn('[llm-client] Claude fallback failed:', claudeErr instanceof Error ? claudeErr.message : claudeErr);
            }
          }
        }
      }
    }

    // Route 3 fallback (Ollama) — use default Ollama model
    if (hasRoute3) {
      console.warn('[llm-client] Trying Route 3 (Ollama) fallback');
      return await callOllama('ollama-llama3.2', opts);
    }

    // Route 5 fallback (aggregator gateways) — use Fireworks model
    if (hasRoute5) {
      console.warn('[llm-client] Trying Route 5 (Aggregator) fallback');
      return await callFireworks(FIREWORKS_FALLBACK_MODEL, opts);
    }

    throw err;
  }
}

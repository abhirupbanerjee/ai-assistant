/**
 * Internal LLM Client
 *
 * Shared utility for internal services (memory extraction, summarization,
 * prompt optimization, translation) with multi-route fallback.
 *
 * Route 2: Direct providers (DeepSeek, Moonshot, Claude/Anthropic, OpenAI, Mistral, Gemini)
 * Route 3: Ollama direct (local / air-gapped)
 * Route 5: Aggregator gateways (Azure AI Foundry, Fireworks AI, Ollama Cloud)
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getLlmSettings, getRoutesSettings } from './db/compat/config';
import { resolveProviderCredentialForRequest, sharedProviderClientFactory } from './provider-credential';
import { isOllamaCloudModel, getOllamaCloudModelId, callOllamaCloud } from './services/ollama-cloud';
import { isAzureFoundryModel, getAzureFoundryClient, resetAzureFoundryClient, stripAzureFoundryPrefix } from './llm/providers/azure-foundry';
import { isMistralModel, stripMistralPrefix, callMistralChat } from './llm/providers/mistral';
import { isGeminiModel, stripGeminiPrefix, callGeminiChat } from './llm/providers/gemini';
import { isOpenAIModel, stripOpenAIPrefix, callOpenAIChat } from './llm/providers/openai';
import { getTemperatureForModel, buildThinkingRequestProfile, isClaudeAdaptiveThinkingModel, isKimiK26Model } from './llm-thinking';
import { getModelOutputLimit } from './agent/llm-router';


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
  /** Use explicit no-thinking mode for short/background work. */
  reasoningMode?: 'enabled' | 'disabled';
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

// ============ Thinking-Model Helper ============

/**
 * Build thinking request params and a reasoning-aware token budget for a model.
 *
 * Thinking/reasoning models (DeepSeek V4 Pro, Claude Sonnet 5, Kimi K3, Gemini 2.5,
 * GPT-5, MiniMax M3, Ollama thinking models) consume reasoning tokens. The budget
 * strategy depends on the provider's billing model:
 *
 *   1. Separate-budget providers (Anthropic legacy budget_tokens, Gemini
 *      thinkingBudget): max_tokens is visible-only; the thinking budget is a
 *      separate parameter. No headroom is added to max_tokens.
 *   2. Adaptive-thinking models (Claude Sonnet 5/Opus 5/Fable 5/Opus 4.6+):
 *      budget_tokens is deprecated (returns 400). max_tokens is the hard ceiling
 *      on thinking + text combined; the effort parameter controls depth. We add
 *      adaptive headroom (requestedMax * ADAPTIVE_RATIO) to max_tokens.
 *   3. Shared-pool providers (DeepSeek, GPT-5, Kimi, MiniMax, Ollama, Mistral,
 *      Fireworks, Azure Foundry): reasoning counts against max_tokens. We add a
 *      scaled reasoning budget (requestedMax * REASONING_RATIO) with a floor and
 *      cap both at the model's max_output_tokens (from the enabled_models DB
 *      table, via getModelOutputLimit).
 *
 * The model's output ceiling is read from the DB (no hardcoding). Provider-prefix
 * fallbacks in getModelOutputLimit handle models not yet seeded in the DB.
 */
interface ThinkingCompletionParams {
  requestParams: Record<string, unknown>;
  maxTokens: number;
  enabled: boolean;
}

// Reasoning budget ratios (reasoning tokens relative to visible output tokens).
// Tuned for complex generation tasks (mermaid diagrams, conflict analysis, RAG
// summarization). Reasoning typically needs 2–3× the visible output for
// structural planning before emitting the final answer.
const REASONING_RATIO = 3.0;        // shared-pool providers: 3× visible output
const ADAPTIVE_RATIO = 2.0;         // adaptive-thinking Claude: 2× visible output
const FLOOR_REASONING = 2048;       // minimum viable reasoning even for tiny tasks
const MAX_THINKING_BUDGET_GEMINI = 32_768;          // Gemini 2.5 Pro documented max
const MAX_THINKING_BUDGET_ANTHROPIC_LEGACY = 40_960; // safety cap for budget_tokens
const FIREWORKS_NONSTREAMING_MAX_TOKENS = 4096;      // Fireworks transport cap (non-streaming)

function isClaudeModelId(modelId: string): boolean {
  return modelId.startsWith('anthropic/') || modelId.startsWith('claude-');
}

function isGeminiModelId(modelId: string): boolean {
  return modelId.startsWith('gemini-') || modelId.startsWith('gemini/');
}

async function getThinkingCompletionParams(
  model: string,
  requestedMax: number,
  reasoningMode: InternalCompletionOptions['reasoningMode'] = 'enabled',
): Promise<ThinkingCompletionParams> {
  const profile = buildThinkingRequestProfile({
    modelId: model,
    thinkingCapable: true,
    thinkingEnabled: reasoningMode === 'enabled',
    maxTokens: requestedMax,
  });
  if (!profile.enabled) {
    // Non-thinking models: keep the requested budget as-is (no reasoning
    // headroom needed). callFireworks streams when maxTokens > 4096
    // (mirroring generateFireworks), so no transport cap is needed here.
    return {
      requestParams: {},
      maxTokens: requestedMax,
      enabled: false,
    };
  }

  const outputCeiling = await getModelOutputLimit(model);
  const isAdaptive = isClaudeAdaptiveThinkingModel(model);
  const isClaudeLegacy = isClaudeModelId(model) && !isAdaptive;
  const isGemini = isGeminiModelId(model);
  // callFireworks now streams when maxTokens > 4096 (mirroring
  // generateFireworks in llm-router.ts:478), so the real ceiling is the
  // model's native output limit (max_output_tokens from DB), not the 4096
  // non-streaming transport cap. Use outputCeiling for all providers so the
  // reasoning budget formula has positive headroom on every retry.
  const transportCap = outputCeiling;

  // Kimi K2.6 shares max_tokens between visible output and retained reasoning.
  // Moonshot recommends at least 16K whenever thinking is enabled; lower
  // internal-service budgets were observed to exhaust on reasoning alone.
  if (isKimiK26Model(model)) {
    return {
      requestParams: profile.requestParams,
      maxTokens: Math.min(Math.max(requestedMax, 16_000), transportCap),
      enabled: true,
    };
  }

  // --- Separate-budget providers (Anthropic legacy, Gemini) ---
  // max_tokens is visible-only; the thinking budget is a separate parameter.
  if (isClaudeLegacy || isGemini) {
    const maxTokens = Math.min(requestedMax, transportCap);
    const requestParams = { ...profile.requestParams };
    if (isGemini) {
      // Gemini: thinkingBudget = -1 (auto) lets the model decide, up to its
      // documented max (32K for 2.5 Pro). The thinking budget is separate from
      // maxOutputTokens, so no headroom is added.
      requestParams.thinkingConfig = { thinkingBudget: -1 };
    } else {
      // Anthropic legacy (Opus 4.8 and earlier thinking models): budget_tokens
      // is capped at min(maxTokens - 1024, 40960). max_tokens is visible-only.
      const budget = Math.min(
        Math.max(1024, maxTokens - 1024),
        MAX_THINKING_BUDGET_ANTHROPIC_LEGACY,
      );
      requestParams.thinking = { type: 'enabled', budget_tokens: budget };
    }
    return { requestParams, maxTokens, enabled: true };
  }

  // --- Adaptive-thinking Claude (Sonnet 5, Opus 5, Fable 5, Opus 4.6+) ---
  // budget_tokens is deprecated and returns 400. max_tokens is the hard ceiling
  // on thinking + text + tool calls combined. The effort parameter (already set
  // in profile.requestParams by buildThinkingRequestProfile) controls depth.
  if (isAdaptive) {
    const reasoningHeadroom = Math.max(
      FLOOR_REASONING,
      Math.round(requestedMax * ADAPTIVE_RATIO),
    );
    const maxTokens = Math.min(requestedMax + reasoningHeadroom, transportCap);
    return { requestParams: profile.requestParams, maxTokens, enabled: true };
  }

  // --- Shared-pool providers (DeepSeek, GPT-5, Kimi, MiniMax, Ollama, Mistral,
  // Fireworks, Azure Foundry) ---
  // Reasoning tokens count against max_tokens. Add a scaled reasoning budget.
  const reasoningBudget = Math.min(
    Math.max(Math.round(requestedMax * REASONING_RATIO), FLOOR_REASONING),
    transportCap - requestedMax,
  );
  const maxTokens = Math.min(requestedMax + reasoningBudget, transportCap);
  return { requestParams: profile.requestParams, maxTokens, enabled: true };
}

/** Log a diagnostic when a thinking model returns empty visible content. */
function logEmptyThinkingResponse(provider: string, model: string, maxTokens: number, reasoningLength: number): void {
  console.warn(`[llm-client] ${provider} thinking model returned empty content`, {
    model,
    maxTokens,
    reasoningLength,
  });
}

// ============ Clients (ProviderClientFactory, keyed by credential) ============
//
// Phase D (plan §7): the module-scope lazy singletons were removed. Clients are
// built by the shared `ProviderClientFactory` (LRU keyed by
// credential_id + credential_version) using org-aware credential resolution, so
// a key replace/disable/rotation invalidates the cached client and multiple
// keys per provider are supported.

async function getFireworksClient(): Promise<OpenAI> {
  const cred = await resolveProviderCredentialForRequest('fireworks');
  const built = sharedProviderClientFactory.getClient({
    providerId: 'fireworks',
    credentialId: cred.credentialId,
    credentialVersion: cred.credentialVersion,
    apiKey: cred.apiKey,
    apiBase: FIREWORKS_BASE_URL,
  });
  if (built.kind !== 'openai') {
    throw new Error('ProviderClientFactory returned a non-OpenAI client for fireworks');
  }
  return built.client;
}

async function getAnthropicClient(): Promise<Anthropic> {
  const cred = await resolveProviderCredentialForRequest('anthropic');
  const built = sharedProviderClientFactory.getClient({
    providerId: 'anthropic',
    credentialId: cred.credentialId,
    credentialVersion: cred.credentialVersion,
    apiKey: cred.apiKey,
    apiBase: null,
  });
  if (built.kind !== 'anthropic') {
    throw new Error('ProviderClientFactory returned a non-Anthropic client for anthropic');
  }
  return built.client;
}

async function getOllamaClient(): Promise<OpenAI> {
  const cred = await resolveProviderCredentialForRequest('ollama');
  const baseURL = ((cred.apiBase || 'http://localhost:11434').replace(/\/v1\/?$/, '')) + '/v1';
  const built = sharedProviderClientFactory.getClient({
    providerId: 'ollama',
    credentialId: cred.credentialId,
    credentialVersion: cred.credentialVersion,
    apiKey: 'ollama',
    apiBase: baseURL,
  });
  if (built.kind !== 'openai') {
    throw new Error('ProviderClientFactory returned a non-OpenAI client for ollama');
  }
  return built.client;
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
  });
  if (built.kind !== 'openai') {
    throw new Error('ProviderClientFactory returned a non-OpenAI client for moonshot');
  }
  return built.client;
}

async function getDeepSeekClient(): Promise<OpenAI> {
  const cred = await resolveProviderCredentialForRequest('deepseek');
  const baseURL = (cred.apiBase || DEEPSEEK_BASE_URL).replace(/\/+$/, '');
  const built = sharedProviderClientFactory.getClient({
    providerId: 'deepseek',
    credentialId: cred.credentialId,
    credentialVersion: cred.credentialVersion,
    apiKey: cred.apiKey,
    apiBase: baseURL,
  });
  if (built.kind !== 'openai') {
    throw new Error('ProviderClientFactory returned a non-OpenAI client for deepseek');
  }
  return built.client;
}

/** Reset all cached LLM clients so they re-read API keys on next use */
export function resetLlmClients(): void {
  sharedProviderClientFactory.clear();
  resetAzureFoundryClient();
}

// ============ Provider Callers ============

async function callFireworks(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getFireworksClient();
  const fireworksModel = model.startsWith('fireworks/')
    ? `accounts/fireworks/models/${model.slice('fireworks/'.length)}`
    : model;
  // Thinking models (DeepSeek/Kimi hosted on Fireworks) need reasoning headroom.
  // getThinkingCompletionParams now uses the model's DB-driven output ceiling
  // (not the 4096 non-streaming cap) so retry escalation has positive headroom.
  const { requestParams, maxTokens, enabled } = await getThinkingCompletionParams(model, opts.maxTokens ?? 2000, opts.reasoningMode);
  const baseTemp = opts.temperature ?? 0.3;

  // Fireworks requires stream=true for max_tokens > 4096 (non-streaming
  // rejects larger values with an empty response). Mirror generateFireworks
  // in llm-router.ts:478. Streaming unlocks the model's real output limit
  // (up to 16384) and makes Phase 5's retry escalation actually work.
  if (maxTokens > FIREWORKS_NONSTREAMING_MAX_TOKENS) {
    const stream = await client.chat.completions.create({
      model: fireworksModel,
      messages: opts.messages,
      temperature: getTemperatureForModel(model, baseTemp),
      max_tokens: maxTokens,
      ...requestParams,
      stream: true,
      stream_options: { include_usage: true },
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);

    let content = '';
    let totalTokens = 0;
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta?.content || '';
      if (chunk.usage) totalTokens = chunk.usage.total_tokens;
    }
    emitUsage(opts, { total_tokens: totalTokens } as OpenAI.CompletionUsage, model);
    const visible = stripThinkTags(content.trim());
    if (visible) return visible;
    if (enabled) {
      logEmptyThinkingResponse('Fireworks', fireworksModel, maxTokens, 0);
    }
    return '';
  }

  // Non-streaming path (maxTokens <= 4096) — unchanged
  const response = await client.chat.completions.create({
    model: fireworksModel,
    messages: opts.messages,
    temperature: getTemperatureForModel(model, baseTemp),
    max_tokens: maxTokens,
    ...requestParams,
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  emitUsage(opts, response.usage, model);
  const message = response.choices[0]?.message;
  const visible = stripThinkTags(message?.content?.trim() || '');
  if (visible) return visible;
  if (enabled) {
    const reasoning = (message as unknown as Record<string, unknown>)?.reasoning_content;
    if (reasoning) {
      logEmptyThinkingResponse('Fireworks', fireworksModel, maxTokens, String(reasoning).length);
    }
  }
  return '';
}

async function callAnthropic(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getAnthropicClient();
  // Separate system message from conversation messages
  const systemMsg = opts.messages.find(m => m.role === 'system')?.content || '';
  const conversationMsgs = opts.messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // Thinking models (Claude Sonnet 5, Opus 4.7+, Fable 5) need reasoning headroom.
  const { requestParams, maxTokens, enabled } = await getThinkingCompletionParams(model, opts.maxTokens ?? 2000, opts.reasoningMode);
  const baseTemp = opts.temperature ?? 0.3;
  // Note: spreading thinking params makes the SDK infer a Stream|Message union,
  // so we type the response explicitly as a non-streaming Message.
  const response = await client.messages.create({
    model: model.startsWith('anthropic/') ? model.slice('anthropic/'.length) : model,
    system: systemMsg || undefined,
    messages: conversationMsgs,
    max_tokens: maxTokens,
    temperature: getTemperatureForModel(model, baseTemp),
    ...requestParams,
  } as Anthropic.Messages.MessageCreateParams) as Anthropic.Messages.Message;

  emitUsage(opts, { input_tokens: response.usage?.input_tokens, output_tokens: response.usage?.output_tokens }, model);
  const textBlock = response.content.find((b: Anthropic.Messages.ContentBlock) => b.type === 'text');
  const visible = stripThinkTags(textBlock?.text?.trim() || '');
  if (visible) return visible;
  if (enabled) {
    const thinkingBlocks = response.content.filter((b: Anthropic.Messages.ContentBlock) => b.type === 'thinking');
    if (thinkingBlocks.length > 0) {
      logEmptyThinkingResponse('Anthropic', model, maxTokens, thinkingBlocks.length);
    }
  }
  return '';
}

async function callOllama(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getOllamaClient();
  // Strip ollama- or ollama/ prefix for the API call
  const ollamaModel = model.startsWith('ollama/') ? model.slice('ollama/'.length)
    : model.startsWith('ollama-') ? model.slice('ollama-'.length)
    : model;
  // Thinking models (Qwen3, QwQ, GPT-OSS) need reasoning headroom and the think param.
  const { requestParams, maxTokens, enabled } = await getThinkingCompletionParams(model, opts.maxTokens ?? 2000, opts.reasoningMode);
  const baseTemp = opts.temperature ?? 0.3;
  const response = await client.chat.completions.create({
    model: ollamaModel,
    messages: opts.messages,
    temperature: getTemperatureForModel(model, baseTemp),
    max_tokens: maxTokens,
    ...requestParams,
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  emitUsage(opts, response.usage, model);
  const message = response.choices[0]?.message;
  const visible = stripThinkTags(message?.content?.trim() || '');
  if (visible) return visible;
  if (enabled) {
    const reasoning = (message as unknown as Record<string, unknown>)?.reasoning_content;
    if (reasoning) {
      logEmptyThinkingResponse('Ollama', ollamaModel, maxTokens, String(reasoning).length);
    }
  }
  return '';
}

async function callMoonshot(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getMoonshotClient();
  const moonshotModel = model.startsWith('moonshot/') ? model.slice('moonshot/'.length) : model;
  // Thinking models (Kimi K2) need reasoning headroom. Non-thinking keep the 4096 cap.
  const { requestParams, maxTokens, enabled } = await getThinkingCompletionParams(model, opts.maxTokens ?? 2000, opts.reasoningMode);
  const baseTemp = opts.temperature ?? 0.3;
  const response = await client.chat.completions.create({
    model: moonshotModel,
    messages: opts.messages,
    temperature: getTemperatureForModel(model, baseTemp),
    max_tokens: maxTokens,
    ...requestParams,
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  emitUsage(opts, response.usage, model);
  const message = response.choices[0]?.message;
  const visible = stripThinkTags(message?.content?.trim() || '');
  if (visible) return visible;
  if (enabled) {
    const reasoning = (message as unknown as Record<string, unknown>)?.reasoning_content;
    if (reasoning) {
      logEmptyThinkingResponse('Moonshot', moonshotModel, maxTokens, String(reasoning).length);
      // Kimi K2.6 can consume the shared output budget on reasoning. Make one
      // bounded follow-up with thinking disabled so background tasks receive a
      // visible completion instead of silently returning an empty string.
      if (isKimiK26Model(model) && opts.reasoningMode !== 'disabled') {
        return callMoonshot(model, { ...opts, reasoningMode: 'disabled' });
      }
    }
  }
  return '';
}

async function callDeepSeek(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getDeepSeekClient();
  const deepseekModel = model.startsWith('deepseek/') ? model.slice('deepseek/'.length) : model;
  // Thinking models (DeepSeek V4 Pro, DeepSeek Reasoner) need reasoning headroom
  // and thinking request params. Without these, reasoning exhausts the token
  // budget and content comes back empty (the diagram_gen "Empty response" bug).
  const { requestParams, maxTokens, enabled } = await getThinkingCompletionParams(model, opts.maxTokens ?? 2000, opts.reasoningMode);
  const baseTemp = opts.temperature ?? 0.3;
  const response = await client.chat.completions.create({
    model: deepseekModel,
    messages: opts.messages,
    temperature: getTemperatureForModel(model, baseTemp),
    max_tokens: maxTokens,
    ...requestParams,
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  emitUsage(opts, response.usage, model);
  const message = response.choices[0]?.message;
  const visible = stripThinkTags(message?.content?.trim() || '');
  if (visible) return visible;
  if (enabled) {
    const reasoning = (message as unknown as Record<string, unknown>)?.reasoning_content;
    if (reasoning) {
      logEmptyThinkingResponse('DeepSeek', deepseekModel, maxTokens, String(reasoning).length);
    }
  }
  return '';
}

/**
 * Call Ollama Cloud for non-streaming internal completions.
 * Uses the native /api/chat endpoint via callOllamaCloud().
 */
async function callOllamaCloudDirect(model: string, opts: InternalCompletionOptions): Promise<string> {
  const baseTemp = opts.temperature ?? 0.3;
  // Thinking models (Qwen3, QwQ, GPT-OSS) need reasoning headroom and the think param.
  const { requestParams, maxTokens, enabled } = await getThinkingCompletionParams(model, opts.maxTokens ?? 2000, opts.reasoningMode);
  const response = await callOllamaCloud(model, opts.messages, {
    temperature: getTemperatureForModel(model, baseTemp),
    maxTokens,
    ...(enabled && requestParams.think !== undefined ? { think: requestParams.think as boolean } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Ollama Cloud API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { message?: { content: string } };
  const visible = stripThinkTags(data.message?.content?.trim() || '');
  if (visible) return visible;
  if (enabled) {
    logEmptyThinkingResponse('Ollama Cloud', model, maxTokens, 0);
  }
  return '';
}

/**
 * Call Azure AI Foundry (Route 5) — OpenAI-compatible API
 */
async function callAzureFoundry(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getAzureFoundryClient();
  const baseTemp = opts.temperature ?? 0.3;
  // Strip azure-foundry/ prefix for temperature lookup (bare model name used in overrides)
  const cleanModel = stripAzureFoundryPrefix(model);
  // Thinking models (depends on deployed model) need reasoning headroom.
  const { requestParams, maxTokens, enabled } = await getThinkingCompletionParams(cleanModel, opts.maxTokens ?? 2000, opts.reasoningMode);
  const response = await client.chat.completions.create({
    model, // Provider strips prefix internally for API call
    messages: opts.messages.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    })),
    temperature: getTemperatureForModel(cleanModel, baseTemp),
    max_tokens: maxTokens,
    ...requestParams,
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const message = response.choices[0]?.message;
  const visible = stripThinkTags(message?.content?.trim() || '');
  emitUsage(opts, response.usage, model);
  if (visible) return visible;
  if (enabled) {
    const reasoning = (message as unknown as Record<string, unknown>)?.reasoning_content;
    if (reasoning) {
      logEmptyThinkingResponse('Azure Foundry', model, maxTokens, String(reasoning).length);
    }
  }
  return '';
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
 * - All models route directly via their native SDK/API.
 * - Route 3 models (Ollama) always go direct.
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
    const { requestParams, maxTokens, enabled } = await getThinkingCompletionParams(model, opts.maxTokens ?? 2000, opts.reasoningMode);
    const result = await callMistralChat(model, opts.messages as Array<{ role: string; content: string }>, {
      temperature: opts.temperature,
      maxTokens,
      ...(enabled && Object.keys(requestParams).length > 0 ? { thinkingParams: requestParams } : {}),
    });
    return result.content;
  }
  if (isGeminiModel(model)) {
    const { requestParams, maxTokens, enabled } = await getThinkingCompletionParams(model, opts.maxTokens ?? 2000, opts.reasoningMode);
    const result = await callGeminiChat(model, opts.messages, {
      temperature: opts.temperature,
      maxTokens,
      ...(opts.responseSchema && { responseSchema: opts.responseSchema }),
      // Gemini 2.5 uses thinkingConfig with thinkingBudget: -1 (auto) for thinking.
      ...(enabled ? { thinkingConfig: { thinkingBudget: -1 } } : {}),
    });
    return result.content;
  }
  if (isOpenAIModel(model)) {
    const { requestParams, maxTokens, enabled } = await getThinkingCompletionParams(model, opts.maxTokens ?? 2000, opts.reasoningMode);
    const result = await callOpenAIChat(model, opts.messages, {
      temperature: opts.temperature,
      maxTokens,
      ...(opts.responseSchema && { responseSchema: opts.responseSchema }),
      ...(opts.responseFormat && { responseFormat: opts.responseFormat }),
      // GPT-5/o-series use reasoning_effort. requestParams may also contain
      // reasoning_effort: 'none' for non-thinking GPT-5.6 — only pass when enabled.
      ...(enabled && typeof requestParams.reasoning_effort === 'string'
        ? { reasoningEffort: requestParams.reasoning_effort as string }
        : {}),
    });
    return result.content;
  }

  // Route 3 models → always direct to Ollama
  if (isOllamaModel(model)) {
    return callOllama(model, opts);
  }

  // Route 5 models → always direct to Ollama Cloud
  if (isOllamaCloudModelFn(model)) {
    return callOllamaCloudDirect(model, opts);
  }

  // Route 5 models → aggregator gateways
  if (isAzureFoundryModel(model)) {
    return callAzureFoundry(model, opts);
  }

  throw new Error(`Unsupported model for internal completion: ${model}. No provider route matched.`);
}

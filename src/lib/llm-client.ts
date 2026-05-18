/**
 * Internal LLM Client
 *
 * Shared utility for internal services (memory extraction, summarization,
 * prompt optimization, translation) with multi-route fallback.
 *
 * Route 1: LiteLLM proxy (OpenAI, Gemini, Mistral)
 * Route 2: Fireworks AI direct + DeepSeek direct + Moonshot AI direct + Claude (Anthropic) direct
 * Route 3: Ollama direct (local / air-gapped)
 * Route 4: Ollama Cloud direct (hosted models)
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getLlmSettings, getRoutesSettings } from './db/compat/config';
import { getApiKey, getApiBase } from '@/lib/provider-helpers';
import { isOllamaCloudModel, getOllamaCloudModelId, callOllamaCloud } from './services/ollama-cloud';
import { getEffectiveTemperature, isTemperatureUnsupportedModel } from './llm-thinking';


const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const FIREWORKS_FALLBACK_MODEL = 'fireworks/minimax-m2p5';
const DEEPSEEK_FALLBACK_MODEL = 'deepseek-v4-flash';
const MOONSHOT_FALLBACK_MODEL = 'moonshot/kimi-k2p5';
const CLAUDE_FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

// ============ Types ============

export interface InternalCompletionOptions {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ============ Clients (lazy singletons) ============

let litellmClient: OpenAI | null = null;
let fireworksClient: OpenAI | null = null;
let anthropicClient: Anthropic | null = null;
let ollamaClient: OpenAI | null = null;
let moonshotClient: OpenAI | null = null;
let deepseekClient: OpenAI | null = null;

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
    temperature: isTemperatureUnsupportedModel(model) ? undefined : getEffectiveTemperature(model, baseTemp),
    max_tokens: maxTokens,
  });
  return response.choices[0]?.message?.content?.trim() || '';
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
    temperature: isTemperatureUnsupportedModel(model) ? undefined : getEffectiveTemperature(model, baseTemp),
    max_tokens: maxTokens,
  });
  return response.choices[0]?.message?.content?.trim() || '';
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
    temperature: isTemperatureUnsupportedModel(model) ? undefined : getEffectiveTemperature(model, baseTemp),
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock?.text?.trim() || '';
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
    temperature: isTemperatureUnsupportedModel(model) ? undefined : getEffectiveTemperature(model, baseTemp),
    max_tokens: opts.maxTokens ?? 2000,
  });
  return response.choices[0]?.message?.content?.trim() || '';
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
    temperature: isTemperatureUnsupportedModel(model) ? undefined : getEffectiveTemperature(model, baseTemp),
    max_tokens: maxTokens,
  });
  return response.choices[0]?.message?.content?.trim() || '';
}

async function callDeepSeek(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getDeepSeekClient();
  const deepseekModel = model.startsWith('deepseek/') ? model.slice('deepseek/'.length) : model;
  const maxTokens = Math.min(opts.maxTokens ?? 2000, 4096);
  const baseTemp = opts.temperature ?? 0.3;
  const response = await client.chat.completions.create({
    model: deepseekModel,
    messages: opts.messages,
    temperature: isTemperatureUnsupportedModel(model) ? undefined : getEffectiveTemperature(model, baseTemp),
    max_tokens: maxTokens,
  });
  return response.choices[0]?.message?.content?.trim() || '';
}

/**
 * Call Ollama Cloud for non-streaming internal completions.
 * Uses the native /api/chat endpoint via callOllamaCloud().
 */
async function callOllamaCloudDirect(model: string, opts: InternalCompletionOptions): Promise<string> {
  const baseTemp = opts.temperature ?? 0.3;
  const response = await callOllamaCloud(model, opts.messages, {
    temperature: isTemperatureUnsupportedModel(model) ? undefined : getEffectiveTemperature(model, baseTemp),
    maxTokens: opts.maxTokens,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Ollama Cloud API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { message?: { content: string } };
  return data.message?.content?.trim() || '';
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

  // Route 3 models → always direct to Ollama
  if (isOllamaModel(model)) {
    return callOllama(model, opts);
  }

  // Route 4 models → always direct to Ollama Cloud
  if (isOllamaCloudModelFn(model)) {
    return callOllamaCloudDirect(model, opts);
  }

  // Route 1 → try LiteLLM, fall back to Route 2/3/4 if enabled
  try {
    return await callLiteLLM(model, opts);
  } catch (err) {
    const hasRoute2 = routes.route2Enabled;
    const hasRoute3 = routes.route3Enabled;
    if (!hasRoute2 && !hasRoute3) throw err;

    console.warn('[llm-client] Route 1 failed, trying fallback routes:', err instanceof Error ? err.message : err);

    // Try Route 2 first (Fireworks → DeepSeek → Moonshot → Claude), then Route 3 (Ollama)
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

    throw err;
  }
}

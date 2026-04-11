/**
 * Internal LLM Client
 *
 * Shared utility for internal services (memory extraction, summarization,
 * prompt optimization, translation) with multi-route fallback.
 *
 * Route 1: LiteLLM proxy (OpenAI, Gemini, Mistral, DeepSeek)
 * Route 2: Fireworks AI direct + Claude (Anthropic) direct
 * Route 3: Ollama direct (local / air-gapped)
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getLlmSettings, getRoutesSettings } from './db/compat/config';
import { getApiKey, getApiBase } from '@/lib/provider-helpers';

const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
const FIREWORKS_FALLBACK_MODEL = 'accounts/fireworks/models/minimax-m2p5';
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

// ============ Provider Callers ============

async function callLiteLLM(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getLiteLLMClient();
  const response = await client.chat.completions.create({
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: Math.min(opts.maxTokens ?? 2000, 4096),
  });
  return response.choices[0]?.message?.content?.trim() || '';
}

async function callFireworks(model: string, opts: InternalCompletionOptions): Promise<string> {
  const client = await getFireworksClient();
  const response = await client.chat.completions.create({
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 2000,
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

  const response = await client.messages.create({
    model: model.startsWith('anthropic/') ? model.slice('anthropic/'.length) : model,
    system: systemMsg || undefined,
    messages: conversationMsgs,
    max_tokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.3,
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
  const response = await client.chat.completions.create({
    model: ollamaModel,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 2000,
  });
  return response.choices[0]?.message?.content?.trim() || '';
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

// ============ Main Entry Point ============

/**
 * Create a completion using the configured LLM route with automatic fallback.
 *
 * - Route 2 models (Claude, Fireworks) always go direct.
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

  // Route 3 models → always direct to Ollama
  if (isOllamaModel(model)) {
    return callOllama(model, opts);
  }

  // Route 1 → try LiteLLM, fall back to Route 2/3 if enabled
  try {
    return await callLiteLLM(model, opts);
  } catch (err) {
    const hasRoute2 = routes.route2Enabled;
    const hasRoute3 = routes.route3Enabled;
    if (!hasRoute2 && !hasRoute3) throw err;

    console.warn('[llm-client] Route 1 failed, trying fallback routes:', err instanceof Error ? err.message : err);

    // Try Route 2 first (Fireworks → Claude), then Route 3 (Ollama)
    if (hasRoute2) {
      try {
        return await callFireworks(FIREWORKS_FALLBACK_MODEL, opts);
      } catch (fwErr) {
        console.warn('[llm-client] Fireworks fallback failed:', fwErr instanceof Error ? fwErr.message : fwErr);
        try {
          return await callAnthropic(CLAUDE_FALLBACK_MODEL, opts);
        } catch (claudeErr) {
          console.warn('[llm-client] Claude fallback failed:', claudeErr instanceof Error ? claudeErr.message : claudeErr);
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

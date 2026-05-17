/**
 * LLM Router
 *
 * Routes LLM requests to appropriate provider (OpenAI, Gemini, Mistral, Anthropic, Fireworks, Ollama, Ollama Cloud)
 * Supports different models for different agent roles (planner, executor, checker, summarizer)
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { ModelSpec, AgentModelConfig } from '@/types/agent';
import { getApiKey, getApiBase } from '@/lib/provider-helpers';
import { recordTokenUsage } from '@/lib/token-logger';
import { callOllamaCloud } from '@/lib/services/ollama-cloud';

const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

let openaiClient: OpenAI | null = null;
let anthropicClient: Anthropic | null = null;
let fireworksClient: OpenAI | null = null;
let ollamaClient: OpenAI | null = null;
let moonshotClient: OpenAI | null = null;
let deepseekClient: OpenAI | null = null;

/**
 * Extract <think>...</think> reasoning blocks from model output.
 * Used by OpenAI-compatible providers (Fireworks, Moonshot, Ollama, etc.)
 */
function extractThinkTags(content: string): { visible: string; thinking: string } {
  const match = content.match(/<think>([\s\S]*?)<\/think>/);
  if (match) {
    return {
      visible: content.replace(match[0], '').replace(/^\n+/, '').trim(),
      thinking: match[1].trim(),
    };
  }
  return { visible: content, thinking: '' };
}

export interface LLMResponse {
  content: string;
  tokens_used: number;
  model: string;
  provider: string;
  thinkingContent?: string;
}

/**
 * Generate text using specified model
 */
export async function generateWithModel(
  modelSpec: ModelSpec,
  prompt: string,
  options: {
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<LLMResponse> {
  const { systemPrompt = '', temperature = modelSpec.temperature, maxTokens: rawMaxTokens = modelSpec.max_tokens || 4096 } = options;

  // Cap max_tokens to prevent API rejection from misconfigured values
  // 32000 is safe for all supported models (gpt-4.1-mini supports 32768)
  const maxTokens = Math.min(rawMaxTokens, 32000);

  let response: LLMResponse;
  switch (modelSpec.provider) {
    case 'openai':
      response = await generateOpenAI(modelSpec.model, prompt, systemPrompt, temperature, maxTokens);
      break;
    case 'gemini':
      response = await generateGemini(modelSpec.model, prompt, systemPrompt, temperature, maxTokens);
      break;
    case 'mistral':
      response = await generateMistral(modelSpec.model, prompt, systemPrompt, temperature, maxTokens);
      break;
    case 'anthropic':
      response = await generateAnthropic(modelSpec.model, prompt, systemPrompt, temperature, maxTokens);
      break;
    case 'fireworks':
      response = await generateFireworks(modelSpec.model, prompt, systemPrompt, temperature, maxTokens);
      break;
    case 'deepseek':
      response = await generateDeepSeek(modelSpec.model, prompt, systemPrompt, temperature, maxTokens);
      break;
    case 'ollama':
      response = await generateOllama(modelSpec.model, prompt, systemPrompt, temperature, maxTokens);
      break;
    case 'ollama-cloud':
      response = await generateOllamaCloud(modelSpec.model, prompt, systemPrompt, temperature, maxTokens);
      break;
    case 'moonshot':
      response = await generateMoonshot(modelSpec.model, prompt, systemPrompt, temperature, maxTokens);
      break;
    default:
      throw new Error(`Unknown LLM provider: ${modelSpec.provider}`);
  }

  // Log token usage for all autonomous LLM calls
  recordTokenUsage({
    category: 'autonomous',
    model: response.model,
    totalTokens: response.tokens_used,
  });

  return response;
}

/**
 * Generate using OpenAI (includes gpt-4, gpt-4-turbo, gpt-3.5-turbo, etc.)
 */
async function generateOpenAI(
  model: string,
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  if (!openaiClient) {
    // When using LiteLLM proxy, use LITELLM_MASTER_KEY for authentication
    // Otherwise use centralized provider helper (DB-first, then env var fallback)
    const apiKey = process.env.OPENAI_BASE_URL
      ? process.env.LITELLM_MASTER_KEY || await getApiKey('openai')
      : await getApiKey('openai');

    openaiClient = new OpenAI({
      apiKey: apiKey || undefined,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  // Fireworks models require stream=true for max_tokens > 4096
  const isFireworks = model.startsWith('fireworks/');
  const needsStreaming = isFireworks && maxTokens > 4096;

  if (needsStreaming) {
    const stream = await openaiClient.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });

    let content = '';
    let totalTokens = 0;
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta?.content || '';
      if (chunk.usage) totalTokens = chunk.usage.total_tokens;
    }

    const { visible, thinking } = extractThinkTags(content);
    return { content: visible, tokens_used: totalTokens, model, provider: 'openai', thinkingContent: thinking || undefined };
  }

  const response = await openaiClient.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  });

  const rawContent = response.choices[0].message.content || '';
  const { visible, thinking } = extractThinkTags(rawContent);
  return {
    content: visible,
    tokens_used: response.usage?.total_tokens || 0,
    model,
    provider: 'openai',
    thinkingContent: thinking || undefined,
  };
}

/**
 * Generate using Google Gemini (using @google/genai SDK)
 */
async function generateGemini(
  model: string,
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  const { GoogleGenAI } = await import('@google/genai');

  const apiKey = await getApiKey('gemini');
  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  }

  const ai = new GoogleGenAI({ apiKey });

  // Combine system prompt and user prompt
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

  const response = await ai.models.generateContent({
    model,
    contents: [{ parts: [{ text: fullPrompt }] }],
    config: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  });

  const text = response.text || '';
  // Use actual token count from response if available, otherwise estimate
  const tokensUsed = response.usageMetadata?.totalTokenCount || Math.ceil((fullPrompt.length + text.length) / 4);

  return {
    content: text,
    tokens_used: tokensUsed,
    model,
    provider: 'gemini',
  };
}

/**
 * Generate using Mistral AI
 */
async function generateMistral(
  model: string,
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  const { Mistral } = await import('@mistralai/mistralai');

  const apiKey = await getApiKey('mistral');
  if (!apiKey) {
    throw new Error('Mistral API key not configured');
  }

  const client = new Mistral({ apiKey });

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system' as const, content: systemPrompt });
  }
  messages.push({ role: 'user' as const, content: prompt });

  const response = await client.chat.complete({
    model,
    messages,
    temperature,
    maxTokens,
  });

  const messageContent = response.choices?.[0]?.message?.content;
  const content = typeof messageContent === 'string' ? messageContent : '';

  return {
    content,
    tokens_used: response.usage?.totalTokens || 0,
    model,
    provider: 'mistral',
  };
}

/**
 * Generate using Anthropic Claude (direct SDK, bypasses LiteLLM)
 */
async function generateAnthropic(
  model: string,
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  if (!anthropicClient) {
    const apiKey = await getApiKey('anthropic');
    anthropicClient = new Anthropic({ apiKey: apiKey || undefined });
  }

  // Strip anthropic/ prefix if present
  const modelId = model.startsWith('anthropic/') ? model.slice('anthropic/'.length) : model;

  const response = await anthropicClient.messages.create({
    model: modelId,
    system: systemPrompt || undefined,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature,
  });

  const textBlock = response.content.find(b => b.type === 'text');
  const content = (textBlock && 'text' in textBlock ? textBlock.text : '') || '';
  const thinkingBlock = response.content.find(b => b.type === 'thinking');
  const thinkingContent = (thinkingBlock && 'thinking' in thinkingBlock ? thinkingBlock.thinking : '') || '';
  const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

  return {
    content,
    tokens_used: tokensUsed,
    model: modelId,
    provider: 'anthropic',
    thinkingContent: thinkingContent || undefined,
  };
}

/**
 * Generate using Fireworks AI (direct SDK, bypasses LiteLLM)
 */
async function generateFireworks(
  model: string,
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  if (!fireworksClient) {
    const apiKey = await getApiKey('fireworks');
    fireworksClient = new OpenAI({
      apiKey: apiKey || undefined,
      baseURL: FIREWORKS_BASE_URL,
    });
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });
  const fireworksModel = model.startsWith('fireworks/')
    ? `accounts/fireworks/models/${model.slice('fireworks/'.length)}`
    : model;

  // Fireworks requires stream=true for max_tokens > 4096
  if (maxTokens > 4096) {
    const stream = await fireworksClient.chat.completions.create({
      model: fireworksModel,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });

    let content = '';
    let totalTokens = 0;
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta?.content || '';
      if (chunk.usage) totalTokens = chunk.usage.total_tokens;
    }

    const { visible, thinking } = extractThinkTags(content);
    return { content: visible, tokens_used: totalTokens, model: fireworksModel, provider: 'fireworks', thinkingContent: thinking || undefined };
  }

  const response = await fireworksClient.chat.completions.create({
    model: fireworksModel,
    messages,
    temperature,
    max_tokens: maxTokens,
  });

  const rawContent = response.choices[0].message.content || '';
  const { visible, thinking } = extractThinkTags(rawContent);
  return {
    content: visible,
    tokens_used: response.usage?.total_tokens || 0,
    model: fireworksModel,
    provider: 'fireworks',
    thinkingContent: thinking || undefined,
  };
}

/**
 * Generate using Ollama (local, direct SDK)
 */
async function generateOllama(
  model: string,
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  if (!ollamaClient) {
    const apiBase = await getApiBase('ollama');
    const baseURL = ((apiBase || 'http://localhost:11434').replace(/\/v1\/?$/, '')) + '/v1';
    ollamaClient = new OpenAI({ apiKey: 'ollama', baseURL });
  }

  // Strip ollama- or ollama/ prefix for the API call
  const ollamaModel = model.startsWith('ollama/') ? model.slice('ollama/'.length)
    : model.startsWith('ollama-') ? model.slice('ollama-'.length)
    : model;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await ollamaClient.chat.completions.create({
    model: ollamaModel,
    messages,
    temperature,
    max_tokens: maxTokens,
  });

  const rawContent = response.choices[0]?.message?.content || '';
  const { visible, thinking } = extractThinkTags(rawContent);
  return {
    content: visible,
    tokens_used: response.usage?.total_tokens || 0,
    model: ollamaModel,
    provider: 'ollama',
    thinkingContent: thinking || undefined,
  };
}

/**
 * Generate using Ollama Cloud (hosted Ollama API)
 */
async function generateOllamaCloud(
  model: string,
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await callOllamaCloud(model, messages, { temperature, maxTokens });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Ollama Cloud API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { message?: { content: string }; eval_count?: number; prompt_eval_count?: number };
  const content = data.message?.content?.trim() || '';
  const tokensUsed = (data.eval_count || 0) + (data.prompt_eval_count || 0);

  const { visible, thinking } = extractThinkTags(content);
  return {
    content: visible,
    tokens_used: tokensUsed,
    model,
    provider: 'ollama-cloud',
    thinkingContent: thinking || undefined,
  };
}

/**
 * Generate using Moonshot AI (direct SDK, bypasses LiteLLM)
 */
async function generateMoonshot(
  model: string,
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  if (!moonshotClient) {
    const apiKey = await getApiKey('moonshot');
    const { getMoonshotBaseUrl } = await import('@/lib/moonshot-config');
    moonshotClient = new OpenAI({
      apiKey: apiKey || undefined,
      baseURL: await getMoonshotBaseUrl(),
    });
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const moonshotModel = model.startsWith('moonshot/') ? model.slice('moonshot/'.length) : model;

  // Moonshot may require stream=true for max_tokens > 4096 (OpenAI-compatible behavior)
  if (maxTokens > 4096) {
    const stream = await moonshotClient.chat.completions.create({
      model: moonshotModel,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });

    let content = '';
    let totalTokens = 0;
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta?.content || '';
      if (chunk.usage) totalTokens = chunk.usage.total_tokens;
    }

    const { visible, thinking } = extractThinkTags(content);
    return { content: visible, tokens_used: totalTokens, model: moonshotModel, provider: 'moonshot', thinkingContent: thinking || undefined };
  }

  const response = await moonshotClient.chat.completions.create({
    model: moonshotModel,
    messages,
    temperature,
    max_tokens: maxTokens,
  });

  const rawContent = response.choices[0].message.content || '';
  const { visible, thinking } = extractThinkTags(rawContent);
  return {
    content: visible,
    tokens_used: response.usage?.total_tokens || 0,
    model: moonshotModel,
    provider: 'moonshot',
    thinkingContent: thinking || undefined,
  };
}

/**
 * Generate using DeepSeek (direct SDK, bypasses LiteLLM)
 */
async function generateDeepSeek(
  model: string,
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  if (!deepseekClient) {
    const apiKey = await getApiKey('deepseek');
    const apiBase = await getApiBase('deepseek');
    deepseekClient = new OpenAI({
      apiKey: apiKey || undefined,
      baseURL: (apiBase || DEEPSEEK_BASE_URL).replace(/\/+$/, ''),
    });
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const deepseekModel = model.startsWith('deepseek/') ? model.slice('deepseek/'.length) : model;

  if (maxTokens > 4096) {
    const stream = await deepseekClient.chat.completions.create({
      model: deepseekModel,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });

    let content = '';
    let totalTokens = 0;
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta?.content || '';
      if (chunk.usage) totalTokens = chunk.usage.total_tokens;
    }

    const { visible, thinking } = extractThinkTags(content);
    return { content: visible, tokens_used: totalTokens, model: deepseekModel, provider: 'deepseek', thinkingContent: thinking || undefined };
  }

  const response = await deepseekClient.chat.completions.create({
    model: deepseekModel,
    messages,
    temperature,
    max_tokens: maxTokens,
  });

  const rawContent = response.choices[0].message.content || '';
  const { visible, thinking } = extractThinkTags(rawContent);
  return {
    content: visible,
    tokens_used: response.usage?.total_tokens || 0,
    model: deepseekModel,
    provider: 'deepseek',
    thinkingContent: thinking || undefined,
  };
}

/**
 * Detect the correct provider for a model ID based on its prefix.
 * Used to assign the right provider for fallback models.
 */
function detectProvider(modelId: string): ModelSpec['provider'] {
  if (modelId.startsWith('anthropic/') || modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('fireworks/') || modelId.startsWith('accounts/fireworks')) return 'fireworks';
  if (modelId.startsWith('deepseek-') || modelId.startsWith('deepseek/')) return 'deepseek';
  if (modelId.startsWith('moonshot/')) return 'moonshot';
  if (modelId.startsWith('ollama-cloud/') || modelId.endsWith('-cloud') || modelId.includes(':cloud')) return 'ollama-cloud';
  if (modelId.startsWith('ollama-') || modelId.startsWith('ollama/')) return 'ollama';
  if (modelId.startsWith('gemini')) return 'gemini';
  if (modelId.startsWith('mistral') || modelId.startsWith('codestral') || modelId.startsWith('pixtral')) return 'mistral';
  return 'openai';
}

/**
 * Generate with automatic fallback chain on recoverable errors.
 * Level 1: global default model (getDefaultLLMModel)
 * Level 2: universal fallback model (getLlmFallbackSettings)
 * Max attempts are capped by llm-fallback-settings.maxRetryAttempts.
 */
export async function generateWithModelFallback(
  modelSpec: ModelSpec,
  prompt: string,
  options: { systemPrompt?: string; temperature?: number; maxTokens?: number } = {}
): Promise<LLMResponse> {
  try {
    return await generateWithModel(modelSpec, prompt, options);
  } catch (error) {
    const { isRecoverableApiError, markModelUnhealthy } = await import('../llm-fallback');
    const reason = isRecoverableApiError(error as Error);
    if (!reason) throw error; // Non-recoverable — don't retry

    console.warn(`[LLM Router] ${modelSpec.model} failed (${reason}), trying fallback chain...`);
    await markModelUnhealthy(modelSpec.model);

    // Build fallback chain from configured sources (no hardcoded models)
    const { getDefaultLLMModel } = await import('../config-loader');
    const { getLlmFallbackSettings } = await import('../db/compat/config');

    const globalDefault = getDefaultLLMModel();
    const fallbackSettings = await getLlmFallbackSettings();
    const maxRetryAttempts = Math.max(1, Math.min(3, Number(fallbackSettings.maxRetryAttempts || 2)));
    const universalFallback = fallbackSettings.universalFallback;

    // Deduplicate: skip models that are same as the failed one
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
          provider: detectProvider(fallbackModelId),
          temperature: modelSpec.temperature,
          max_tokens: modelSpec.max_tokens,
        };
        console.log(`[LLM Router] Falling back to ${fallbackModelId}`);
        return await generateWithModel(fallbackSpec, prompt, options);
      } catch (fallbackError) {
        const fallbackReason = isRecoverableApiError(fallbackError as Error);
        if (fallbackReason) {
          console.warn(`[LLM Router] ${fallbackModelId} also failed (${fallbackReason})`);
          await markModelUnhealthy(fallbackModelId);
          continue; // Try next in chain
        }
        throw fallbackError; // Non-recoverable from fallback
      }
    }

    // All fallbacks exhausted
    throw error;
  }
}

/**
 * Get model spec for a specific agent role
 */
export function getModelForRole(role: 'planner' | 'executor' | 'checker' | 'summarizer', config: AgentModelConfig): ModelSpec {
  return config[role];
}

/**
 * Estimate tokens for a string (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

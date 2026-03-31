/**
 * LLM Router
 *
 * Routes LLM requests to appropriate provider (OpenAI, Gemini, Mistral)
 * Supports different models for different agent roles (planner, executor, checker, summarizer)
 */

import OpenAI from 'openai';
import type { ModelSpec, AgentModelConfig } from '@/types/agent';
import { getApiKey } from '@/lib/provider-helpers';
import { recordTokenUsage } from '@/lib/token-logger';

let openaiClient: OpenAI | null = null;

export interface LLMResponse {
  content: string;
  tokens_used: number;
  model: string;
  provider: string;
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

    return { content, tokens_used: totalTokens, model, provider: 'openai' };
  }

  const response = await openaiClient.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  });

  return {
    content: response.choices[0].message.content || '',
    tokens_used: response.usage?.total_tokens || 0,
    model,
    provider: 'openai',
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
 * Generate with automatic fallback chain on recoverable errors.
 * Level 1: global default model (getDefaultLLMModel)
 * Level 2: universal fallback model (getLlmFallbackSettings)
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
    const universalFallback = fallbackSettings.universalFallback;

    // Deduplicate: skip models that are same as the failed one
    const fallbackChain: string[] = [];
    if (globalDefault && globalDefault !== modelSpec.model) {
      fallbackChain.push(globalDefault);
    }
    if (universalFallback && universalFallback !== modelSpec.model && universalFallback !== globalDefault) {
      fallbackChain.push(universalFallback);
    }

    for (const fallbackModelId of fallbackChain) {
      try {
        const fallbackSpec: ModelSpec = {
          model: fallbackModelId,
          provider: 'openai', // All models route through LiteLLM proxy
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
export function getModelForRole(role: keyof AgentModelConfig, config: AgentModelConfig): ModelSpec {
  return config[role];
}

/**
 * Estimate tokens for a string (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

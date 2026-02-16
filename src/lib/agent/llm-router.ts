/**
 * LLM Router
 *
 * Routes LLM requests to appropriate provider (OpenAI, Gemini, Mistral)
 * Supports different models for different agent roles (planner, executor, checker, summarizer)
 */

import OpenAI from 'openai';
import type { ModelSpec, AgentModelConfig } from '@/types/agent';
import { getApiKey } from '@/lib/provider-helpers';

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
  const { systemPrompt = '', temperature = modelSpec.temperature, maxTokens = modelSpec.max_tokens || 4096 } = options;

  switch (modelSpec.provider) {
    case 'openai':
      return generateOpenAI(modelSpec.model, prompt, systemPrompt, temperature, maxTokens);
    case 'gemini':
      return generateGemini(modelSpec.model, prompt, systemPrompt, temperature, maxTokens);
    case 'mistral':
      return generateMistral(modelSpec.model, prompt, systemPrompt, temperature, maxTokens);
    default:
      throw new Error(`Unknown LLM provider: ${modelSpec.provider}`);
  }
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
      ? process.env.LITELLM_MASTER_KEY || getApiKey('openai')
      : getApiKey('openai');

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
 * Generate using Google Gemini
 */
async function generateGemini(
  model: string,
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');

  const apiKey = getApiKey('gemini');
  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  }

  const client = new GoogleGenerativeAI(apiKey);
  const genModel = client.getGenerativeModel({
    model,
  });

  // Prepend system prompt to user prompt for older Gemini SDK versions
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

  const result = await genModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  });

  const text = result.response.text();
  // Estimate tokens for older SDK versions (usageMetadata not available in 0.1.3)
  const tokensUsed = Math.ceil((fullPrompt.length + text.length) / 4);

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

  const apiKey = getApiKey('mistral');
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

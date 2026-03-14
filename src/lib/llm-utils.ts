/**
 * LLM Utilities
 *
 * Simple utility functions for LLM calls outside the main chat flow.
 * Used for tasks like clarification generation.
 */

import OpenAI from 'openai';
import { getDefaultLLMModel } from './config-loader';
import { getApiKey } from '@/lib/provider-helpers';

let openaiClient: OpenAI | null = null;

async function getOpenAI(): Promise<OpenAI> {
  if (!openaiClient) {
    // When using LiteLLM proxy, a dummy key is sufficient
    // Otherwise use centralized provider helper (DB-first, then env var fallback)
    const baseURL = process.env.LITELLM_BASE_URL;
    const apiKey = baseURL ? 'dummy-key' : await getApiKey('openai');

    openaiClient = new OpenAI({
      apiKey: apiKey || undefined,
      baseURL,
    });
  }
  return openaiClient;
}

interface CallLLMOptions {
  model?: string;
  timeout?: number;
  temperature?: number;
  maxTokens?: number;
  /** When provided, sent as a separate role: 'system' message before the user prompt */
  systemPrompt?: string;
}

/**
 * Call LLM for JSON output (simple, non-streaming)
 * Used for small tasks like generating clarification questions.
 */
export async function callLLMForJson(
  prompt: string,
  options: CallLLMOptions = {}
): Promise<string> {
  const openai = await getOpenAI();

  const {
    model = getDefaultLLMModel(),
    timeout = 5000,
    temperature = 0.3,
    maxTokens = 1000,
    systemPrompt,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  try {
    const response = await openai.chat.completions.create(
      {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      },
      {
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in response');
    }

    return content;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`LLM call timed out after ${timeout}ms`);
    }

    throw error;
  }
}

/**
 * Call LLM for simple text output
 */
export async function callLLMForText(
  prompt: string,
  options: CallLLMOptions = {}
): Promise<string> {
  const openai = await getOpenAI();

  const {
    model = getDefaultLLMModel(),
    timeout = 5000,
    temperature = 0.3,
    maxTokens = 1000,
    systemPrompt,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  try {
    const response = await openai.chat.completions.create(
      {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      },
      {
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in response');
    }

    return content;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`LLM call timed out after ${timeout}ms`);
    }

    throw error;
  }
}

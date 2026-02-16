/**
 * LLM Utilities
 *
 * Simple utility functions for LLM calls outside the main chat flow.
 * Used for tasks like clarification generation.
 */

import OpenAI from 'openai';
import { getDefaultLLMModel } from './config-loader';

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const baseURL = process.env.LITELLM_BASE_URL;
    const apiKey = baseURL ? 'dummy-key' : process.env.OPENAI_API_KEY;

    openaiClient = new OpenAI({
      apiKey,
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
}

/**
 * Call LLM for JSON output (simple, non-streaming)
 * Used for small tasks like generating clarification questions.
 */
export async function callLLMForJson(
  prompt: string,
  options: CallLLMOptions = {}
): Promise<string> {
  const openai = getOpenAI();

  const {
    model = getDefaultLLMModel(),
    timeout = 5000,
    temperature = 0.3,
    maxTokens = 1000,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await openai.chat.completions.create(
      {
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
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
  const openai = getOpenAI();

  const {
    model = getDefaultLLMModel(),
    timeout = 5000,
    temperature = 0.3,
    maxTokens = 1000,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await openai.chat.completions.create(
      {
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
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

/**
 * LLM Utilities
 *
 * Simple utility functions for LLM calls outside the main chat flow.
 * Used for tasks like clarification generation and model detail extraction.
 *
 * Uses createInternalCompletion() which provides:
 * - DB-configured default model (admin UI override)
 * - Route-aware client selection (Claude direct, Fireworks direct, LiteLLM)
 * - Route 1 → Route 2 automatic fallback
 */

import { createInternalCompletion } from './llm-client';
import { getLlmSettings } from './db/compat/config';

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
 *
 * JSON enforcement is via system prompt (works across all providers
 * including Anthropic which doesn't support response_format).
 */
export async function callLLMForJson(
  prompt: string,
  options: CallLLMOptions = {}
): Promise<string> {
  const {
    model,
    timeout = 5000,
    temperature = 0.3,
    maxTokens = 1000,
    systemPrompt,
  } = options;

  const effectiveModel = model || (await getLlmSettings()).model;

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (systemPrompt) {
    // Reinforce JSON-only output in system prompt
    const jsonHint = systemPrompt.toLowerCase().includes('json')
      ? systemPrompt
      : `${systemPrompt}\n\nRespond with valid JSON only.`;
    messages.push({ role: 'system', content: jsonHint });
  } else {
    messages.push({ role: 'system', content: 'Respond with valid JSON only.' });
  }
  messages.push({ role: 'user', content: prompt });

  const completionPromise = createInternalCompletion({
    messages,
    model: effectiveModel,
    temperature,
    maxTokens,
  });

  // Apply timeout via Promise.race
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`LLM call timed out after ${timeout}ms`)), timeout);
  });

  const raw = await Promise.race([completionPromise, timeoutPromise]);

  // Strip markdown code fences that some models wrap around JSON
  return raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/g, '').trim();
}

/**
 * Call LLM for simple text output
 */
export async function callLLMForText(
  prompt: string,
  options: CallLLMOptions = {}
): Promise<string> {
  const {
    model,
    timeout = 5000,
    temperature = 0.3,
    maxTokens = 1000,
    systemPrompt,
  } = options;

  const effectiveModel = model || (await getLlmSettings()).model;

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const completionPromise = createInternalCompletion({
    messages,
    model: effectiveModel,
    temperature,
    maxTokens,
  });

  // Apply timeout via Promise.race
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`LLM call timed out after ${timeout}ms`)), timeout);
  });

  return Promise.race([completionPromise, timeoutPromise]);
}

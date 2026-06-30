/**
 * LLM Utilities
 *
 * Simple utility functions for LLM calls outside the main chat flow.
 * Used for tasks like clarification generation and model detail extraction.
 *
 * Uses createInternalCompletion() which provides:
 * - DB-configured default model (admin UI override)
 * - Route-aware client selection (Claude direct, Fireworks direct, Moonshot direct, LiteLLM)
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
  /**
   * When provided, adds an assistant message with this prefix after the user prompt.
   * This forces models (especially Claude) to continue from the prefix instead of
   * generating prose like "The user wants me to...". Use '{' for JSON objects or
   * '[' for JSON arrays.
   */
  assistantPrefix?: string;
  /** Optional JSON schema for Gemini native responseSchema enforcement. Ignored by non-Gemini providers. */
  responseSchema?: object;
}

/**
 * Call LLM for JSON output (simple, non-streaming)
 * Used for small tasks like generating clarification questions.
 *
 * JSON enforcement is via system prompt + assistant prefix (works across all providers
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
    assistantPrefix,
    responseSchema,
  } = options;

  const effectiveModel = model || (await getLlmSettings()).model;

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (systemPrompt) {
    // Append a hard JSON-only guard so the model never explains what it's doing.
    const guarded = systemPrompt.toLowerCase().includes('no prose')
      ? systemPrompt
      : `${systemPrompt}\n\nCRITICAL: Output raw valid JSON only. No prose, no markdown fences, no explanations, no preamble, no "The user wants" text. Start immediately with the JSON.`;
    messages.push({ role: 'system', content: guarded });
  } else {
    messages.push({ role: 'system', content: 'Output raw valid JSON only. No prose, no markdown fences, no explanations, no preamble.' });
  }
  messages.push({ role: 'user', content: prompt });

  // Assistant prefix forces Claude and other chatty models to continue from the JSON
  // structure instead of generating conversational prose.
  if (assistantPrefix) {
    messages.push({ role: 'assistant', content: assistantPrefix });
  }

  const completionPromise = createInternalCompletion({
    messages,
    model: effectiveModel,
    temperature,
    maxTokens,
    ...(responseSchema && { responseSchema }),
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

/**
 * Extract provider from model path prefix.
 * Examples:
 *   gemini/gemini-2.5-flash → gemini
 *   mistral/mistral-large   → mistral
 *   ollama/llama3.2         → ollama
 *   gpt-4.1-mini            → openai (default)
 */
export function getProviderFromModelPath(modelPath: string): string {
  const lowerPath = modelPath.toLowerCase();

  if (lowerPath.startsWith('gemini/')) return 'gemini';
  if (lowerPath.startsWith('mistral/')) return 'mistral';
  if (lowerPath.startsWith('ollama/')) return 'ollama';
  if (lowerPath.startsWith('azure/')) return 'azure';
  if (lowerPath.startsWith('anthropic/')) return 'anthropic';
  if (lowerPath.startsWith('fireworks/') || lowerPath.startsWith('fireworks_ai/')) return 'fireworks';
  if (lowerPath.startsWith('moonshot/')) return 'moonshot';

  // Default to openai for models without prefix
  return 'openai';
}

/**
 * Generate human-friendly display name from model ID.
 * Examples:
 *   gpt-4.1-mini        → GPT-4.1 Mini
 *   gemini-2.5-flash    → Gemini 2.5 Flash
 *   ollama-llama3.2     → Ollama Llama 3.2
 *   mistral-small-3.2   → Mistral Small 3.2
 */
export function generateDisplayName(modelId: string): string {
  // Split by hyphens and dots, keeping version numbers together
  const parts = modelId.split(/[-.]/).filter(Boolean);

  return parts.map((part, index) => {
    // Uppercase known acronyms
    if (['gpt', 'llm', 'ai'].includes(part.toLowerCase())) {
      return part.toUpperCase();
    }
    // Keep version numbers as-is (e.g., "4.1", "2.5", "3.2")
    if (/^\d+$/.test(part)) {
      // If previous part was also a number, join with dot
      if (index > 0 && /^\d+$/.test(parts[index - 1])) {
        return '.' + part;
      }
      return part;
    }
    // Capitalize first letter of words
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join(' ').replace(/ \./g, '.'); // Fix spacing around dots
}

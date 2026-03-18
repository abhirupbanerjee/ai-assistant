/**
 * Provider Helpers
 *
 * Centralized helpers for getting API keys and configuration for LLM providers.
 * Tools should use these helpers instead of reading environment variables directly.
 *
 * Benefits:
 * - API keys configured via Admin UI take precedence
 * - Falls back to environment variables if not configured in UI
 * - Single source of truth for provider configuration
 *
 * Usage:
 * ```typescript
 * import { getApiKey, getApiBase, isProviderConfigured } from '@/lib/provider-helpers';
 *
 * // Get API key (checks DB first, then env var)
 * const openaiKey = getApiKey('openai');
 * const geminiKey = getApiKey('gemini');
 * const mistralKey = getApiKey('mistral');
 *
 * // Get API base URL (for Ollama or custom endpoints)
 * const ollamaBase = getApiBase('ollama');
 *
 * // Check if provider is properly configured
 * if (isProviderConfigured('openai')) {
 *   // Provider has API key configured
 * }
 * ```
 */

import { getProviderApiKey, getProviderApiBase } from './db/compat/llm-providers';

// Re-export with cleaner names
export const getApiKey = getProviderApiKey;
export const getApiBase = getProviderApiBase;

/**
 * Check if a provider is properly configured (has API key or base URL)
 */
export async function isProviderConfigured(providerId: string): Promise<boolean> {
  if (providerId === 'ollama') {
    return !!(await getApiBase('ollama'));
  }
  return !!(await getApiKey(providerId));
}

/**
 * Get provider configuration with both key and base URL
 */
export async function getProviderConfig(providerId: string): Promise<{
  apiKey: string | null;
  apiBase: string | null;
  isConfigured: boolean;
}> {
  const apiKey = await getApiKey(providerId);
  const apiBase = await getApiBase(providerId);

  return {
    apiKey,
    apiBase,
    isConfigured: providerId === 'ollama' ? !!apiBase : !!apiKey,
  };
}

/**
 * Provider IDs
 */
export const PROVIDERS = {
  OPENAI: 'openai',
  GEMINI: 'gemini',
  MISTRAL: 'mistral',
  OLLAMA: 'ollama',
  ANTHROPIC: 'anthropic',
  DEEPSEEK: 'deepseek',
  FIREWORKS: 'fireworks',
} as const;

export type ProviderId = typeof PROVIDERS[keyof typeof PROVIDERS];

/**
 * Environment variable names for reference
 * (These are checked as fallback if not configured in Admin UI)
 */
export const PROVIDER_ENV_VARS = {
  openai: {
    apiKey: 'OPENAI_API_KEY',
    apiBase: 'OPENAI_BASE_URL',
  },
  gemini: {
    apiKey: 'GEMINI_API_KEY',
  },
  mistral: {
    apiKey: 'MISTRAL_API_KEY',
  },
  ollama: {
    apiBase: 'OLLAMA_API_BASE',
  },
  anthropic: {
    apiKey: 'ANTHROPIC_API_KEY',
  },
  deepseek: {
    apiKey: 'DEEPSEEK_API_KEY',
  },
  fireworks: {
    apiKey: 'FIREWORKS_AI_API_KEY',
  },
} as const;

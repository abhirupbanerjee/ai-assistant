/**
 * Provider Balance API Clients
 *
 * Fetches remaining balance/credits from LLM provider APIs where available.
 * Returns null for providers without a public balance API.
 */

import { getProviderApiKey } from './db/compat/llm-providers';

export interface ProviderBalance {
  providerId: string;
  providerName: string;
  balance: number | null;
  currency: string;
  limit: number | null;
  usageThisMonth: number | null;
  lastUpdated: string;
  error?: string;
}

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  mistral: 'Mistral AI',
  deepseek: 'DeepSeek',
  fireworks: 'Fireworks AI',
  moonshot: 'Moonshot AI',
  ollama: 'Ollama (Local)',
  'ollama-cloud': 'Ollama Cloud',
};

export async function getProviderBalance(providerId: string): Promise<ProviderBalance | null> {
  switch (providerId) {
    case 'openai':
      return getOpenAIBalance();
    case 'fireworks':
      return getFireworksBalance();
    default:
      return null;
  }
}

async function getOpenAIBalance(): Promise<ProviderBalance | null> {
  const apiKey = await getProviderApiKey('openai');
  if (!apiKey) {
    return {
      providerId: 'openai',
      providerName: PROVIDER_NAMES.openai,
      balance: null,
      currency: 'USD',
      limit: null,
      usageThisMonth: null,
      lastUpdated: new Date().toISOString(),
      error: 'No API key configured',
    };
  }

  try {
    const res = await fetch('https://api.openai.com/dashboard/billing/credit_grants', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return {
        providerId: 'openai',
        providerName: PROVIDER_NAMES.openai,
        balance: null,
        currency: 'USD',
        limit: null,
        usageThisMonth: null,
        lastUpdated: new Date().toISOString(),
        error: `API error: ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      total_available?: number;
      total_granted?: number;
      total_used?: number;
    };
    return {
      providerId: 'openai',
      providerName: PROVIDER_NAMES.openai,
      balance: data.total_available ?? null,
      currency: 'USD',
      limit: data.total_granted ?? null,
      usageThisMonth: data.total_used ?? null,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err) {
    return {
      providerId: 'openai',
      providerName: PROVIDER_NAMES.openai,
      balance: null,
      currency: 'USD',
      limit: null,
      usageThisMonth: null,
      lastUpdated: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

async function getFireworksBalance(): Promise<ProviderBalance | null> {
  const apiKey = await getProviderApiKey('fireworks');
  if (!apiKey) {
    return {
      providerId: 'fireworks',
      providerName: PROVIDER_NAMES.fireworks,
      balance: null,
      currency: 'USD',
      limit: null,
      usageThisMonth: null,
      lastUpdated: new Date().toISOString(),
      error: 'No API key configured',
    };
  }

  try {
    const res = await fetch('https://api.fireworks.ai/billing/v1/balance', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return {
        providerId: 'fireworks',
        providerName: PROVIDER_NAMES.fireworks,
        balance: null,
        currency: 'USD',
        limit: null,
        usageThisMonth: null,
        lastUpdated: new Date().toISOString(),
        error: `API error: ${res.status}`,
      };
    }
    const data = (await res.json()) as { balance?: number; currency?: string };
    return {
      providerId: 'fireworks',
      providerName: PROVIDER_NAMES.fireworks,
      balance: data.balance ?? null,
      currency: data.currency || 'USD',
      limit: null,
      usageThisMonth: null,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err) {
    return {
      providerId: 'fireworks',
      providerName: PROVIDER_NAMES.fireworks,
      balance: null,
      currency: 'USD',
      limit: null,
      usageThisMonth: null,
      lastUpdated: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

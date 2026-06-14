/**
 * Provider Balance API Clients
 *
 * Fetches remaining balance/credits or spend data from LLM provider APIs where available.
 *
 * Data types:
 * - 'balance': Provider returns remaining wallet credit (e.g. DeepSeek, Fireworks, Moonshot)
 * - 'spend':   Provider returns consumption/spend for a period (e.g. OpenAI, Anthropic)
 *
 * Providers without a public balance/cost API return null.
 *
 * Admin keys: OpenAI and Anthropic require admin-level API keys for cost endpoints.
 * Set OPENAI_ADMIN_API_KEY and ANTHROPIC_ADMIN_API_KEY env vars to enable spend tracking.
 */

import { getProviderApiKey, getProviderApiBase } from './db/compat/llm-providers';
import { getRedisClient } from './redis';

// ============ Types ============

export interface ProviderBalance {
  providerId: string;
  providerName: string;
  /** 'balance' = remaining wallet credit; 'spend' = consumption this period */
  dataType: 'balance' | 'spend';
  /** For 'balance': remaining credits. For 'spend': amount spent this period */
  balance: number | null;
  currency: string;
  /** Monthly spending limit (if known) */
  limit: number | null;
  /** Usage/spend this month */
  usageThisMonth: number | null;
  lastUpdated: string;
  error?: string;
  /** Whether an admin-level API key is required (and may be missing) */
  adminKeyRequired?: boolean;
}

// ============ Constants ============

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

/** Redis cache TTL in seconds — 10 minutes to avoid hammering provider APIs */
const CACHE_TTL = 600;

function cacheKey(providerId: string): string {
  return `provider-balance:${providerId}`;
}

// ============ Cache Helpers ============

async function getCachedBalance(providerId: string): Promise<ProviderBalance | null> {
  try {
    const redis = await getRedisClient();
    const raw = await redis.get(cacheKey(providerId));
    if (!raw) return null;
    return JSON.parse(raw) as ProviderBalance;
  } catch {
    return null;
  }
}

async function setCachedBalance(providerId: string, data: ProviderBalance): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.setEx(cacheKey(providerId), CACHE_TTL, JSON.stringify(data));
  } catch {
    // Cache write failure is non-critical
  }
}

// ============ Main Entry ============

export async function getProviderBalance(providerId: string): Promise<ProviderBalance | null> {
  // Check cache first
  const cached = await getCachedBalance(providerId);
  if (cached) return cached;

  let result: ProviderBalance | null;

  switch (providerId) {
    case 'openai':
      result = await getOpenAIBalance();
      break;
    case 'anthropic':
      result = await getAnthropicBalance();
      break;
    case 'deepseek':
      result = await getDeepSeekBalance();
      break;
    case 'moonshot':
      result = await getMoonshotBalance();
      break;
    case 'fireworks':
      result = await getFireworksBalance();
      break;
    default:
      return null;
  }

  // Cache successful results (even those with errors, to avoid retry storms)
  if (result) {
    await setCachedBalance(providerId, result);
  }

  return result;
}

// ============ Provider Clients ============

/**
 * OpenAI — Spend tracking via /v1/organization/costs
 *
 * Requires an admin API key (sk-admin-...). The standard sk-... key will get 403.
 * Set OPENAI_ADMIN_API_KEY env var, or use the regular key if it's an admin key.
 */
async function getOpenAIBalance(): Promise<ProviderBalance | null> {
  // Prefer admin key from env, fall back to standard key
  const adminKey = process.env.OPENAI_ADMIN_API_KEY;
  const standardKey = await getProviderApiKey('openai');
  const apiKey = adminKey || standardKey;

  if (!apiKey) {
    return {
      providerId: 'openai',
      providerName: PROVIDER_NAMES.openai,
      dataType: 'spend',
      balance: null,
      currency: 'USD',
      limit: null,
      usageThisMonth: null,
      lastUpdated: new Date().toISOString(),
      error: 'No API key configured',
    };
  }

  try {
    // Calculate current month date range
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startTime = startOfMonth.toISOString().split('T')[0];
    const endTime = now.toISOString().split('T')[0];

    const res = await fetch(
      `https://api.openai.com/v1/organization/costs?start_time=${startTime}&end_time=${endTime}&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!res.ok) {
      const isForbidden = res.status === 403 || res.status === 401;
      return {
        providerId: 'openai',
        providerName: PROVIDER_NAMES.openai,
        dataType: 'spend',
        balance: null,
        currency: 'USD',
        limit: null,
        usageThisMonth: null,
        lastUpdated: new Date().toISOString(),
        error: isForbidden
          ? 'Admin API key required (set OPENAI_ADMIN_API_KEY)'
          : `API error: ${res.status}`,
        adminKeyRequired: isForbidden,
      };
    }

    const data = (await res.json()) as {
      data?: Array<{ cost?: number }>;
      total_cost?: number;
    };

    // The costs endpoint returns an array of daily cost entries
    let totalSpend = 0;
    if (data.data && Array.isArray(data.data)) {
      totalSpend = data.data.reduce((sum, entry) => sum + (entry.cost ?? 0), 0);
    } else if (data.total_cost !== undefined) {
      totalSpend = data.total_cost;
    }

    return {
      providerId: 'openai',
      providerName: PROVIDER_NAMES.openai,
      dataType: 'spend',
      balance: totalSpend,
      currency: 'USD',
      limit: null,
      usageThisMonth: totalSpend,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err) {
    return {
      providerId: 'openai',
      providerName: PROVIDER_NAMES.openai,
      dataType: 'spend',
      balance: null,
      currency: 'USD',
      limit: null,
      usageThisMonth: null,
      lastUpdated: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Anthropic — Spend tracking via /v1/organizations/cost_report
 *
 * Requires an admin API key. Set ANTHROPIC_ADMIN_API_KEY env var.
 */
async function getAnthropicBalance(): Promise<ProviderBalance | null> {
  const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  const standardKey = await getProviderApiKey('anthropic');
  const apiKey = adminKey || standardKey;

  if (!apiKey) {
    return {
      providerId: 'anthropic',
      providerName: PROVIDER_NAMES.anthropic,
      dataType: 'spend',
      balance: null,
      currency: 'USD',
      limit: null,
      usageThisMonth: null,
      lastUpdated: new Date().toISOString(),
      error: 'No API key configured',
    };
  }

  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startTime = startOfMonth.toISOString().split('T')[0];
    const endTime = now.toISOString().split('T')[0];

    const res = await fetch(
      `https://api.anthropic.com/v1/organizations/cost_report?start_date=${startTime}&end_date=${endTime}`,
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      }
    );

    if (!res.ok) {
      const isForbidden = res.status === 403 || res.status === 401;
      return {
        providerId: 'anthropic',
        providerName: PROVIDER_NAMES.anthropic,
        dataType: 'spend',
        balance: null,
        currency: 'USD',
        limit: null,
        usageThisMonth: null,
        lastUpdated: new Date().toISOString(),
        error: isForbidden
          ? 'Admin API key required (set ANTHROPIC_ADMIN_API_KEY)'
          : `API error: ${res.status}`,
        adminKeyRequired: isForbidden,
      };
    }

    const data = (await res.json()) as {
      total_cost?: number;
      amount?: number;
      costs?: Array<{ amount?: number }>;
    };

    // Parse spend — Anthropic response format varies
    let totalSpend = 0;
    if (data.total_cost !== undefined) {
      totalSpend = data.total_cost;
    } else if (data.amount !== undefined) {
      totalSpend = data.amount;
    } else if (data.costs && Array.isArray(data.costs)) {
      totalSpend = data.costs.reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
    }

    return {
      providerId: 'anthropic',
      providerName: PROVIDER_NAMES.anthropic,
      dataType: 'spend',
      balance: totalSpend,
      currency: 'USD',
      limit: null,
      usageThisMonth: totalSpend,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err) {
    return {
      providerId: 'anthropic',
      providerName: PROVIDER_NAMES.anthropic,
      dataType: 'spend',
      balance: null,
      currency: 'USD',
      limit: null,
      usageThisMonth: null,
      lastUpdated: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * DeepSeek — Wallet balance via GET /user/balance
 *
 * Uses the standard API key. Returns remaining balance and usage.
 */
async function getDeepSeekBalance(): Promise<ProviderBalance | null> {
  const apiKey = await getProviderApiKey('deepseek');
  if (!apiKey) {
    return {
      providerId: 'deepseek',
      providerName: PROVIDER_NAMES.deepseek,
      dataType: 'balance',
      balance: null,
      currency: 'CNY',
      limit: null,
      usageThisMonth: null,
      lastUpdated: new Date().toISOString(),
      error: 'No API key configured',
    };
  }

  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      return {
        providerId: 'deepseek',
        providerName: PROVIDER_NAMES.deepseek,
        dataType: 'balance',
        balance: null,
        currency: 'CNY',
        limit: null,
        usageThisMonth: null,
        lastUpdated: new Date().toISOString(),
        error: `API error: ${res.status}`,
      };
    }

    const data = (await res.json()) as {
      balance_infos?: Array<{
        currency?: string;
        total_balance?: string;
        granted_balance?: string;
        topped_up_balance?: string;
      }>;
    };

    // DeepSeek returns an array of balance infos per currency
    // Default currency is CNY; some accounts also have USD
    const info = data.balance_infos?.[0];
    const totalBalance = info?.total_balance ? parseFloat(info.total_balance) : null;
    const granted = info?.granted_balance ? parseFloat(info.granted_balance) : null;
    const toppedUp = info?.topped_up_balance ? parseFloat(info.topped_up_balance) : null;
    const currency = info?.currency || 'CNY';

    return {
      providerId: 'deepseek',
      providerName: PROVIDER_NAMES.deepseek,
      dataType: 'balance',
      balance: totalBalance,
      currency,
      limit: granted,
      usageThisMonth: toppedUp !== null && totalBalance !== null && granted !== null
        ? Math.max(0, granted + toppedUp - totalBalance)
        : null,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err) {
    return {
      providerId: 'deepseek',
      providerName: PROVIDER_NAMES.deepseek,
      dataType: 'balance',
      balance: null,
      currency: 'CNY',
      limit: null,
      usageThisMonth: null,
      lastUpdated: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Moonshot AI — Wallet balance via GET /v1/users/me/balance
 *
 * Uses the standard API key. Returns remaining balance.
 */
async function getMoonshotBalance(): Promise<ProviderBalance | null> {
  const apiKey = await getProviderApiKey('moonshot');
  const apiBase = await getProviderApiBase('moonshot');
  if (!apiKey) {
    return {
      providerId: 'moonshot',
      providerName: PROVIDER_NAMES.moonshot,
      dataType: 'balance',
      balance: null,
      currency: 'CNY',
      limit: null,
      usageThisMonth: null,
      lastUpdated: new Date().toISOString(),
      error: 'No API key configured',
    };
  }

  try {
    const baseUrl = apiBase || 'https://api.moonshot.cn';
    const res = await fetch(`${baseUrl}/v1/users/me/balance`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      return {
        providerId: 'moonshot',
        providerName: PROVIDER_NAMES.moonshot,
        dataType: 'balance',
        balance: null,
        currency: 'CNY',
        limit: null,
        usageThisMonth: null,
        lastUpdated: new Date().toISOString(),
        error: `API error: ${res.status}`,
      };
    }

    const data = (await res.json()) as {
      data?: {
        available_balance?: string;
        cash_balance?: string;
        gifted_balance?: string;
        total_balance?: string;
        currency?: string;
      };
      available_balance?: string;
      cash_balance?: string;
      gifted_balance?: string;
      total_balance?: string;
      currency?: string;
    };

    // Moonshot returns balance either nested in data or at top level
    const info = data.data || data;
    const totalBalance = info.total_balance ? parseFloat(info.total_balance) : null;
    const available = info.available_balance ? parseFloat(info.available_balance) : null;
    const gifted = info.gifted_balance ? parseFloat(info.gifted_balance) : null;
    const currency = info.currency || 'CNY';

    return {
      providerId: 'moonshot',
      providerName: PROVIDER_NAMES.moonshot,
      dataType: 'balance',
      balance: available ?? totalBalance,
      currency,
      limit: gifted,
      usageThisMonth: totalBalance !== null && available !== null
        ? Math.max(0, totalBalance - available)
        : null,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err) {
    return {
      providerId: 'moonshot',
      providerName: PROVIDER_NAMES.moonshot,
      dataType: 'balance',
      balance: null,
      currency: 'CNY',
      limit: null,
      usageThisMonth: null,
      lastUpdated: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Fireworks AI — Wallet balance via GET /billing/v1/balance
 *
 * Uses the standard API key. Returns remaining balance.
 */
async function getFireworksBalance(): Promise<ProviderBalance | null> {
  const apiKey = await getProviderApiKey('fireworks');
  if (!apiKey) {
    return {
      providerId: 'fireworks',
      providerName: PROVIDER_NAMES.fireworks,
      dataType: 'balance',
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
        dataType: 'balance',
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
      dataType: 'balance',
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
      dataType: 'balance',
      balance: null,
      currency: 'USD',
      limit: null,
      usageThisMonth: null,
      lastUpdated: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

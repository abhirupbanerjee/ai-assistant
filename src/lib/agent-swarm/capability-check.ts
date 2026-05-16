/**
 * Moonshot Capability Check
 *
 * Verifies Moonshot API key validity, account balance, and model availability.
 * Moonshot does not expose a subscription/features API, so this is the best
 * available verification mechanism.
 */

import { getApiKey } from '@/lib/provider-helpers';
import { getMoonshotBaseUrl } from './moonshot-config';

export interface MoonshotCapabilityResult {
  apiKeyValid: boolean;
  balance: number | null;
  modelAvailable: boolean;
  errors: string[];
}

export async function checkMoonshotCapabilities(model: string = 'kimi-k2.6'): Promise<MoonshotCapabilityResult> {
  const result: MoonshotCapabilityResult = {
    apiKeyValid: false,
    balance: null,
    modelAvailable: false,
    errors: [],
  };

  const apiKey = await getApiKey('moonshot');
  const baseUrl = await getMoonshotBaseUrl();
  if (!apiKey) {
    result.errors.push('Moonshot API key not configured');
    return result;
  }

  try {
    const balanceRes = await fetch(`${baseUrl}/users/me/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (balanceRes.ok) {
      const balanceData = await balanceRes.json() as { data?: { total_balance?: number } };
      result.apiKeyValid = true;
      result.balance = balanceData.data?.total_balance ?? null;
    } else {
      result.errors.push(`Balance check failed: ${balanceRes.status}`);
    }
  } catch (err) {
    result.errors.push(`Balance check error: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const modelsRes = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (modelsRes.ok) {
      const modelsData = await modelsRes.json() as { data?: Array<{ id: string }> };
      const availableModels = modelsData.data?.map(m => m.id) || [];
      result.modelAvailable = availableModels.includes(model);
      if (!result.modelAvailable) {
        result.errors.push(`Model ${model} not available`);
      }
    } else {
      result.errors.push(`Models check failed: ${modelsRes.status}`);
    }
  } catch (err) {
    result.errors.push(`Models check error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

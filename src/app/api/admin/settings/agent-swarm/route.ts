/**
 * Agent Swarm Settings API
 *
 * Manages global agent swarm mode settings and Moonshot connection status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getAgentSwarmSettings,
  setAgentSwarmSettings,
  type AgentSwarmSettings,
} from '@/lib/db/compat/agent-swarm';
import { getApiKey } from '@/lib/provider-helpers';

interface MoonshotCapabilityResult {
  apiKeyValid: boolean;
  balance: number | null;
  modelAvailable: boolean;
  errors: string[];
}

async function checkMoonshotCapabilities(model: string): Promise<MoonshotCapabilityResult> {
  const result: MoonshotCapabilityResult = {
    apiKeyValid: false,
    balance: null,
    modelAvailable: false,
    errors: [],
  };

  const apiKey = await getApiKey('moonshot');
  if (!apiKey) {
    result.errors.push('Moonshot API key not configured');
    return result;
  }

  try {
    // Check balance
    const balanceRes = await fetch('https://api.moonshot.ai/v1/users/me/balance', {
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
    // Check available models
    const modelsRes = await fetch('https://api.moonshot.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (modelsRes.ok) {
      const modelsData = await modelsRes.json() as { data?: Array<{ id: string }> };
      const availableModels = modelsData.data?.map(m => m.id) || [];
      result.modelAvailable = availableModels.includes(model);
      if (!result.modelAvailable) {
        result.errors.push(`Model ${model} not available in this account`);
      }
    } else {
      result.errors.push(`Models check failed: ${modelsRes.status}`);
    }
  } catch (err) {
    result.errors.push(`Models check error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin' && user.role !== 'superuser') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const settings = await getAgentSwarmSettings();
    const moonshotKey = await getApiKey('moonshot');
    const moonshotConfigured = !!moonshotKey;

    let capabilities: MoonshotCapabilityResult | null = null;
    if (moonshotConfigured) {
      capabilities = await checkMoonshotCapabilities(settings.model);
    }

    return NextResponse.json({
      settings,
      moonshotConfigured,
      capabilities,
    });
  } catch (error) {
    console.error('[Agent Swarm Settings API] Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agent swarm settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { enabled, model, maxTokens, systemPrompt } = body;

    // Validate inputs
    if (enabled === true) {
      const moonshotKey = await getApiKey('moonshot');
      if (!moonshotKey) {
        return NextResponse.json(
          { error: 'Cannot enable agent swarm: Moonshot API key is not configured' },
          { status: 400 }
        );
      }

      const capabilities = await checkMoonshotCapabilities(model || 'kimi-k2.6');
      if (!capabilities.apiKeyValid) {
        return NextResponse.json(
          { error: `Cannot enable agent swarm: ${capabilities.errors.join(', ')}` },
          { status: 400 }
        );
      }
    }

    if (maxTokens !== undefined && (typeof maxTokens !== 'number' || maxTokens < 1024 || maxTokens > 128000)) {
      return NextResponse.json(
        { error: 'Invalid maxTokens: must be between 1024 and 128000' },
        { status: 400 }
      );
    }

    if (systemPrompt !== undefined && typeof systemPrompt !== 'string') {
      return NextResponse.json(
        { error: 'Invalid systemPrompt: must be a string' },
        { status: 400 }
      );
    }

    const updates: Partial<AgentSwarmSettings> = {};
    if (enabled !== undefined) updates.enabled = enabled;
    if (model !== undefined) updates.model = model;
    if (maxTokens !== undefined) updates.maxTokens = maxTokens;
    if (systemPrompt !== undefined) updates.systemPrompt = systemPrompt;

    await setAgentSwarmSettings(updates, user.email);

    const finalSettings = await getAgentSwarmSettings();

    return NextResponse.json({
      success: true,
      settings: finalSettings,
      updatedAt: new Date().toISOString(),
      updatedBy: user.email,
    });
  } catch (error) {
    console.error('[Agent Swarm Settings API] Error saving settings:', error);
    return NextResponse.json(
      { error: 'Failed to save agent swarm settings' },
      { status: 500 }
    );
  }
}

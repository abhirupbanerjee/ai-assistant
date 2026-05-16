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
import { checkMoonshotCapabilities } from '@/lib/agent-swarm/capability-check';
import type { MoonshotCapabilityResult } from '@/lib/agent-swarm/capability-check';

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

    // Strict enforcement: Agent Swarm is Kimi K2.6 only
    if (model !== undefined && model !== 'kimi-k2.6') {
      return NextResponse.json(
        { error: 'Invalid model: Agent Swarm only supports kimi-k2.6' },
        { status: 400 }
      );
    }

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
      if (!capabilities.apiKeyValid || !capabilities.modelAvailable) {
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
    // model is hard-coded to kimi-k2.6; do not persist from body
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

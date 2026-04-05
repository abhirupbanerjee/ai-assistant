/**
 * Routes Health Check API
 *
 * Returns health status for both LLM routes:
 * - Route 1: LiteLLM proxy health via /health/liveliness endpoint (no auth required)
 * - Route 2: Fireworks AI reachability + Anthropic API key configured
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getApiKey } from '@/lib/provider-helpers';

interface RouteHealth {
  route1: { healthy: boolean; latencyMs: number | null; error?: string };
  route2: {
    fireworks: { healthy: boolean; latencyMs: number | null; configured: boolean; error?: string };
    claude: { configured: boolean };
  };
}

/**
 * GET - Check health of both routes
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check both routes in parallel
    const [route1Health, fireworksHealth, claudeConfigured] = await Promise.all([
      checkRoute1Health(),
      checkFireworksHealth(),
      checkClaudeConfigured(),
    ]);

    const health: RouteHealth = {
      route1: route1Health,
      route2: {
        fireworks: fireworksHealth,
        claude: { configured: claudeConfigured },
      },
    };

    return NextResponse.json(health);
  } catch (error) {
    console.error('[Routes Health API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to check route health' },
      { status: 500 }
    );
  }
}

async function checkRoute1Health(): Promise<{ healthy: boolean; latencyMs: number | null; error?: string }> {
  const baseUrl = process.env.OPENAI_BASE_URL;
  if (!baseUrl) {
    return { healthy: false, latencyMs: null, error: 'OPENAI_BASE_URL not configured' };
  }

  // Use /health/liveliness (no auth required) instead of /health (requires LITELLM_MASTER_KEY)
  const healthUrl = baseUrl.replace(/\/v1\/?$/, '') + '/health/liveliness';
  const start = Date.now();

  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return { healthy: true, latencyMs };
    }
    return { healthy: false, latencyMs, error: `HTTP ${res.status}` };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function checkFireworksHealth(): Promise<{ healthy: boolean; latencyMs: number | null; configured: boolean; error?: string }> {
  const apiKey = await getApiKey('fireworks');
  if (!apiKey) {
    return { healthy: false, latencyMs: null, configured: false, error: 'FIREWORKS_AI_API_KEY not configured' };
  }

  const start = Date.now();
  try {
    const res = await fetch('https://api.fireworks.ai/inference/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return { healthy: true, latencyMs, configured: true };
    }
    return { healthy: false, latencyMs, configured: true, error: `HTTP ${res.status}` };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, configured: true, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function checkClaudeConfigured(): Promise<boolean> {
  const apiKey = await getApiKey('anthropic');
  return !!apiKey;
}

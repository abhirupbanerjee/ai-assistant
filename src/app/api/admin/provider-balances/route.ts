/**
 * Admin Provider Balances API
 *
 * GET /api/admin/provider-balances — Fetch balance/spend for configured LLM providers
 * Query params:
 *   nocache=1 — Bypass Redis cache and fetch fresh data
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth';
import { getProviderBalance } from '@/lib/provider-balance';
import { getRedisClient } from '@/lib/redis';

const PROVIDER_IDS = [
  'openai',
  'anthropic',
  'gemini',
  'mistral',
  'deepseek',
  'fireworks',
  'moonshot',
  'ollama',
  'ollama-cloud',
];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireSuperAdmin();

    const nocache = request.nextUrl.searchParams.get('nocache') === '1';

    // If nocache, invalidate all cached balances first
    if (nocache) {
      try {
        const redis = await getRedisClient();
        const keys = await redis.keys('provider-balance:*');
        if (keys.length > 0) {
          await redis.del(keys);
        }
      } catch {
        // Redis failure is non-critical
      }
    }

    const balances = await Promise.all(
      PROVIDER_IDS.map((id) => getProviderBalance(id))
    );

    const available = balances.filter((b) => b !== null);
    const unavailable = PROVIDER_IDS.filter(
      (id) => !balances.find((b) => b?.providerId === id)
    );

    return NextResponse.json({
      balances: available,
      unavailable,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error getting provider balances:', error);
    return NextResponse.json(
      { error: 'Failed to get provider balances' },
      { status: 500 }
    );
  }
}

/**
 * Admin Provider Balances API
 *
 * GET /api/admin/provider-balances — Fetch balance for configured LLM providers
 */

import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth';
import { getProviderBalance } from '@/lib/provider-balance';

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

export async function GET(): Promise<NextResponse> {
  try {
    await requireSuperAdmin();

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

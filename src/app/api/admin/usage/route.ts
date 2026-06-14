/**
 * Admin Token Usage API
 *
 * GET /api/admin/usage — Dashboard data with filters
 * Query params: days, category, userId, model, nocache
 *
 * Cost fields are only included for super_admin users.
 * Regular admins receive token-only data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getTokenUsageSummary } from '@/lib/db/compat';
import type { TokenUsageFilters, TokenUsageSummary } from '@/lib/db/compat';
import { hashQuery, cacheQuery, getCachedQuery } from '@/lib/redis';

const CACHE_TTL = 3600; // 1 hour
const CACHE_PREFIX = 'usage:';

/** Strip all cost-related fields from the summary for non-super_admin users */
function stripCostData(summary: TokenUsageSummary): TokenUsageSummary {
  return {
    total_tokens: summary.total_tokens,
    total_calls: summary.total_calls,
    total_cost: 0,
    byCategory: summary.byCategory.map((c) => ({
      ...c,
      total_cost: 0,
    })),
    byUser: summary.byUser.map((u) => ({
      ...u,
      total_cost: 0,
    })),
    byModel: summary.byModel.map((m) => ({
      ...m,
      total_cost: 0,
    })),
    daily: summary.daily.map((d) => ({
      ...d,
      chat_cost: 0,
      autonomous_cost: 0,
      embeddings_cost: 0,
      workspace_cost: 0,
    })),
    modelsWithoutCost: [],
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireAdmin();
    const includeCost = user.isSuperAdmin === true;

    const url = new URL(request.url);
    const filters: TokenUsageFilters = {
      days: parseInt(url.searchParams.get('days') || '7', 10),
      category: url.searchParams.get('category') || undefined,
      userId: url.searchParams.get('userId')
        ? parseInt(url.searchParams.get('userId')!, 10)
        : undefined,
      model: url.searchParams.get('model') || undefined,
    };
    const noCache = url.searchParams.get('nocache') === '1';

    // Cache key includes includeCost flag to prevent cost data leaking
    // between super_admin and regular admin cached responses
    const cacheKey = `${CACHE_PREFIX}${includeCost}:${hashQuery(JSON.stringify(filters))}`;
    if (!noCache) {
      const cached = await getCachedQuery(cacheKey);
      if (cached) {
        return NextResponse.json(JSON.parse(cached));
      }
    }

    let summary = await getTokenUsageSummary(filters);

    // Strip cost data for non-super_admin users
    if (!includeCost) {
      summary = stripCostData(summary);
    }

    // Cache the result (already stripped if needed)
    await cacheQuery(cacheKey, JSON.stringify(summary), CACHE_TTL);

    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error getting token usage:', error);
    return NextResponse.json(
      { error: 'Failed to get token usage' },
      { status: 500 }
    );
  }
}

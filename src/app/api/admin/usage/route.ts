/**
 * Admin Token Usage API
 *
 * GET /api/admin/usage — Dashboard data with filters
 * Query params: days, category, userId, model, nocache
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getTokenUsageSummary } from '@/lib/db/compat';
import type { TokenUsageFilters } from '@/lib/db/compat';
import { hashQuery, cacheQuery, getCachedQuery } from '@/lib/redis';

const CACHE_TTL = 3600; // 1 hour
const CACHE_PREFIX = 'usage:';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();

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

    // Check cache unless bypass requested
    const cacheKey = `${CACHE_PREFIX}${hashQuery(JSON.stringify(filters))}`;
    if (!noCache) {
      const cached = await getCachedQuery(cacheKey);
      if (cached) {
        return NextResponse.json(JSON.parse(cached));
      }
    }

    const summary = await getTokenUsageSummary(filters);

    // Cache the result
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

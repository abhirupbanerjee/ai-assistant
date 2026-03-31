/**
 * Admin Token Usage Filters API
 *
 * GET /api/admin/usage/filters — Available filter options
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getTokenUsageFilterOptions } from '@/lib/db/compat';
import { cacheQuery, getCachedQuery } from '@/lib/redis';

const CACHE_KEY = 'usage:filters';
const CACHE_TTL = 3600; // 1 hour

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin();

    // Check cache
    const cached = await getCachedQuery(CACHE_KEY);
    if (cached) {
      return NextResponse.json(JSON.parse(cached));
    }

    const options = await getTokenUsageFilterOptions();

    await cacheQuery(CACHE_KEY, JSON.stringify(options), CACHE_TTL);

    return NextResponse.json(options);
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error getting usage filters:', error);
    return NextResponse.json(
      { error: 'Failed to get filter options' },
      { status: 500 }
    );
  }
}

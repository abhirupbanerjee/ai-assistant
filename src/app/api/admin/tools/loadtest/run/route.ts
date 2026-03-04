/**
 * Admin Load Test API - Trigger and retrieve k6 Cloud load tests
 *
 * POST /api/admin/tools/loadtest/run - Run a new load test
 * GET  /api/admin/tools/loadtest/run - Get results for a URL or list recent tests
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getLoadTestConfig,
  executeLoadTest,
} from '@/lib/tools/loadtest';
import { getLatestLoadTestResult, getAllLoadTestResults } from '@/lib/db/compat/loadtest-results';

// Simple in-memory daily rate limit counter (resets on restart, acceptable for admin-only)
const dailyCounter = { count: 0, resetAt: 0 };

function checkDailyRateLimit(limit: number): { allowed: boolean; remaining: number } {
  const now = Date.now();
  if (now > dailyCounter.resetAt) {
    dailyCounter.count = 0;
    dailyCounter.resetAt = now + 24 * 60 * 60 * 1000;
  }
  if (dailyCounter.count >= limit) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: limit - dailyCounter.count };
}

/**
 * POST /api/admin/tools/loadtest/run
 * Trigger a new load test
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { url, users, duration } = body as {
      url?: string;
      users?: number;
      duration?: number;
    };

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    // Get config
    const { enabled, config } = await getLoadTestConfig();
    if (!enabled) {
      return NextResponse.json({ error: 'Load testing is disabled' }, { status: 400 });
    }

    // Check rate limit
    const rateCheck = checkDailyRateLimit(config.rateLimitPerDay);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Daily test limit reached. Try again tomorrow.' },
        { status: 429 }
      );
    }

    // Execute test (this may take several minutes)
    const effectiveUsers = users || config.maxConcurrentUsers;
    const effectiveDuration = duration || config.defaultDuration;

    const result = await executeLoadTest(
      url,
      Math.min(effectiveUsers, config.maxConcurrentUsers),
      Math.min(effectiveDuration, config.maxDuration),
      config,
      user.email
    );

    if (result.success) {
      dailyCounter.count++;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[LoadTest API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/tools/loadtest/run
 * Get latest results for a URL or list recent tests
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const url = request.nextUrl.searchParams.get('url');

    if (url) {
      // Get latest result for specific URL
      const result = await getLatestLoadTestResult(url);
      if (!result) {
        return NextResponse.json({ found: false });
      }

      return NextResponse.json({
        found: true,
        result: {
          ...result,
          metrics: JSON.parse(result.metrics_json),
        },
      });
    }

    // List recent tests
    const results = await getAllLoadTestResults(20);
    return NextResponse.json({
      results: results.map(r => ({
        ...r,
        metrics: JSON.parse(r.metrics_json),
      })),
    });
  } catch (error) {
    console.error('[LoadTest API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


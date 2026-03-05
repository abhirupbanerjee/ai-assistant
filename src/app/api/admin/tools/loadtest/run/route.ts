/**
 * Admin Load Test API - Trigger and retrieve k6 Cloud load tests
 *
 * POST /api/admin/tools/loadtest/run - Start a new load test (returns immediately, runs async)
 * GET  /api/admin/tools/loadtest/run?testId=<id> - Poll running test status
 * GET  /api/admin/tools/loadtest/run?url=<url> - Get latest results for a URL
 * GET  /api/admin/tools/loadtest/run - List recent tests
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getLoadTestConfig,
  startTestAsync,
  getTestStatus,
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
 * Start a new load test (non-blocking — returns testId for polling)
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

    // Start test async (non-blocking)
    const effectiveUsers = users || config.maxConcurrentUsers;
    const effectiveDuration = duration || config.defaultDuration;
    const testId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    startTestAsync(
      testId,
      url,
      Math.min(effectiveUsers, config.maxConcurrentUsers),
      Math.min(effectiveDuration, config.maxDuration),
      config,
      user.email
    );

    dailyCounter.count++;

    return NextResponse.json({
      success: true,
      testId,
      message: 'Load test started. Poll GET ?testId= for status.',
    });
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
 * - ?testId=<id> → poll running test status
 * - ?url=<url>   → get latest stored result for a URL
 * - (no params)  → list recent tests
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

    // Poll active test by ID
    const testId = request.nextUrl.searchParams.get('testId');
    if (testId) {
      const status = getTestStatus(testId);
      if (!status) {
        return NextResponse.json({ error: 'Test not found' }, { status: 404 });
      }
      return NextResponse.json(status);
    }

    // Get latest result for specific URL
    const url = request.nextUrl.searchParams.get('url');
    if (url) {
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

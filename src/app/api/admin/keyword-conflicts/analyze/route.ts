/**
 * POST /api/admin/keyword-conflicts/analyze
 *
 * Analyzes keyword configurations for conflicts between
 * skills and tool routing rules using LLM.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { analyzeKeywordConflicts } from '@/lib/keyword-conflict-analyzer';
import type {
  AnalyzeConflictsRequest,
  AnalyzeConflictsResponse,
} from '@/types/keyword-conflicts';

// Simple in-memory rate limiting (1 request per minute per user)
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 60000;

export async function POST(
  request: NextRequest
): Promise<NextResponse<AnalyzeConflictsResponse>> {
  try {
    // Auth check
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (!user.isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Rate limiting
    const userKey = user.email || 'anonymous';
    const lastRequest = rateLimitMap.get(userKey) || 0;
    const now = Date.now();

    if (now - lastRequest < RATE_LIMIT_MS) {
      const waitSeconds = Math.ceil(
        (RATE_LIMIT_MS - (now - lastRequest)) / 1000
      );
      return NextResponse.json(
        {
          success: false,
          error: `Rate limited. Please wait ${waitSeconds} seconds before analyzing again.`,
        },
        { status: 429 }
      );
    }

    // Parse request body
    let options: AnalyzeConflictsRequest = {};
    try {
      const body = await request.json();
      options = {
        includeInactive: body.includeInactive === true,
        analysisScope: ['keywords', 'prompts', 'both'].includes(body.analysisScope)
          ? body.analysisScope
          : 'keywords',
      };
    } catch {
      // Empty body is OK, use defaults
    }

    // Run analysis
    const report = await analyzeKeywordConflicts(options);

    // Update rate limit
    rateLimitMap.set(userKey, now);

    return NextResponse.json({
      success: true,
      report,
    });
  } catch (error) {
    // LLM or parsing errors
    console.error('Keyword conflict analysis failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Analysis failed. Please try again.',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

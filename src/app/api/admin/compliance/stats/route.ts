/**
 * Compliance Statistics API Endpoint
 *
 * Provides compliance check statistics for admin dashboard.
 * Supports filtering by skill, date range, and decision type.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getComplianceStats, getRecentComplianceResults, getToolConfig } from '@/lib/db/compat';
import { COMPLIANCE_CHECKER_DEFAULTS } from '@/lib/tools/compliance-checker';
import type { ApiError } from '@/types';

/**
 * GET /api/admin/compliance/stats
 * Get compliance check statistics for admin dashboard
 *
 * Query parameters:
 * - skillId: Filter by skill ID
 * - from: Start date (ISO string)
 * - to: End date (ISO string)
 * - includeRecent: Include recent results (default: false)
 * - limit: Limit for recent results (default: 20)
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const skillIdParam = searchParams.get('skillId');
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const includeRecent = searchParams.get('includeRecent') === 'true';
    const limitParam = searchParams.get('limit');

    // Build filters
    const filters: {
      skillId?: number;
      from?: Date;
      to?: Date;
    } = {};

    if (skillIdParam) {
      const skillId = parseInt(skillIdParam, 10);
      if (!isNaN(skillId)) {
        filters.skillId = skillId;
      }
    }

    if (fromParam) {
      const from = new Date(fromParam);
      if (!isNaN(from.getTime())) {
        filters.from = from;
      }
    }

    if (toParam) {
      const to = new Date(toParam);
      if (!isNaN(to.getTime())) {
        filters.to = to;
      }
    }

    // Get compliance stats
    const stats = await getComplianceStats(filters);

    // Get tool config
    const toolConfig = await getToolConfig('compliance_checker');
    const config = toolConfig?.config as Record<string, unknown> || {};

    // Build response
    const response: Record<string, unknown> = {
      stats,
      config: {
        enabled: toolConfig?.isEnabled ?? COMPLIANCE_CHECKER_DEFAULTS.enabled,
        passThreshold: config.passThreshold ?? COMPLIANCE_CHECKER_DEFAULTS.passThreshold,
        warnThreshold: config.warnThreshold ?? COMPLIANCE_CHECKER_DEFAULTS.warnThreshold,
        enableHitl: config.enableHitl ?? COMPLIANCE_CHECKER_DEFAULTS.enableHitl,
        useLlmClarifications: config.useLlmClarifications ?? COMPLIANCE_CHECKER_DEFAULTS.useLlmClarifications,
      },
    };

    // Include recent results if requested
    if (includeRecent) {
      const limit = limitParam ? parseInt(limitParam, 10) : 20;
      response.recentResults = await getRecentComplianceResults({
        skillId: filters.skillId,
        limit: isNaN(limit) ? 20 : limit,
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Get compliance stats error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to get compliance statistics',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

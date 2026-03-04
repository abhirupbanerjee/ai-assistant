/**
 * Admin Agent Bot Analytics API
 *
 * GET /api/admin/agent-bots/[id]/analytics - Get usage statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAgentBotById,
  getUsageStats,
  listJobsForAgentBot,
  listApiKeys,
  getVersionById,
} from '@/lib/db/compat';
import { requireElevated } from '@/lib/auth';

// ============================================================================
// GET - Get Analytics
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    await requireElevated();
    const { id } = await params;

    const agentBot = await getAgentBotById(id);
    if (!agentBot) {
      return NextResponse.json(
        { error: 'Agent bot not found' },
        { status: 404 }
      );
    }

    // Get query parameters
    const url = new URL(request.url);
    const daysParam = url.searchParams.get('days');
    const days = daysParam ? parseInt(daysParam, 10) : 30;

    // Get usage statistics for current and previous periods
    const stats = await getUsageStats(id, days);
    const prevStats = await getUsageStats(id, days * 2); // Get double period for comparison

    // Calculate change percentages
    const prevRequests = prevStats.totalRequests - stats.totalRequests;
    const prevTokens = prevStats.totalTokens - stats.totalTokens;
    const requestsChange = prevRequests > 0
      ? ((stats.totalRequests - prevRequests) / prevRequests) * 100
      : 0;
    const tokensChange = prevTokens > 0
      ? ((stats.totalTokens - prevTokens) / prevTokens) * 100
      : 0;

    // Get recent jobs
    const recentJobs = await listJobsForAgentBot(id, 20);

    // Calculate success/failure counts
    const successfulRequests = recentJobs.filter((j) => j.status === 'completed').length;
    const failedRequests = recentJobs.filter((j) => j.status === 'failed').length;

    // Calculate average processing time
    const jobsWithTime = recentJobs.filter((j) => j.processing_time_ms);
    const avgProcessingTime =
      jobsWithTime.length > 0
        ? jobsWithTime.reduce((sum, j) => sum + (j.processing_time_ms || 0), 0) /
          jobsWithTime.length
        : 0;

    // Aggregate by output type with percentages
    const outputTypeCounts: Record<string, number> = {};
    for (const job of recentJobs) {
      const type = job.output_type || 'unknown';
      outputTypeCounts[type] = (outputTypeCounts[type] || 0) + 1;
    }
    const totalOutputs = Object.values(outputTypeCounts).reduce((a, b) => a + b, 0);
    const byOutputType = Object.entries(outputTypeCounts).map(([type, count]) => ({
      type,
      count,
      percentage: totalOutputs > 0 ? (count / totalOutputs) * 100 : 0,
    }));

    // Aggregate by API key with percentages
    const apiKeys = await listApiKeys(id);
    const apiKeyUsage: Record<string, { name: string; prefix: string; count: number }> = {};
    for (const key of apiKeys) {
      apiKeyUsage[key.id] = { name: key.name, prefix: key.key_prefix, count: 0 };
    }
    for (const job of recentJobs) {
      if (job.api_key_id && apiKeyUsage[job.api_key_id]) {
        apiKeyUsage[job.api_key_id].count++;
      }
    }
    const totalByKey = Object.values(apiKeyUsage).reduce((a, b) => a + b.count, 0);
    const byApiKey = Object.values(apiKeyUsage)
      .filter((k) => k.count > 0)
      .map((k) => ({
        key_name: k.name,
        key_prefix: k.prefix,
        requests: k.count,
        percentage: totalByKey > 0 ? (k.count / totalByKey) * 100 : 0,
      }));

    // Build version number lookup map
    const versionIds = [...new Set(recentJobs.map((j) => j.version_id))];
    const versionNumberMap: Record<string, number> = {};
    for (const versionId of versionIds) {
      const version = await getVersionById(versionId);
      if (version) {
        versionNumberMap[versionId] = version.version_number;
      }
    }

    return NextResponse.json({
      summary: {
        totalRequests: stats.totalRequests || 0,
        successfulRequests,
        failedRequests,
        totalTokens: stats.totalTokens || 0,
        avgProcessingTimeMs: Math.round(avgProcessingTime) || 0,
        requestsChange: Math.round(requestsChange * 10) / 10 || 0,
        tokensChange: Math.round(tokensChange * 10) / 10 || 0,
      },
      dailyStats: stats.dailyStats || [],
      byOutputType,
      byApiKey,
      recentJobs: recentJobs.map((job) => ({
        id: job.id,
        version_number: versionNumberMap[job.version_id] || 1,
        status: job.status,
        output_type: job.output_type,
        processing_time_ms: job.processing_time_ms,
        created_at: job.created_at,
        completed_at: job.completed_at,
        error_message: job.error_message,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error getting analytics:', error);
    return NextResponse.json(
      { error: 'Failed to get analytics' },
      { status: 500 }
    );
  }
}

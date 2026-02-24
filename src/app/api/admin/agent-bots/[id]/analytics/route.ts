/**
 * Admin Agent Bot Analytics API
 *
 * GET /api/admin/agent-bots/[id]/analytics - Get usage statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentBotById } from '@/lib/db/agent-bots';
import { getUsageStats, listJobsForAgentBot } from '@/lib/db/agent-bot-jobs';
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

    const agentBot = getAgentBotById(id);
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

    // Get usage statistics
    const stats = getUsageStats(id, days);

    // Get recent jobs
    const recentJobs = listJobsForAgentBot(id, 20);

    // Calculate success rate
    const completedJobs = recentJobs.filter((j) => j.status === 'completed').length;
    const failedJobs = recentJobs.filter((j) => j.status === 'failed').length;
    const totalJobs = completedJobs + failedJobs;
    const successRate = totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0;

    // Calculate average processing time
    const jobsWithTime = recentJobs.filter((j) => j.processing_time_ms);
    const avgProcessingTime =
      jobsWithTime.length > 0
        ? jobsWithTime.reduce((sum, j) => sum + (j.processing_time_ms || 0), 0) /
          jobsWithTime.length
        : 0;

    // Aggregate by output type
    const outputTypeCounts: Record<string, number> = {};
    for (const job of recentJobs) {
      const type = job.output_type || 'unknown';
      outputTypeCounts[type] = (outputTypeCounts[type] || 0) + 1;
    }

    // Aggregate by status
    const statusCounts: Record<string, number> = {};
    for (const job of recentJobs) {
      statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
    }

    return NextResponse.json({
      summary: {
        totalRequests: stats.totalRequests,
        totalTokens: stats.totalTokens,
        totalErrors: stats.totalErrors,
        successRate: Math.round(successRate * 10) / 10,
        avgProcessingTimeMs: Math.round(avgProcessingTime),
      },
      dailyStats: stats.dailyStats,
      byOutputType: outputTypeCounts,
      byStatus: statusCounts,
      recentJobs: recentJobs.map((job) => ({
        id: job.id,
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

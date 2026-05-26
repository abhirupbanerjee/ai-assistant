/**
 * Agent Bot Job Status API
 *
 * GET /api/agent-bots/[slug]/jobs/[jobId]
 *
 * Get the status and results of an async job.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateRequest,
  isAuthError,
  addRateLimitHeaders,
  agentBotErrors,
} from '@/lib/agent-bot/auth';
import { getJobWithOutputs, getActiveAgentBotBySlug } from '@/lib/db/compat';
import { getCurrentUser } from '@/lib/auth';
import type {
  JobStatusResponse,
  InvokeOutputItem,
  AgentBotError,
  RateLimitInfo,
} from '@/types/agent-bot';

// ============================================================================
// Admin Test Mode
// ============================================================================

/**
 * Check if admin test mode is enabled
 */
async function isAdminTest(request: NextRequest): Promise<boolean> {
  const adminTestHeader = request.headers.get('X-Admin-Test');
  if (adminTestHeader !== 'true') {
    return false;
  }

  // Verify user is authenticated as admin
  try {
    const user = await getCurrentUser();
    return user?.role === 'admin' || user?.role === 'superuser';
  } catch {
    return false;
  }
}

/**
 * Create mock rate limit info for admin testing
 */
function createMockRateLimitInfo(): RateLimitInfo {
  const now = new Date();
  return {
    limitMinute: 9999,
    remainingMinute: 9999,
    resetMinute: new Date(now.getTime() + 60000),
    limitDay: 99999,
    remainingDay: 99999,
    resetDay: new Date(now.getTime() + 86400000),
  };
}

// ============================================================================
// Route Handler
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; jobId: string }> }
): Promise<NextResponse<JobStatusResponse | AgentBotError>> {
  const { slug, jobId } = await params;

  // Check for admin test mode
  const adminTestMode = await isAdminTest(request);

  let agentBot;
  let rateLimitInfo: RateLimitInfo;

  if (adminTestMode) {
    // Admin test mode - bypass API key authentication
    const bot = await getActiveAgentBotBySlug(slug);
    if (!bot) {
      return agentBotErrors.agentBotNotFound();
    }
    agentBot = bot;
    rateLimitInfo = createMockRateLimitInfo();
  } else {
    // 1. Authenticate request
    const authResult = await authenticateRequest(request, slug);
    if (isAuthError(authResult)) {
      return authResult;
    }

    agentBot = authResult.agentBot;
    rateLimitInfo = authResult.rateLimitInfo;
  }

  try {
    // 2. Get job with outputs
    const job = await getJobWithOutputs(jobId);

    if (!job) {
      const response = agentBotErrors.jobNotFound();
      return addRateLimitHeaders(response, rateLimitInfo);
    }

    // 3. Verify job belongs to this agent bot
    if (job.agent_bot_id !== agentBot.id) {
      const response = agentBotErrors.jobNotFound();
      return addRateLimitHeaders(response, rateLimitInfo);
    }

    // 4. For non-admin mode, verify API key has access to this job
    if (!adminTestMode) {
      const authResult = await authenticateRequest(request, slug);
      if (!isAuthError(authResult)) {
        const apiKey = authResult.apiKey;
        // Jobs can be accessed by the key that created them OR any key for the same bot
        if (job.api_key_id !== apiKey.id && job.agent_bot_id !== apiKey.agent_bot_id) {
          const response = agentBotErrors.jobNotFound();
          return addRateLimitHeaders(response, rateLimitInfo);
        }
      }
    }

    // 5. Build response
    const response: JobStatusResponse = {
      jobId: job.id,
      status: job.status,
      createdAt: job.created_at,
      startedAt: job.started_at || undefined,
      completedAt: job.completed_at || undefined,
    };

    // Add outputs if job is completed
    if (job.status === 'completed' && job.outputs) {
      response.outputs = job.outputs.map((output) => {
        const item: InvokeOutputItem = {
          type: output.output_type,
        };

        // For text/json, include content directly
        if (output.content && (output.output_type === 'text' || output.output_type === 'json')) {
          try {
            item.content = output.output_type === 'json'
              ? JSON.parse(output.content)
              : output.content;
          } catch {
            item.content = output.content;
          }
        }

        // For file outputs, provide download URL
        if (output.filepath) {
          item.filename = output.filename || undefined;
          item.downloadUrl = `/api/agent-bots/${slug}/jobs/${jobId}/outputs/${output.id}/download`;
          item.fileSize = output.file_size || undefined;
          item.mimeType = output.mime_type || undefined;
        }

        return item;
      });

      // Add sources if available
      if (job.sources_json) {
        response.sources = job.sources_json;
      }

      // Add token usage and processing time
      if (job.token_usage_json) {
        response.tokenUsage = job.token_usage_json;
      }
      if (job.processing_time_ms) {
        response.processingTimeMs = job.processing_time_ms;
      }
    }

    // Add error info if job failed
    if (job.status === 'failed') {
      response.error = {
        message: job.error_message || 'Unknown error',
        code: job.error_code || 'PROCESSING_ERROR',
      };
    }

    const nextResponse = NextResponse.json(response);
    return addRateLimitHeaders(nextResponse, rateLimitInfo);
  } catch (error) {
    console.error('[AgentBot] Job status error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal error';
    return agentBotErrors.processingError(errorMessage);
  }
}

// ============================================================================
// OPTIONS Handler (CORS)
// ============================================================================

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

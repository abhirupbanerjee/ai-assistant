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
import { getJobWithOutputs } from '@/lib/db/compat';
import type {
  JobStatusResponse,
  InvokeOutputItem,
  AgentBotError,
} from '@/types/agent-bot';

// ============================================================================
// Route Handler
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; jobId: string }> }
): Promise<NextResponse<JobStatusResponse | AgentBotError>> {
  const { slug, jobId } = await params;

  // 1. Authenticate request
  const authResult = await authenticateRequest(request, slug);
  if (isAuthError(authResult)) {
    return authResult;
  }

  const { agentBot, apiKey, rateLimitInfo } = authResult;

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

    // 4. Verify API key has access to this job
    // Jobs can be accessed by the key that created them OR any key for the same bot
    if (job.api_key_id !== apiKey.id && job.agent_bot_id !== apiKey.agent_bot_id) {
      const response = agentBotErrors.jobNotFound();
      return addRateLimitHeaders(response, rateLimitInfo);
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

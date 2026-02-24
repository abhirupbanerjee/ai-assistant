/**
 * Agent Bot Invoke API
 *
 * POST /api/agent-bots/[slug]/invoke
 *
 * Execute an agent bot with the provided input.
 * Supports both synchronous and asynchronous execution modes.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateRequest,
  isAuthError,
  addRateLimitHeaders,
  agentBotErrors,
  recordUsage,
} from '@/lib/agent-bot/auth';
import {
  validateRequest,
  formatValidationErrors,
  getEffectiveOutputType,
} from '@/lib/agent-bot/validator';
import {
  executeInvocation,
  resolveVersion,
  createAsyncJob,
} from '@/lib/agent-bot/executor';
import {
  notifyJobCompleted,
  notifyJobFailed,
  formatOutputsForWebhook,
} from '@/lib/agent-bot/webhook';
import { getJobWithOutputs } from '@/lib/db/agent-bot-jobs';
import type { InvokeRequest, InvokeResponse, AsyncJobResponse, AgentBotError } from '@/types/agent-bot';

// ============================================================================
// Route Handler
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<InvokeResponse | AsyncJobResponse | AgentBotError>> {
  const { slug } = await params;

  // 1. Authenticate request
  const authResult = authenticateRequest(request, slug);
  if (isAuthError(authResult)) {
    return authResult;
  }

  const { agentBot, apiKey, rateLimitInfo } = authResult;

  try {
    // 2. Parse request body
    let body: InvokeRequest;
    try {
      body = await request.json();
    } catch {
      return agentBotErrors.inputValidationError('Invalid JSON in request body');
    }

    // 3. Resolve version
    const version = resolveVersion(agentBot.id, body.version);
    if (!version) {
      return agentBotErrors.versionNotFound();
    }

    if (!version.is_active) {
      return agentBotErrors.versionNotFound();
    }

    // 4. Validate input against schema
    const validationResult = validateRequest(
      {
        input: body.input || {},
        outputType: body.outputType,
      },
      {
        inputSchema: version.input_schema,
        outputConfig: version.output_config,
      }
    );

    if (!validationResult.valid) {
      const response = agentBotErrors.inputValidationError(
        formatValidationErrors(validationResult.errors)
      );
      return addRateLimitHeaders(response, rateLimitInfo);
    }

    // 5. Determine execution mode
    const isAsync = body.async === true;

    if (isAsync) {
      // ================== ASYNC EXECUTION ==================
      // Create job and return immediately
      const job = createAsyncJob(agentBot, apiKey, body, version);

      // Record usage (will be updated with actual tokens later)
      recordUsage(authResult, 0, false);

      // Process in background (fire and forget)
      processAsyncJob(
        job.id,
        agentBot,
        apiKey,
        body,
        request.url
      ).catch((error) => {
        console.error('[AgentBot] Async job processing failed:', error);
      });

      const response: AsyncJobResponse = {
        jobId: job.id,
        status: job.status,
      };

      const nextResponse = NextResponse.json(response, { status: 202 });
      return addRateLimitHeaders(nextResponse, rateLimitInfo);
    }

    // ================== SYNC EXECUTION ==================
    const result = await executeInvocation(agentBot, apiKey, body);

    // Record usage
    recordUsage(authResult, result.tokenUsage?.totalTokens || 0, !result.success);

    if (!result.success) {
      const response = agentBotErrors.processingError(result.error?.message);
      return addRateLimitHeaders(response, rateLimitInfo);
    }

    // Build response
    const response: InvokeResponse = {
      success: true,
      jobId: result.job.id,
      outputs: result.outputs,
      tokenUsage: result.tokenUsage,
      processingTimeMs: result.processingTimeMs,
    };

    const nextResponse = NextResponse.json(response);
    return addRateLimitHeaders(nextResponse, rateLimitInfo);
  } catch (error) {
    console.error('[AgentBot] Invoke error:', error);

    // Record error
    recordUsage(authResult, 0, true);

    const errorMessage = error instanceof Error ? error.message : 'Internal error';
    return agentBotErrors.processingError(errorMessage);
  }
}

// ============================================================================
// Async Job Processing
// ============================================================================

/**
 * Process an async job in the background
 */
async function processAsyncJob(
  jobId: string,
  agentBot: { id: string; slug: string },
  apiKey: { id: string; agent_bot_id: string },
  request: InvokeRequest,
  requestUrl: string
): Promise<void> {
  try {
    // Get the full API key and bot objects
    const { getAgentBotById } = await import('@/lib/db/agent-bots');
    const { getApiKeyById } = await import('@/lib/db/agent-bot-api-keys');

    const fullApiKey = getApiKeyById(apiKey.id);
    const fullAgentBot = getAgentBotById(agentBot.id);

    if (!fullApiKey || !fullAgentBot) {
      throw new Error('Failed to load agent bot or API key');
    }

    // Execute the invocation
    const result = await executeInvocation(fullAgentBot, fullApiKey, request);

    // Get base URL for webhook
    const url = new URL(requestUrl);
    const baseUrl = `${url.protocol}//${url.host}`;

    // Send webhook notification if configured
    if (request.webhookUrl && request.webhookSecret) {
      const job = getJobWithOutputs(jobId);

      if (result.success && job) {
        // Format outputs for webhook
        const webhookOutputs = formatOutputsForWebhook(
          job.outputs,
          baseUrl,
          jobId
        );

        await notifyJobCompleted(
          request.webhookUrl,
          request.webhookSecret,
          job,
          fullAgentBot.slug,
          webhookOutputs,
          result.tokenUsage,
          result.processingTimeMs
        );
      } else if (!result.success && job) {
        await notifyJobFailed(
          request.webhookUrl,
          request.webhookSecret,
          job,
          fullAgentBot.slug,
          result.error?.message || 'Processing failed',
          result.error?.code || 'PROCESSING_ERROR'
        );
      }
    }
  } catch (error) {
    console.error('[AgentBot] Async job failed:', error);

    // Try to send failure webhook
    if (request.webhookUrl && request.webhookSecret) {
      try {
        const job = getJobWithOutputs(jobId);
        if (job) {
          await notifyJobFailed(
            request.webhookUrl,
            request.webhookSecret,
            job,
            agentBot.slug,
            error instanceof Error ? error.message : 'Unknown error',
            'PROCESSING_ERROR'
          );
        }
      } catch (webhookError) {
        console.error('[AgentBot] Failed to send failure webhook:', webhookError);
      }
    }
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

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
import { getJobWithOutputs, getActiveAgentBotBySlug } from '@/lib/db/compat';
import { getCurrentUser } from '@/lib/auth';
import type { InvokeRequest, InvokeResponse, AsyncJobResponse, AgentBotError, RateLimitInfo } from '@/types/agent-bot';

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<InvokeResponse | AsyncJobResponse | AgentBotError>> {
  const { slug } = await params;

  // Check for admin test mode
  const adminTestMode = await isAdminTest(request);

  let agentBot;
  let apiKey;
  let rateLimitInfo: RateLimitInfo;

  if (adminTestMode) {
    // Admin test mode - bypass API key authentication
    const bot = await getActiveAgentBotBySlug(slug);
    if (!bot) {
      return agentBotErrors.agentBotNotFound();
    }
    agentBot = bot;
    // Create mock API key for admin testing
    apiKey = {
      id: 'admin-test',
      agent_bot_id: bot.id,
      name: 'Admin Test',
      key_prefix: 'admin',
      key_hash: '',
      permissions: ['invoke'] as string[],
      rate_limit_rpm: 9999,
      rate_limit_rpd: 99999,
      expires_at: null,
      last_used_at: null,
      is_active: true,
      created_by: 'admin',
      created_at: new Date().toISOString(),
      revoked_at: null,
    };
    rateLimitInfo = createMockRateLimitInfo();
  } else {
    // 1. Authenticate request
    const authResult = await authenticateRequest(request, slug);
    if (isAuthError(authResult)) {
      return authResult;
    }
    agentBot = authResult.agentBot;
    apiKey = authResult.apiKey;
    rateLimitInfo = authResult.rateLimitInfo;
  }

  // Create authResult-like object for recordUsage
  const authContext = { agentBot, apiKey, rateLimitInfo };

  try {
    // 2. Parse request body
    let body: InvokeRequest;
    try {
      body = await request.json();
    } catch {
      return agentBotErrors.inputValidationError('Invalid JSON in request body');
    }

    // 3. Resolve version
    const version = await resolveVersion(agentBot.id, body.version);
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
      const job = await createAsyncJob(agentBot, apiKey, body, version);

      // Record usage (will be updated with actual tokens later)
      await recordUsage(authContext, 0, false);

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
    await recordUsage(authContext, result.tokenUsage?.totalTokens || 0, !result.success);

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
    await recordUsage(authContext, 0, true);

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
    const { getAgentBotById, getApiKeyById } = await import('@/lib/db/compat');

    const fullApiKey = await getApiKeyById(apiKey.id);
    const fullAgentBot = await getAgentBotById(agentBot.id);

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
      const job = await getJobWithOutputs(jobId);

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
        const job = await getJobWithOutputs(jobId);
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

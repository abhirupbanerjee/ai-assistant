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
  type FileValidationInput,
} from '@/lib/agent-bot/validator';
import { getUploadedFile } from '@/lib/agent-bot/uploaded-files';
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
import { getJobWithOutputs, getActiveAgentBotBySlug, listApiKeys, createApiKey } from '@/lib/db/compat';
import { getCurrentUser } from '@/lib/auth';
import { runWithContextAsync } from '@/lib/request-context';
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

    // Find or create a real admin-test API key for this bot
    const keys = await listApiKeys(bot.id);
    let testKey = keys.find((k) => k.name === 'Admin Test' && k.created_by === 'system');
    if (!testKey) {
      const result = await createApiKey(bot.id, { name: 'Admin Test' }, 'system');
      testKey = result.apiKey;
    }
    apiKey = testKey;
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
    // Build file validation inputs from uploaded file IDs
    let fileValidationInputs: FileValidationInput[] | undefined;
    if (body.files && body.files.length > 0) {
      fileValidationInputs = [];
      for (const fileId of body.files) {
        const fileInfo = getUploadedFile(fileId);
        if (!fileInfo) {
          const response = agentBotErrors.inputValidationError(
            `Uploaded file '${fileId}' not found or expired`
          );
          return addRateLimitHeaders(response, rateLimitInfo);
        }
        fileValidationInputs.push({
          filename: fileInfo.originalFilename,
          size: fileInfo.fileSize,
          mimeType: fileInfo.mimeType,
        });
      }
    }

    const validationResult = validateRequest(
      {
        input: body.input || {},
        files: fileValidationInputs,
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
      if (!adminTestMode) {
        await recordUsage(authContext, 0, false);
      }

      // Process in background (fire and forget)
      processAsyncJob(
        job.id,
        agentBot,
        apiKey,
        body,
        request.url,
        version.category_ids
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
    const result = await runWithContextAsync(
      { categoryIds: version.category_ids },
      () => executeInvocation(agentBot, apiKey, body)
    );

    // Record usage
    if (!adminTestMode) {
      await recordUsage(authContext, result.tokenUsage?.totalTokens || 0, !result.success);
    }

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

    if (result.sources) {
      response.sources = result.sources;
    }

    const nextResponse = NextResponse.json(response);
    return addRateLimitHeaders(nextResponse, rateLimitInfo);
  } catch (error) {
    console.error('[AgentBot] Invoke error:', error);

    // Record error
    if (!adminTestMode) {
      await recordUsage(authContext, 0, true);
    }

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
  requestUrl: string,
  categoryIds: number[]
): Promise<void> {
  try {
    // Get the full API key and bot objects, plus the existing job
    const { getAgentBotById, getApiKeyById, getJobWithOutputs } = await import('@/lib/db/compat');

    const fullApiKey = await getApiKeyById(apiKey.id);
    const fullAgentBot = await getAgentBotById(agentBot.id);
    const existingJob = await getJobWithOutputs(jobId);

    if (!fullApiKey || !fullAgentBot) {
      throw new Error('Failed to load agent bot or API key');
    }

    if (!existingJob) {
      throw new Error('Async job not found');
    }

    // Execute the invocation with request context for tool access,
    // passing the existing job so it is updated instead of creating a new one
    const result = await runWithContextAsync(
      { categoryIds },
      () => executeInvocation(fullAgentBot, fullApiKey, request, existingJob)
    );

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

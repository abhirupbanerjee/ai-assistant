/**
 * Agent Bot Output Download API
 *
 * GET /api/agent-bots/[slug]/jobs/[jobId]/outputs/[outputId]/download
 *
 * Download a generated output file from a job.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import {
  authenticateRequest,
  isAuthError,
  agentBotErrors,
  extractApiKey,
} from '@/lib/agent-bot/auth';
import { getJobById, getOutputById, getActiveAgentBotBySlug, listApiKeys, createApiKey } from '@/lib/db/compat';
import { getCurrentUser } from '@/lib/auth';
import type { AgentBotError } from '@/types/agent-bot';

// ============================================================================
// Route Handler
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; jobId: string; outputId: string }> }
): Promise<NextResponse<Blob | AgentBotError>> {
  const { slug, jobId, outputId } = await params;

  let agentBot;
  let apiKey;
  let isAdminAccess = false;

  // 1. Authenticate request
  const apiKeyString = extractApiKey(request);
  if (!apiKeyString) {
    // No API key provided — try admin session fallback (browser download links)
    const user = await getCurrentUser();
    if (user?.role === 'super_admin' || user?.role === 'admin' || user?.role === 'superuser') {
      const bot = await getActiveAgentBotBySlug(slug);
      if (bot) {
        agentBot = bot;
        isAdminAccess = true;
        // Find or create admin test API key for this bot
        const keys = await listApiKeys(bot.id);
        let testKey = keys.find((k) => k.name === 'Admin Test' && k.created_by === 'system');
        if (!testKey) {
          const result = await createApiKey(bot.id, { name: 'Admin Test' }, 'system');
          testKey = result.apiKey;
        }
        apiKey = testKey;
      } else {
        return agentBotErrors.agentBotNotFound();
      }
    }
  }

  if (!agentBot) {
    // API key provided — use standard API key authentication
    const authResult = await authenticateRequest(request, slug);
    if (isAuthError(authResult)) {
      return authResult;
    }
    agentBot = authResult.agentBot;
    apiKey = authResult.apiKey;
  }

  try {
    // 2. Get job
    const job = await getJobById(jobId);
    if (!job) {
      return agentBotErrors.jobNotFound();
    }

    // 3. Verify job belongs to this agent bot
    if (job.agent_bot_id !== agentBot.id) {
      return agentBotErrors.jobNotFound();
    }

    // 4. Verify API key has access (same bot or same key)
    // Skip this check for admin session access
    if (!isAdminAccess && apiKey && job.api_key_id !== apiKey.id && job.agent_bot_id !== apiKey.agent_bot_id) {
      return agentBotErrors.jobNotFound();
    }

    // 5. Get output
    const output = await getOutputById(outputId);
    if (!output || output.job_id !== jobId) {
      return NextResponse.json(
        { error: 'Output not found', code: 'JOB_NOT_FOUND' as const },
        { status: 404 }
      );
    }

    // 6. For text/json outputs, return content directly
    if (!output.filepath && output.content) {
      const mimeType = output.mime_type || 'text/plain';
      return new NextResponse(output.content, {
        headers: {
          'Content-Type': mimeType,
          'Content-Disposition': output.filename
            ? `attachment; filename="${output.filename}"`
            : 'inline',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // 7. For file outputs, stream the file
    if (output.filepath) {
      if (!fs.existsSync(output.filepath)) {
        return NextResponse.json(
          { error: 'Output file not found', code: 'JOB_NOT_FOUND' as const },
          { status: 404 }
        );
      }

      const fileBuffer = fs.readFileSync(output.filepath);
      const mimeType = output.mime_type || 'application/octet-stream';
      const filename = output.filename || `output.${output.output_type}`;

      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileBuffer.length.toString(),
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'private, max-age=3600',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // 8. No content available
    return NextResponse.json(
      { error: 'Output has no content', code: 'JOB_NOT_FOUND' as const },
      { status: 404 }
    );
  } catch (error) {
    console.error('[AgentBot] Download error:', error);
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

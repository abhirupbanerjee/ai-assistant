/**
 * Agent Bot Discovery / Spec API
 *
 * GET /api/agent-bots/spec
 *
 * Returns simplified metadata JSON for the agent bot associated with
 * the provided API key. The API key itself identifies the bot — no
 * slug or prior knowledge of the bot is required.
 *
 * Authentication: Bearer API key
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateRequestByKey,
  isAuthError,
  addRateLimitHeaders,
  agentBotErrors,
} from '@/lib/agent-bot/auth';
import { getDefaultVersion } from '@/lib/db/compat';
import { normalizeBaseUrl } from '@/lib/url-utils';

// ============================================================================
// Types
// ============================================================================

interface AgentBotSpecResponse {
  name: string;
  slug: string;
  description: string | null;
  baseUrl: string;
  version: {
    number: number;
    label: string | null;
  };
  inputSchema: {
    parameters: Array<{
      name: string;
      type: string;
      description: string;
      required: boolean;
      default?: unknown;
    }>;
  };
  uploadConfig: {
    enabled: boolean;
    maxFiles: number;
    maxSizePerFileMB: number;
    allowedTypes: string[];
    required: boolean;
  };
  outputConfig: {
    enabledTypes: string[];
    defaultType: string;
    supportsFallback: boolean;
  };
  endpoints: Array<{
    path: string;
    method: string;
    purpose: string;
  }>;
  features: {
    async: boolean;
    sync: boolean;
    webhooks: boolean;
    includeSources: boolean;
  };
}

// ============================================================================
// Route Handler
// ============================================================================

export async function GET(
  request: NextRequest
): Promise<NextResponse<AgentBotSpecResponse | { error: string; code: string }>> {
  // 1. Authenticate by API key only (no slug required)
  const authResult = await authenticateRequestByKey(request);
  if (isAuthError(authResult)) {
    return authResult;
  }

  const { agentBot, apiKey, rateLimitInfo } = authResult;

  try {
    // 2. Get default version
    const version = await getDefaultVersion(agentBot.id);
    if (!version) {
      const response = agentBotErrors.versionNotFound();
      return addRateLimitHeaders(response, rateLimitInfo);
    }

    // 3. Build base URL
    const baseUrl = normalizeBaseUrl(
      process.env.NEXTAUTH_URL || 'http://localhost:3000'
    );
    const botBaseUrl = `${baseUrl}/api/agent-bots/${agentBot.slug}`;

    // 4. Build sanitized metadata response
    const specResponse: AgentBotSpecResponse = {
      name: agentBot.name,
      slug: agentBot.slug,
      description: agentBot.description,
      baseUrl: botBaseUrl,
      version: {
        number: version.version_number,
        label: version.version_label,
      },
      inputSchema: {
        parameters:
          version.input_schema?.parameters?.map((param) => ({
            name: param.name,
            type: param.type,
            description: param.description,
            required: param.required,
            ...(param.default !== undefined ? { default: param.default } : {}),
          })) || [],
      },
      uploadConfig: {
        enabled: version.input_schema?.files?.enabled ?? false,
        maxFiles: version.input_schema?.files?.maxFiles ?? 0,
        maxSizePerFileMB: version.input_schema?.files?.maxSizePerFileMB ?? 10,
        allowedTypes: version.input_schema?.files?.allowedTypes ?? [],
        required: version.input_schema?.files?.required ?? false,
      },
      outputConfig: {
        enabledTypes: version.output_config?.enabledTypes || ['text', 'json'],
        defaultType: version.output_config?.defaultType || 'json',
        supportsFallback: true,
      },
      endpoints: [
        {
          path: `${botBaseUrl}/invoke`,
          method: 'POST',
          purpose: 'Execute the agent bot (sync or async)',
        },
        {
          path: `${botBaseUrl}/upload`,
          method: 'POST',
          purpose: 'Upload files to include as context',
        },
        {
          path: `${botBaseUrl}/jobs/{jobId}`,
          method: 'GET',
          purpose: 'Check async job status and results',
        },
        {
          path: `${botBaseUrl}/jobs/{jobId}/outputs/{outputId}/download`,
          method: 'GET',
          purpose: 'Download generated file outputs',
        },
        {
          path: `${baseUrl}/api/agent-bots/spec`,
          method: 'GET',
          purpose: 'Discovery — returns this metadata',
        },
      ],
      features: {
        async: true,
        sync: true,
        webhooks: true,
        includeSources: version.include_sources ?? false,
      },
    };

    // 5. Return with cache-busting headers and rate limit info
    const response = NextResponse.json(specResponse, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });

    return addRateLimitHeaders(response, rateLimitInfo);
  } catch (error) {
    console.error('[AgentBot] Spec discovery error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal error';
    const response = agentBotErrors.processingError(errorMessage);
    return addRateLimitHeaders(response, rateLimitInfo);
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

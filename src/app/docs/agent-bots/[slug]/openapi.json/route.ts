/**
 * OpenAPI Spec Download Route
 *
 * GET /docs/agent-bots/[slug]/openapi.json
 * Returns the OpenAPI 3.0 specification for the agent bot.
 *
 * Protected: Admin or Superuser with category access
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments, getAgentBotBySlug, checkSuperuserAgentBotAccess, getDefaultVersion } from '@/lib/db/compat';
import { normalizeBaseUrl } from '@/lib/url-utils';
import type { AgentBotVersionWithRelations } from '@/types/agent-bot';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { slug } = await params;

  // Check authentication
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check user role
  const role = await getUserRole(user.email);
  if (role !== 'admin' && role !== 'superuser') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // Get the agent bot
  const agentBot = await getAgentBotBySlug(slug);
  if (!agentBot) {
    return NextResponse.json({ error: 'Agent bot not found' }, { status: 404 });
  }

  // For superusers, check category-based access
  if (role === 'superuser') {
    const userId = await getUserId(user.email);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const superUserData = await getSuperUserWithAssignments(userId);
    const userCategoryIds = (superUserData?.assignedCategories || []).map(
      (c) => c.categoryId
    );

    const hasAccess = await checkSuperuserAgentBotAccess(agentBot.id, userCategoryIds);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
  }

  // Get the default version
  const defaultVersion = await getDefaultVersion(agentBot.id);
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';

  // Generate OpenAPI spec
  const openApiSpec = generateOpenApiSpec(agentBot, defaultVersion, baseUrl);

  return new NextResponse(JSON.stringify(openApiSpec, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${slug}-openapi.json"`,
    },
  });
}

function generateOpenApiSpec(
  agentBot: { name: string; slug: string; description: string | null },
  version: AgentBotVersionWithRelations | null,
  baseUrl: string
) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const inputProperties: Record<string, unknown> = {};
  const requiredParams: string[] = [];

  version?.input_schema?.parameters?.forEach((param) => {
    inputProperties[param.name] = {
      type: param.type,
      description: param.description,
    };
    if (param.required) {
      requiredParams.push(param.name);
    }
  });

  return {
    openapi: '3.0.3',
    info: {
      title: `${agentBot.name} API`,
      description: agentBot.description || `API for ${agentBot.name}`,
      version: version ? String(version.version_number) : '1',
    },
    servers: [
      {
        url: `${normalizedBaseUrl}/api/agent-bots/${agentBot.slug}`,
      },
    ],
    security: [
      {
        bearerAuth: [],
      },
    ],
    paths: {
      '/invoke': {
        post: {
          summary: 'Execute agent bot',
          description: 'Execute the agent bot with the provided input parameters.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/InvokeRequest',
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Synchronous execution result',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/InvokeResponse',
                  },
                },
              },
            },
            '202': {
              description: 'Async job created',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/AsyncResponse',
                  },
                },
              },
            },
            '400': {
              description: 'Bad request',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/ErrorResponse',
                  },
                },
              },
            },
            '401': {
              description: 'Unauthorized',
            },
            '429': {
              description: 'Rate limit exceeded',
            },
          },
        },
      },
      '/jobs/{jobId}': {
        get: {
          summary: 'Get job status',
          description: 'Get the status and results of a job.',
          parameters: [
            {
              name: 'jobId',
              in: 'path',
              required: true,
              schema: {
                type: 'string',
              },
            },
          ],
          responses: {
            '200': {
              description: 'Job status and results',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/JobStatusResponse',
                  },
                },
              },
            },
            '404': {
              description: 'Job not found',
            },
          },
        },
      },
      '/jobs/{jobId}/cancel': {
        post: {
          summary: 'Cancel job',
          description: 'Cancel a pending job.',
          parameters: [
            {
              name: 'jobId',
              in: 'path',
              required: true,
              schema: {
                type: 'string',
              },
            },
          ],
          responses: {
            '200': {
              description: 'Job cancelled',
            },
            '400': {
              description: 'Job cannot be cancelled',
            },
            '404': {
              description: 'Job not found',
            },
          },
        },
      },
      '/upload': {
        post: {
          summary: 'Upload file',
          description: 'Upload a file to be used in a job.',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: {
                      type: 'string',
                      format: 'binary',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'File uploaded',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/UploadResponse',
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
        },
      },
      schemas: {
        InvokeRequest: {
          type: 'object',
          required: ['input'],
          properties: {
            input: {
              type: 'object',
              description: 'Input parameters for the agent bot',
              properties: inputProperties,
              required: requiredParams.length > 0 ? requiredParams : undefined,
            },
            version: {
              oneOf: [
                { type: 'integer' },
                { type: 'string', enum: ['latest', 'default'] },
              ],
              description: 'Version to use (number, "latest", or "default")',
              example: 'latest',
            },
            outputType: {
              type: 'string',
              enum: version?.output_config?.enabledTypes || ['text', 'json'],
              description: 'Desired output format',
              example: version?.output_config?.defaultType || 'json',
            },
            fallbackType: {
              type: 'string',
              enum: ['text', 'json', 'md'],
              description: 'Fallback output type if primary fails',
              example: 'text',
            },
            async: {
              type: 'boolean',
              description: 'Use async mode (returns immediately with job ID)',
              example: false,
            },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of uploaded file IDs to include as context',
              example: ['file_abc123'],
            },
            webhookUrl: {
              type: 'string',
              format: 'uri',
              description: 'Webhook URL for async result delivery',
              example: 'https://your-server.com/webhook',
            },
            webhookSecret: {
              type: 'string',
              description: 'Secret for webhook signature verification',
              example: 'whsec_1234567890abcdef',
            },
          },
        },
        InvokeResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            jobId: { type: 'string', example: 'job_abc123' },
            outputs: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/OutputItem',
              },
            },
            sources: {
              type: 'array',
              description: 'RAG source citations (only when version.include_sources is true)',
              items: {
                type: 'object',
                properties: {
                  documentName: { type: 'string', example: 'Document.pdf' },
                  pageNumber: { type: 'integer', example: 5 },
                  chunkText: { type: 'string', example: 'Relevant text excerpt...' },
                  score: { type: 'number', example: 0.92 },
                },
              },
            },
            tokenUsage: {
              $ref: '#/components/schemas/TokenUsage',
            },
            processingTimeMs: { type: 'integer', example: 2340 },
            usedFallback: { type: 'boolean', example: false },
          },
        },
        AsyncResponse: {
          type: 'object',
          properties: {
            jobId: { type: 'string', example: 'job_abc123' },
            status: { type: 'string', enum: ['pending'], example: 'pending' },
          },
        },
        JobStatusResponse: {
          type: 'object',
          properties: {
            jobId: { type: 'string', example: 'job_abc123' },
            status: {
              type: 'string',
              enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
              example: 'completed',
            },
            outputs: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/OutputItem',
              },
            },
            sources: {
              type: 'array',
              description: 'RAG source citations (only when version.include_sources is true)',
              items: {
                type: 'object',
                properties: {
                  documentName: { type: 'string', example: 'Document.pdf' },
                  pageNumber: { type: 'integer', example: 5 },
                  chunkText: { type: 'string', example: 'Relevant text excerpt...' },
                  score: { type: 'number', example: 0.92 },
                },
              },
            },
            tokenUsage: {
              $ref: '#/components/schemas/TokenUsage',
            },
            processingTimeMs: { type: 'integer', example: 2340 },
            error: {
              type: 'object',
              properties: {
                message: { type: 'string', example: 'Model request failed' },
                code: { type: 'string', example: 'PROCESSING_ERROR' },
              },
            },
          },
        },
        OutputItem: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            content: {},
            filename: { type: 'string' },
            downloadUrl: { type: 'string' },
            fileSize: { type: 'integer' },
            mimeType: { type: 'string' },
          },
        },
        TokenUsage: {
          type: 'object',
          properties: {
            promptTokens: { type: 'integer', example: 500 },
            completionTokens: { type: 'integer', example: 200 },
            totalTokens: { type: 'integer', example: 700 },
          },
        },
        UploadResponse: {
          type: 'object',
          properties: {
            fileId: { type: 'string' },
            filename: { type: 'string' },
            fileSize: { type: 'integer' },
            mimeType: { type: 'string' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
            details: { type: 'string' },
          },
        },
      },
    },
  };
}

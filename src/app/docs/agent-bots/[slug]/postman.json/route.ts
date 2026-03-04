/**
 * Postman Collection Download Route
 *
 * GET /docs/agent-bots/[slug]/postman.json
 * Returns a Postman Collection v2.1 for the agent bot.
 *
 * Protected: Admin or Superuser with category access
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments, getAgentBotBySlug, checkSuperuserAgentBotAccess, getDefaultVersion } from '@/lib/db/compat';
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

  // Generate Postman collection
  const collection = generatePostmanCollection(agentBot, defaultVersion, baseUrl);

  return new NextResponse(JSON.stringify(collection, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${slug}-postman-collection.json"`,
    },
  });
}

function generatePostmanCollection(
  agentBot: { name: string; slug: string; description: string | null },
  version: AgentBotVersionWithRelations | null,
  baseUrl: string
) {
  const apiUrl = `${baseUrl}/api/agent-bots/${agentBot.slug}`;

  // Build input example
  const inputExample = version?.input_schema?.parameters?.reduce(
    (acc, param) => {
      if (param.type === 'string') acc[param.name] = `example ${param.name}`;
      else if (param.type === 'number') acc[param.name] = 0;
      else if (param.type === 'boolean') acc[param.name] = false;
      return acc;
    },
    {} as Record<string, unknown>
  ) || { query: 'Your query here' };

  return {
    info: {
      name: `${agentBot.name} API`,
      description: agentBot.description || `API collection for ${agentBot.name}`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: {
      type: 'bearer',
      bearer: [
        {
          key: 'token',
          value: '{{api_key}}',
          type: 'string',
        },
      ],
    },
    variable: [
      {
        key: 'base_url',
        value: apiUrl,
        type: 'string',
      },
      {
        key: 'api_key',
        value: 'YOUR_API_KEY',
        type: 'string',
      },
    ],
    item: [
      {
        name: 'Invoke (Sync)',
        request: {
          method: 'POST',
          header: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
          ],
          body: {
            mode: 'raw',
            raw: JSON.stringify(
              {
                input: inputExample,
                outputType: version?.output_config?.defaultType || 'json',
              },
              null,
              2
            ),
          },
          url: {
            raw: '{{base_url}}/invoke',
            host: ['{{base_url}}'],
            path: ['invoke'],
          },
          description: 'Execute the agent bot synchronously and receive the result immediately.',
        },
      },
      {
        name: 'Invoke (Async)',
        request: {
          method: 'POST',
          header: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
          ],
          body: {
            mode: 'raw',
            raw: JSON.stringify(
              {
                input: inputExample,
                outputType: version?.output_config?.defaultType || 'json',
                async: true,
                webhookUrl: 'https://your-server.com/webhook',
                webhookSecret: 'your_secret',
              },
              null,
              2
            ),
          },
          url: {
            raw: '{{base_url}}/invoke',
            host: ['{{base_url}}'],
            path: ['invoke'],
          },
          description: 'Execute the agent bot asynchronously. Results will be delivered via webhook.',
        },
      },
      {
        name: 'Get Job Status',
        request: {
          method: 'GET',
          url: {
            raw: '{{base_url}}/jobs/:jobId',
            host: ['{{base_url}}'],
            path: ['jobs', ':jobId'],
            variable: [
              {
                key: 'jobId',
                value: 'job_abc123',
                description: 'The job ID returned from invoke',
              },
            ],
          },
          description: 'Get the status and results of a job.',
        },
      },
      {
        name: 'Cancel Job',
        request: {
          method: 'POST',
          url: {
            raw: '{{base_url}}/jobs/:jobId/cancel',
            host: ['{{base_url}}'],
            path: ['jobs', ':jobId', 'cancel'],
            variable: [
              {
                key: 'jobId',
                value: 'job_abc123',
                description: 'The job ID to cancel',
              },
            ],
          },
          description: 'Cancel a pending job.',
        },
      },
      {
        name: 'Upload File',
        request: {
          method: 'POST',
          header: [],
          body: {
            mode: 'formdata',
            formdata: [
              {
                key: 'file',
                type: 'file',
                src: [],
                description: 'The file to upload',
              },
            ],
          },
          url: {
            raw: '{{base_url}}/upload',
            host: ['{{base_url}}'],
            path: ['upload'],
          },
          description: 'Upload a file to be used in a job. Returns a file ID.',
        },
      },
      {
        name: 'Invoke with File',
        request: {
          method: 'POST',
          header: [
            {
              key: 'Content-Type',
              value: 'application/json',
            },
          ],
          body: {
            mode: 'raw',
            raw: JSON.stringify(
              {
                input: inputExample,
                files: ['file_id_from_upload'],
                outputType: version?.output_config?.defaultType || 'json',
              },
              null,
              2
            ),
          },
          url: {
            raw: '{{base_url}}/invoke',
            host: ['{{base_url}}'],
            path: ['invoke'],
          },
          description: 'Execute the agent bot with uploaded files.',
        },
      },
    ],
  };
}

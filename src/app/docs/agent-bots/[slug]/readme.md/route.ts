/**
 * Markdown README Download Route
 *
 * GET /docs/agent-bots/[slug]/readme.md
 * Returns the README documentation in Markdown format.
 *
 * Protected: Admin or Superuser with category access
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments, getAgentBotBySlug, checkSuperuserAgentBotAccess, getDefaultVersion } from '@/lib/db/compat';
import type { AgentBotVersionWithRelations } from '@/types/agent-bot';
import { ALLOWED_FILE_TYPES, ALL_OUTPUT_TYPES } from '@/lib/constants/agent-bot-config';

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

  // Generate Markdown README
  const markdown = generateMarkdownReadme(agentBot, defaultVersion, baseUrl);

  return new NextResponse(markdown, {
    headers: {
      'Content-Type': 'text/markdown',
      'Content-Disposition': `attachment; filename="${slug}-README.md"`,
    },
  });
}

function generateMarkdownReadme(
  agentBot: { name: string; slug: string; description: string | null },
  version: AgentBotVersionWithRelations | null,
  baseUrl: string
): string {
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

  let md = `# ${agentBot.name} API

`;

  if (agentBot.description) {
    md += `> ${agentBot.description}

`;
  }

  md += `## Quick Start

\`\`\`bash
curl -X POST "${apiUrl}/invoke" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ input: inputExample, outputType: version?.output_config?.defaultType || 'json' })}'
\`\`\`

## Authentication

All requests require an API key in the Authorization header:

\`\`\`
Authorization: Bearer ab_pk_your_api_key
\`\`\`

Contact your administrator to obtain an API key.

## Base URL

\`\`\`
${apiUrl}
\`\`\`

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | \`/invoke\` | Execute the agent bot |
| GET | \`/jobs/{jobId}\` | Get job status and results |
| POST | \`/jobs/{jobId}/cancel\` | Cancel a pending job |
| POST | \`/upload\` | Upload files for job input |

`;

  // Input Schema
  if (version?.input_schema?.parameters?.length) {
    md += `## Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
`;
    version.input_schema.parameters.forEach((param) => {
      md += `| ${param.name} | ${param.type} | ${param.required ? 'Yes' : 'No'} | ${param.description || '-'} |\n`;
    });
    md += '\n';
  }

  // File Uploads
  if (version?.input_schema?.files?.enabled) {
    const files = version.input_schema.files;
    md += `## File Uploads

- **Max files:** ${files.maxFiles || 5}
- **Max size per file:** ${files.maxSizePerFileMB || 10} MB
- **Allowed types:** ${
      files.allowedTypes?.length
        ? files.allowedTypes
            .map((t) => ALLOWED_FILE_TYPES.find((ft) => ft.value === t)?.label || t)
            .join(', ')
        : 'All supported types'
    }
- **Required:** ${files.required ? 'Yes' : 'No'}

`;
  }

  // Output Types
  if (version?.output_config?.enabledTypes?.length) {
    md += `## Output Types

Supported output types: ${version.output_config.enabledTypes
      .map((t) => `\`${t}\``)
      .join(', ')}

Default: \`${version.output_config.defaultType}\`

`;
  }

  // Code Examples
  md += `## Code Examples

### cURL

\`\`\`bash
curl -X POST "${apiUrl}/invoke" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ input: inputExample, outputType: version?.output_config?.defaultType || 'json' }, null, 2)}'
\`\`\`

### Python

\`\`\`python
import requests

response = requests.post(
    "${apiUrl}/invoke",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "input": ${JSON.stringify(inputExample, null, 8).replace(/^/gm, '        ').trim()},
        "outputType": "${version?.output_config?.defaultType || 'json'}"
    }
)

result = response.json()
print(result)
\`\`\`

### JavaScript

\`\`\`javascript
const response = await fetch("${apiUrl}/invoke", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    input: ${JSON.stringify(inputExample, null, 4).replace(/^/gm, '    ').trim()},
    outputType: "${version?.output_config?.defaultType || 'json'}"
  })
});

const result = await response.json();
console.log(result);
\`\`\`

## Response Format

### Success (200 OK)

\`\`\`json
{
  "success": true,
  "jobId": "job_abc123",
  "outputs": [
    {
      "type": "json",
      "content": { ... }
    }
  ],
  "tokenUsage": {
    "promptTokens": 500,
    "completionTokens": 200,
    "totalTokens": 700
  },
  "processingTimeMs": 2340
}
\`\`\`

### Error

\`\`\`json
{
  "error": "Input validation failed",
  "code": "INPUT_VALIDATION_ERROR",
  "details": "query: Required field missing"
}
\`\`\`

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| INVALID_API_KEY | 401 | API key missing or invalid |
| API_KEY_EXPIRED | 401 | API key has expired |
| RATE_LIMIT_EXCEEDED | 429 | Too many requests |
| INPUT_VALIDATION_ERROR | 400 | Input does not match schema |
| FILE_VALIDATION_ERROR | 400 | File type/size not allowed |
| OUTPUT_TYPE_NOT_SUPPORTED | 400 | Requested output type not enabled |
| PROCESSING_ERROR | 500 | Internal processing error |

## Rate Limits

Rate limits are configured per API key. Check response headers:

\`\`\`
X-RateLimit-Limit-Minute: 60
X-RateLimit-Remaining-Minute: 58
X-RateLimit-Limit-Day: 1000
X-RateLimit-Remaining-Day: 847
\`\`\`

---

[Full documentation](${baseUrl}/docs/agent-bots/${agentBot.slug})
`;

  return md;
}

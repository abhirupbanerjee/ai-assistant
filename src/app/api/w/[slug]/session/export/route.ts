import { NextRequest, NextResponse } from 'next/server';
import { validateWorkspaceRequest, extractOrigin } from '@/lib/workspace/validator';
import { getSession, isSessionValid, getSessionMessages, parseSources } from '@/lib/db/compat';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

function formatSessionAsMarkdown(messages: { role: string; content: string; sources_json: string | null; created_at: string }[]): string {
  const exportDate = new Date().toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const lines: string[] = [
    `# Chat Export`,
    `*Exported: ${exportDate}*`,
    '',
  ];

  for (const msg of messages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;

    lines.push('---');
    lines.push('');
    lines.push(msg.role === 'user' ? '**You**' : '**Assistant**');
    lines.push('');
    lines.push(msg.content);

    if (msg.sources_json) {
      const sources = parseSources<{ document_name: string; page_number?: number; score: number }>(msg.sources_json);
      if (sources.length > 0) {
        lines.push('');
        lines.push('*Sources:*');
        for (const src of sources) {
          const page = src.page_number ? `, p.${src.page_number}` : '';
          const score = Math.round(src.score * 100);
          lines.push(`- ${src.document_name}${page} (${score}% relevance)`);
        }
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { slug } = await params;
    const origin = extractOrigin(request.headers);
    const searchParams = request.nextUrl.searchParams;
    const sessionId = request.headers.get('X-Session-Id') || searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const validation = await validateWorkspaceRequest(slug, {
      origin: origin || undefined,
      checkEnabled: true,
    });

    if (!validation.valid || !validation.workspace) {
      return NextResponse.json(
        { error: validation.error || 'Invalid workspace', code: validation.errorCode || 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const workspace = validation.workspace;

    if (!(await isSessionValid(sessionId))) {
      return NextResponse.json(
        { error: 'Session expired', code: 'SESSION_EXPIRED' },
        { status: 401 }
      );
    }

    const session = await getSession(sessionId);
    if (!session || session.workspace_id !== workspace.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'SESSION_INVALID' },
        { status: 401 }
      );
    }

    const messages = await getSessionMessages(sessionId);
    const markdown = formatSessionAsMarkdown(messages);

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `chat-export-${dateStr}.md`;

    return new Response(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Session export error:', error);
    return NextResponse.json(
      { error: 'Failed to export chat', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

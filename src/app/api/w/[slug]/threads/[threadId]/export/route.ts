import { NextRequest, NextResponse } from 'next/server';
import { validateWorkspaceRequest, extractOrigin } from '@/lib/workspace/validator';
import {
  getSession,
  isSessionValid,
  getThreadForSession,
  getWorkspaceThreadWithMessages as getThreadWithMessages,
  parseSources,
} from '@/lib/db/compat';

interface RouteContext {
  params: Promise<{ slug: string; threadId: string }>;
}

function formatMessagesAsMarkdown(title: string, messages: { role: string; content: string; sources_json: string | null }[]): string {
  const exportDate = new Date().toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const lines: string[] = [
    `# ${title}`,
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
    const { slug, threadId } = await params;
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

    if (workspace.type !== 'standalone') {
      return NextResponse.json(
        { error: 'Threads not available for embed workspaces', code: 'NOT_SUPPORTED' },
        { status: 400 }
      );
    }

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

    const thread = await getThreadForSession(threadId, sessionId);
    if (!thread) {
      return NextResponse.json(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const threadWithMessages = await getThreadWithMessages(threadId);
    if (!threadWithMessages) {
      return NextResponse.json(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const markdown = formatMessagesAsMarkdown(threadWithMessages.title, threadWithMessages.messages);

    const safeTitle = threadWithMessages.title
      .replace(/[^a-z0-9\s-]/gi, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 60) || 'thread';

    const filename = `${safeTitle}.md`;

    return new Response(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Workspace thread export error:', error);
    return NextResponse.json(
      { error: 'Failed to export thread', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

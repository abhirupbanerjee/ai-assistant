import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getThread } from '@/lib/threads';
import type { Message, ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ threadId: string }>;
}

function formatThreadAsMarkdown(title: string, messages: Message[]): string {
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
    // Skip tool-role messages (internal plumbing)
    if (msg.role === 'tool') continue;

    lines.push('---');
    lines.push('');

    if (msg.role === 'user') {
      lines.push(`**You**`);
    } else {
      lines.push(`**Assistant**`);
    }
    lines.push('');
    lines.push(msg.content);

    // Append sources if present
    if (msg.sources && msg.sources.length > 0) {
      lines.push('');
      lines.push('*Sources:*');
      for (const src of msg.sources) {
        const page = src.pageNumber ? `, p.${src.pageNumber}` : '';
        const score = Math.round(src.score * 100);
        lines.push(`- ${src.documentName}${page} (${score}% relevance)`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { threadId } = await params;
    const thread = await getThread(user.id, threadId);

    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const markdown = formatThreadAsMarkdown(thread.title, thread.messages);

    // Sanitise title for use as filename
    const safeTitle = thread.title
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
    console.error('Thread export error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to export thread', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

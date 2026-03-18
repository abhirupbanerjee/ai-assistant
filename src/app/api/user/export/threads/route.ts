/**
 * POST /api/user/export/threads
 * Export all of the current user's chat history as a ZIP of Markdown files.
 * Works for any authenticated role (user, superuser, admin).
 */

import { NextResponse } from 'next/server';
import archiver from 'archiver';
import { getCurrentUser } from '@/lib/auth';
import { getUserId } from '@/lib/users';
import { getDb } from '@/lib/db/kysely';
import { getMessagesForThread } from '@/lib/db/compat';
import type { ApiError } from '@/types';

function formatThreadAsMarkdown(
  title: string,
  messages: { role: string; content: string; sources: { documentName: string; pageNumber: number; score: number }[] | null }[]
): string {
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
    if (msg.role === 'tool') continue;

    lines.push('---');
    lines.push('');
    lines.push(msg.role === 'user' ? '**You**' : '**Assistant**');
    lines.push('');
    lines.push(msg.content);

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

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const userId = await getUserId(user.email);
    if (!userId) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const db = await getDb();

    const threads = await db
      .selectFrom('threads')
      .select(['id', 'title', 'created_at'])
      .where('user_id', '=', userId)
      .orderBy('updated_at', 'desc')
      .execute();

    // Build ZIP in memory
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));

    const archiveFinished = new Promise<void>((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });

    for (const thread of threads) {
      const messages = await getMessagesForThread(thread.id);
      const markdown = formatThreadAsMarkdown(
        (thread.title as string) || 'Untitled',
        messages
      );

      const safeTitle = ((thread.title as string) || 'untitled')
        .replace(/[^a-z0-9\s-]/gi, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase()
        .slice(0, 60) || 'thread';

      archive.append(markdown, { name: `${safeTitle}-${thread.id.slice(0, 8)}.md` });
    }

    archive.finalize();
    await archiveFinished;

    const buffer = Buffer.concat(chunks);
    const date = new Date().toISOString().split('T')[0];

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="chat-history-${date}.zip"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Chat history export error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to export chat history',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

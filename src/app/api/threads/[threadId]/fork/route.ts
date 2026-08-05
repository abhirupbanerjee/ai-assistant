import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getThread, createThread } from '@/lib/threads';
import {
  getMessagesForThread,
  getThreadCategories,
  getThreadById,
  addMessage,
} from '@/lib/db/compat';
import { countTokens, updateThreadTokenCount } from '@/lib/summarization';
import type { Thread, ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ threadId: string }>;
}

/**
 * POST /api/threads/[threadId]/fork
 *
 * Fork a conversation into a new thread containing every message up to and
 * including the given message. The original thread is left untouched.
 *
 * Body: { messageId: string }
 * Returns 201: { thread: Thread, copiedMessages: number }
 *
 * Notes:
 * - Messages are copied with FRESH ids (the messages table has a global PK),
 *   so generated artifacts in thread_outputs stay linked to the ORIGINAL
 *   message ids and are not re-pointed at the fork.
 * - Thread uploads (files on disk) are NOT copied — the forked thread starts
 *   with its own empty uploads dir. Attachment filenames remain on the copied
 *   messages for display but the files are not re-linked.
 * - Category assignments and the thread's model override carry over.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { threadId } = await params;

    let messageId: string | undefined;
    try {
      const body = await request.json();
      messageId = body.messageId;
    } catch {
      // Body required — handled below
    }

    if (!messageId || typeof messageId !== 'string') {
      return NextResponse.json<ApiError>(
        { error: 'Missing required field: messageId', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Verify thread ownership (getThread returns null for foreign threads)
    const thread = await getThread(user.id, threadId);
    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Resolve the fork point: copy everything up to and including the anchor
    const allMessages = await getMessagesForThread(threadId);
    const forkIndex = allMessages.findIndex(m => m.id === messageId);
    if (forkIndex === -1) {
      return NextResponse.json<ApiError>(
        { error: 'Message not found in thread', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }
    const messagesToCopy = allMessages.slice(0, forkIndex + 1);

    // Carry over category scoping and the per-thread model override
    const categoryIds = await getThreadCategories(threadId);
    const dbThread = await getThreadById(threadId);

    const newThread = await createThread(
      user.id,
      `${thread.title} (fork)`,
      categoryIds,
      dbThread?.selected_model ?? null
    );

    // Copy messages preserving order and all payload columns
    let tokenTotal = 0;
    for (const msg of messagesToCopy) {
      await addMessage(newThread.id, msg.role, msg.content, {
        sources: msg.sources ?? undefined,
        attachments: msg.attachments ?? undefined,
        toolCalls: msg.toolCalls ?? undefined,
        toolCallId: msg.toolCallId ?? undefined,
        toolName: msg.toolName ?? undefined,
        generatedDocuments: msg.generatedDocuments ?? undefined,
        visualizations: msg.visualizations ?? undefined,
        generatedImages: msg.generatedImages ?? undefined,
        generatedDiagrams: msg.generatedDiagrams ?? undefined,
        generatedPodcasts: msg.generatedPodcasts ?? undefined,
        metadataJson: msg.metadata ? JSON.stringify(msg.metadata) : undefined,
      });
      tokenTotal += countTokens(msg.content);
    }

    if (tokenTotal > 0) {
      await updateThreadTokenCount(newThread.id, tokenTotal);
    }

    return NextResponse.json<{ thread: Thread; copiedMessages: number }>(
      { thread: newThread, copiedMessages: messagesToCopy.length },
      { status: 201 }
    );
  } catch (error) {
    console.error('Fork thread error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to fork thread', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

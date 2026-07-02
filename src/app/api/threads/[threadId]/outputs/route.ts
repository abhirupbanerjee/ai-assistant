import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail, getThreadOwner, getThreadOutputs } from '@/lib/db/compat';
import type { ApiError, ThreadOutputItem } from '@/types';

/**
 * GET /api/threads/[threadId]/outputs
 * Get all generated outputs for a thread.
 * Returns artifacts from thread_outputs table (survives summarization).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { threadId } = await params;

    // Verify thread ownership
    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const thread = await getThreadOwner(threadId);

    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    if (thread.user_id !== dbUser.id && !user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Get all thread outputs
    const outputs = await getThreadOutputs(threadId);

    // Map to response format with download URLs
    const items: ThreadOutputItem[] = outputs.map((output) => ({
      id: output.id,
      threadId: output.thread_id,
      messageId: output.message_id,
      filename: output.filename,
      fileType: output.file_type,
      fileSize: output.file_size,
      downloadUrl: `/api/documents/${output.id}/download`,
      expiresAt: output.expires_at ?? null,
      createdAt: output.created_at,
    }));

    return NextResponse.json({
      outputs: items,
      count: items.length,
    });
  } catch (error) {
    console.error('Get thread outputs error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to get thread outputs',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

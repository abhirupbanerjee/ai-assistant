/**
 * Citation Trajectory API
 *
 * GET /api/chat/:threadId/messages/:messageId/trajectory
 *
 * Returns the full retrieval trajectory for a message's sources:
 * raw vector scores → reranker scores → final selection status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getThread } from '@/lib/threads';
import { getTrajectorySummary } from '@/lib/db/citation-trajectory';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string; messageId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { threadId, messageId } = await params;

    // Verify thread ownership
    const thread = await getThread(user.id, threadId);
    if (!thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const summary = await getTrajectorySummary(messageId, threadId);

    return NextResponse.json(summary);
  } catch (error) {
    console.error('[Trajectory API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load trajectory data' },
      { status: 500 }
    );
  }
}

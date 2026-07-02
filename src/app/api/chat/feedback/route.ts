/**
 * User Feedback API
 *
 * POST /api/chat/feedback
 *
 * Accepts thumbs-up/down ratings and optional corrections on assistant messages.
 * Stores feedback in user_feedback table. If the evolved KB feature is enabled,
 * processes feedback asynchronously for fact extraction / anti-pattern learning.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  insertUserFeedback,
  getFeedbackByUserAndMessage,
  getEvolvedKbSettings,
  getUserEvolvedKbSettings,
  getUserByEmail,
} from '@/lib/db/compat';
import type { ApiError } from '@/types';

export async function POST(request: NextRequest) {
  try {
    // Authenticate
      const user = await getCurrentUser();
      if (!user?.email) {
        return NextResponse.json<ApiError>(
          { error: 'Authentication required', code: 'AUTH_REQUIRED' },
          { status: 401 }
        );
      }
      
      const dbUser = await getUserByEmail(user.email);
      if (!dbUser) {
        return NextResponse.json<ApiError>(
          { error: 'User not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }
      const userId = dbUser.id;

    // Parse body
    const body = await request.json();
    const { query, answer, rating, correction, threadId, messageId, workspaceId, categorySlugs } = body;

    // Validate required fields
    if (!query || typeof query !== 'string') {
      return NextResponse.json<ApiError>(
        { error: 'Missing required field: query', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }
    if (!answer || typeof answer !== 'string') {
      return NextResponse.json<ApiError>(
        { error: 'Missing required field: answer', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }
    if (!rating || !['positive', 'negative'].includes(rating)) {
      return NextResponse.json<ApiError>(
        { error: 'Invalid rating. Must be "positive" or "negative"', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }
    if (!messageId || typeof messageId !== 'string') {
      return NextResponse.json<ApiError>(
        { error: 'Missing required field: messageId', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Double-submit guard: check if user already submitted feedback for this message
    const existing = await getFeedbackByUserAndMessage(userId, messageId);
    if (existing) {
      return NextResponse.json({ success: true, alreadySubmitted: true });
    }

    // Check user opt-in
    const userSettings = await getUserEvolvedKbSettings(userId);
    const allowProcessing = userSettings.allowLearning !== false;

    // Insert feedback
    await insertUserFeedback({
      query,
      answer,
      rating: rating as 'positive' | 'negative',
      correction: correction || null,
      categorySlugs: categorySlugs || null,
      workspaceId: workspaceId || null,
      userId,
      threadId: threadId || null,
      messageId,
    });

    // Fire-and-forget: process feedback for fact extraction (only if evolved KB is enabled)
    if (allowProcessing) {
      const kbSettings = await getEvolvedKbSettings();
      if (kbSettings.enabled || kbSettings.shadowMode) {
        // Process asynchronously — don't block the response
        processFeedbackAsync({
          query,
          answer,
          rating: rating as 'positive' | 'negative',
          correction: correction || null,
          categorySlugs: categorySlugs || null,
          workspaceId: workspaceId || null,
          userId,
          threadId: threadId || null,
          messageId,
        }).catch(err => {
          console.error('[Feedback API] Async processing failed:', err);
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Feedback API] Error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to save feedback', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * Process feedback asynchronously for fact extraction / anti-pattern learning.
 * This is a stub in Phase 0 — will be replaced with real extraction logic in Phase 3.
 */
async function processFeedbackAsync(_feedback: {
  query: string;
  answer: string;
  rating: 'positive' | 'negative';
  correction: string | null;
  categorySlugs: string[] | null;
  workspaceId: string | null;
  userId: number;
  threadId: string | null;
  messageId: string;
}): Promise<void> {
  // TODO (Phase 3): Implement fact extraction from good answers,
  // corrected fact synthesis from negative+correction feedback,
  // and anti-pattern extraction from negative feedback without correction.
}

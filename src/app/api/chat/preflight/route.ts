/**
 * Pre-flight Clarification API Endpoint
 *
 * Receives user responses to pre-flight clarification questions
 * and resolves the paused SSE stream pipeline.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { resolvePreflightById } from '@/lib/streaming/preflight-resolver';
import type { PreflightUserResponse, HitlAction } from '@/types/compliance';
import type { ApiError } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const body = await request.json() as PreflightUserResponse;
    const { messageId, responses, freeTextInputs, fallbackAction } = body;

    if (!messageId || typeof messageId !== 'string') {
      return NextResponse.json<ApiError>(
        { error: 'Message ID is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // If user chose to skip or cancel, resolve with null
    if (fallbackAction === 'continue' || fallbackAction === 'cancel') {
      const resolved = resolvePreflightById(messageId, null);
      console.log(`[Preflight POST] messageId=${messageId} fallbackAction=${fallbackAction} resolved=${resolved}`);
      return NextResponse.json({ success: true, resolved });
    }

    // Build enriched context from user's responses
    const contextParts: string[] = [];

    for (const [questionId, optionId] of Object.entries(responses || {})) {
      contextParts.push(`Q${questionId}: selected "${optionId}"`);
    }

    for (const [questionId, text] of Object.entries(freeTextInputs || {})) {
      if (text.trim()) {
        contextParts.push(`Q${questionId}: "${text.trim()}"`);
      }
    }

    const enrichedContext = contextParts.join('; ');

    const resolved = resolvePreflightById(
      messageId,
      enrichedContext ? { enrichedContext } : null
    );
    console.log(`[Preflight POST] messageId=${messageId} resolved=${resolved} context=${enrichedContext || '(empty)'}`);

    return NextResponse.json({ success: true, resolved });
  } catch (error) {
    console.error('[Preflight API] Error:', error);
    return NextResponse.json<ApiError>(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'SERVICE_ERROR',
      },
      { status: 500 }
    );
  }
}

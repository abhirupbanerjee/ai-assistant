/**
 * HITL (Human-in-the-Loop) API Endpoint
 *
 * Handles user responses to compliance clarification questions.
 * Updates the compliance result in the database and returns retry context if needed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { updateHitlResponse, getComplianceResult } from '@/lib/db/compat';
import { applyUserClarifications } from '@/lib/compliance/hitl';
import type { HitlUserResponse, HitlAction, ComplianceContext } from '@/types/compliance';
import type { ApiError } from '@/types';

/**
 * Request body for HITL response submission
 */
interface HitlSubmitRequest {
  /** Message ID the HITL is for */
  messageId: string;
  /** User's selected responses for each question */
  responses: Record<string, string>;
  /** User's free text inputs for questions that allow it */
  freeTextInputs: Record<string, string>;
  /** Fallback action if user didn't answer questions */
  fallbackAction?: 'accept' | 'accept_flagged' | 'cancel' | 'retry';
}

/**
 * Response from HITL submission
 */
interface HitlSubmitResponse {
  success: boolean;
  action: HitlAction;
  retryContext?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const body = await request.json() as HitlSubmitRequest;
    const { messageId, responses, freeTextInputs, fallbackAction } = body;

    // Validate required fields
    if (!messageId || typeof messageId !== 'string') {
      return NextResponse.json<ApiError>(
        { error: 'Message ID is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Get the compliance result for this message
    const complianceResult = await getComplianceResult(messageId);
    if (!complianceResult) {
      return NextResponse.json<ApiError>(
        { error: 'Compliance result not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Build user response object
    const userResponse: HitlUserResponse = {
      responses: responses || {},
      freeTextInputs: freeTextInputs || {},
      fallbackAction: fallbackAction,
      timestamp: new Date().toISOString(),
    };

    // Build minimal context for applying clarifications
    const context: ComplianceContext = {
      userMessage: '', // Not needed for response processing
      response: '',
      toolExecutions: [],
      matchedSkills: [],
      toolRoutingMatches: [],
      messageId,
      conversationId: complianceResult.conversation_id,
    };

    // Apply user's clarifications to determine action
    const result = applyUserClarifications(userResponse, context);

    // Determine the final action
    const action: HitlAction = fallbackAction === 'accept' ? 'continue'
      : fallbackAction === 'accept_flagged' ? 'continue'
      : fallbackAction === 'cancel' ? 'continue'
      : result.action;

    // Update the compliance result in the database
    await updateHitlResponse(messageId, userResponse, action);

    // Build response
    const response: HitlSubmitResponse = {
      success: true,
      action,
    };

    // Include retry context if user chose to retry
    if (result.action === 'retry' && result.retryContext) {
      response.retryContext = result.retryContext;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('[HITL API] Error:', error);
    return NextResponse.json<ApiError>(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'SERVICE_ERROR',
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getThread } from '@/lib/threads';
import { updateThreadModel, getEffectiveModelForThread, getThreadById } from '@/lib/db/threads';
import { getActiveModels, getDefaultModel, getEnabledModel } from '@/lib/db/enabled-models';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ threadId: string }>;
}

/**
 * GET /api/threads/[threadId]/model
 *
 * Get current model configuration for a thread
 * Returns: current override, effective model, and available models
 */
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

    // Use getThread which handles ownership verification internally
    const thread = await getThread(user.id, threadId);
    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get the raw thread data for selected_model field
    const dbThread = getThreadById(threadId);

    // Get available models (only active/enabled ones)
    const availableModels = getActiveModels();

    // Get global default
    const defaultModel = getDefaultModel();
    const globalDefault = defaultModel?.id || null;

    // Get effective model (thread override or global)
    const effectiveModel = getEffectiveModelForThread(threadId);

    return NextResponse.json({
      threadId,
      selectedModel: dbThread?.selected_model || null,  // NULL or specific model ID
      effectiveModel,                                    // Resolved model ID
      globalDefault,                                     // For UI display
      availableModels,                                   // All available models
    });
  } catch (error) {
    console.error('[API] Error getting thread model:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to get thread model', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/threads/[threadId]/model
 *
 * Update thread's model selection
 * Body: { modelId: string | null }
 *   - NULL = reset to global default
 *   - string = set specific model override
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { threadId } = await params;

    // Use getThread which handles ownership verification internally
    const thread = await getThread(user.id, threadId);
    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { modelId } = body;

    // Validate model exists if not NULL
    if (modelId !== null && modelId !== undefined) {
      const model = getEnabledModel(modelId);

      if (!model) {
        return NextResponse.json<ApiError>(
          {
            error: `Model '${modelId}' not found in available models`,
            code: 'VALIDATION_ERROR'
          },
          { status: 400 }
        );
      }

      if (!model.enabled) {
        return NextResponse.json<ApiError>(
          {
            error: `Model '${modelId}' is currently disabled`,
            code: 'VALIDATION_ERROR'
          },
          { status: 400 }
        );
      }
    }

    // Update thread model
    const success = updateThreadModel(threadId, modelId || null);

    if (!success) {
      return NextResponse.json<ApiError>(
        { error: 'Failed to update thread model', code: 'SERVICE_ERROR' },
        { status: 500 }
      );
    }

    // Get updated effective model
    const effectiveModel = getEffectiveModelForThread(threadId);

    return NextResponse.json({
      success: true,
      threadId,
      selectedModel: modelId || null,
      effectiveModel,
    });
  } catch (error) {
    console.error('[API] Error updating thread model:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to update thread model', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

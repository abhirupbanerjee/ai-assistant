import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail } from '@/lib/db/compat';
import { ragQuery } from '@/lib/rag';
import { getThread, addMessage, getMessages, getUploadPaths, getThreadCategorySlugsForQuery } from '@/lib/threads';
import {
  getMemoryContext,
  processConversationForMemory,
} from '@/lib/memory';
import {
  countTokens,
  updateThreadTokenCount,
  shouldSummarize,
  summarizeThread,
  getThreadSummary,
  formatSummaryForContext,
} from '@/lib/summarization';
import { getMemorySettings, getSummarizationSettings } from '@/lib/db/compat';
import { runWithContextAsync } from '@/lib/request-context';
import {
  buildModelsToTry,
  withModelFallback,
  LlmFallbackError,
} from '@/lib/llm-fallback';
import type { Message, ChatRequest, ChatResponse, ApiError } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const body = await request.json() as ChatRequest;
    const { message, threadId } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json<ApiError>(
        { error: 'Message is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    if (!threadId || typeof threadId !== 'string') {
      return NextResponse.json<ApiError>(
        { error: 'Thread ID is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Verify thread ownership
    const thread = await getThread(user.id, threadId);
    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get user from database for memory
    const dbUser = await getUserByEmail(user.email);
    const memorySettings = await getMemorySettings();
    const summarizationSettings = await getSummarizationSettings();

    // Create user message
    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };

    // Save user message
    await addMessage(user.id, threadId, userMessage);

    // Track user message tokens
    const userTokens = countTokens(message);
    await updateThreadTokenCount(threadId, userTokens);

    // Get conversation history (dynamic based on settings)
    // Get more messages than needed to allow for dynamic context management
    const conversationHistory = await getMessages(user.id, threadId, 50);

    // Get thread categories for category-based search
    const categorySlugs = await getThreadCategorySlugsForQuery(threadId);
    console.log('[Chat API] Thread categories:', { threadId, categorySlugs });

    // Get category IDs for memory context
    const categoryIds = thread.categories?.map(c => c.id) || [];

    // Get memory context if enabled
    let memoryContext = '';
    if (memorySettings.enabled && dbUser) {
      memoryContext = await getMemoryContext(dbUser.id, categoryIds);
    }

    // Get thread summary context if available
    let summaryContext = '';
    const existingSummary = await getThreadSummary(threadId);
    if (existingSummary) {
      summaryContext = formatSummaryForContext(existingSummary.summary);
    }

    // Get user uploaded documents
    const uploadPaths = await getUploadPaths(user.id, threadId);

    // Create message ID for context (used by autonomous tools)
    const assistantMessageId = uuidv4();

    // Build models to try based on capabilities
    // Non-streaming route doesn't handle images, so no vision requirement
    const { models: modelsToTry } = await buildModelsToTry(
      null,   // No per-thread model selection in non-streaming route
      false,  // No vision requirement (images handled by streaming route)
      true    // Tools are enabled
    );

    // Handle edge case: no models available
    if (modelsToTry.length === 0) {
      return NextResponse.json<ApiError>(
        {
          error: 'No LLM models available. Please contact your administrator.',
          code: 'NO_MODELS_AVAILABLE',
        },
        { status: 503 }
      );
    }

    // Track which model was used
    let usedModel: string = modelsToTry[0];

    // Run RAG query with context for autonomous tools and automatic fallback
    // Context allows tools like doc_gen to know the threadId/categoryId
    let ragResult: Awaited<ReturnType<typeof ragQuery>>;

    try {
      const fallbackResult = await withModelFallback({
        modelsToTry,
        execute: (model) =>
          runWithContextAsync(
            {
              threadId,
              messageId: assistantMessageId,
              categoryIds: categoryIds,
              userId: user.id,
            },
            () =>
              ragQuery(
                message,
                conversationHistory.slice(0, -1), // Exclude the message we just added
                uploadPaths,
                categorySlugs.length > 0 ? categorySlugs : undefined,
                memoryContext,
                summaryContext,
                model // Pass model for fallback support
              )
          ),
        context: { threadId, userId: user.id },
      });

      ragResult = fallbackResult.result;
      usedModel = fallbackResult.usedModel;
    } catch (error) {
      if (error instanceof LlmFallbackError) {
        return NextResponse.json<ApiError>(
          {
            error: error.message,
            code: error.code,
          },
          { status: error.recoverable ? 503 : 500 }
        );
      }
      throw error;
    }

    const { answer, sources, generatedDocuments, generatedImages, visualizations } = ragResult;

    // Create assistant message
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: answer,
      sources,
      generatedDocuments,
      generatedImages,
      visualizations,
      timestamp: new Date(),
    };

    // Save assistant message
    await addMessage(user.id, threadId, assistantMessage);

    // Track assistant message tokens
    const assistantTokens = countTokens(answer);
    await updateThreadTokenCount(threadId, assistantTokens);

    // Check if summarization is needed (async, non-blocking)
    if (summarizationSettings.enabled && await shouldSummarize(threadId)) {
      // Trigger summarization in background
      summarizeThread(threadId).catch(err => {
        console.error('[Chat API] Background summarization failed:', err);
      });
    }

    // Process conversation for memory extraction if enabled (async, non-blocking)
    if (memorySettings.enabled && memorySettings.autoExtractOnThreadEnd && dbUser) {
      // Process with recent conversation
      const recentMessages = conversationHistory.slice(-10).map(m => ({
        role: m.role,
        content: m.content,
      }));
      processConversationForMemory(dbUser.id, categoryIds[0] || null, recentMessages).catch(err => {
        console.error('[Chat API] Background memory extraction failed:', err);
      });
    }

    return NextResponse.json<ChatResponse>({
      message: assistantMessage,
      threadId,
      model: usedModel,
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to process message',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

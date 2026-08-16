import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail, getEffectiveModelForThread, getProcessingDocumentsByCategory } from '@/lib/db/compat';
import { rateLimitMiddleware } from '@/lib/rate-limiter';
import { ragQuery } from '@/lib/rag';
import { getThread, addMessage, getMessages, getUploadPaths, getThreadCategorySlugsForQuery } from '@/lib/threads';
import {
  assemblePersonalMemoryContext,
  processConversationForMemory,
} from '@/lib/memory';
import { retrieveCategoryMemory } from '@/lib/category-memory';
import { runCategoryMemoryCandidateLearning } from '@/lib/category-memory-learning';
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
import { AUTO_MODEL_SENTINEL } from '@/lib/constants';
import { selectBestModel, isAutoSentinel } from '@/lib/auto-model-selector';
import type { Message, ChatRequest, ChatResponse, ApiError } from '@/types';

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 30 requests per 60 seconds per IP
    const rateLimitResponse = rateLimitMiddleware(request, { maxRequests: 30, windowMs: 60_000 });
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const body = await request.json() as ChatRequest;
    const { message, threadId, activeCategoryId } = body;

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

    // Thread category IDs are server-derived. Never retrieve category memory
    // from an unverified client activeCategoryId.
    const categoryIds = thread.categories?.map(c => c.id) || [];
    const verifiedCategoryId = activeCategoryId && categoryIds.includes(activeCategoryId) ? activeCategoryId : null;

    const personalMemory = await assemblePersonalMemoryContext({
      surface: 'main-chat',
      userId: dbUser?.id ?? null,
      query: message,
    });
    const categoryMemory = verifiedCategoryId && dbUser
      ? await retrieveCategoryMemory({ userId: dbUser.id, role: dbUser.role, categoryId: verifiedCategoryId, query: message })
      : { promptContext: '' };
    const memoryContext = [personalMemory.promptContext, categoryMemory.promptContext].filter(Boolean).join('\n\n');

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

    // Resolve effective model for this thread (may be AUTO_MODEL_SENTINEL)
    let effectiveModel = await getEffectiveModelForThread(threadId);

    // ── Resolve Auto model selection ──
    // Non-streaming route doesn't handle images, so hasImages is always false.
    if (isAutoSentinel(effectiveModel)) {
      try {
        const estimatedTokens = countTokens(message)
          + conversationHistory.reduce((sum, m) => sum + countTokens(m.content || ''), 0);
        const picked = await selectBestModel({
          userMessage: message,
          categoryIds,
          hasImages: false,
          estimatedTokens,
        });
        effectiveModel = picked.modelId;
        const autoMsg = picked.reason === 'best_score' && picked.dominantFactor
          ? `Auto-selected ${picked.displayName} (best ${picked.dominantFactor})`
          : `Auto-selected ${picked.displayName} (${picked.reason.replace(/_/g, ' ')})`;
        console.log(`[Chat API] ${autoMsg}`);
      } catch (err) {
        // Auto selection failed — fall back to global default
        console.error('[Chat API] Auto model selection failed, falling back to default:', err);
        const { getDefaultModel } = await import('@/lib/db/compat/enabled-models');
        const defaultModel = await getDefaultModel();
        effectiveModel = defaultModel?.id || null;
      }
    }

    // Build models to try based on capabilities
    // Non-streaming route doesn't handle images, so no vision requirement
    const { models: modelsToTry } = await buildModelsToTry(
      effectiveModel,  // Resolved model (or null if Auto failed with no default)
      false,           // No vision requirement (images handled by streaming route)
      true             // Tools are enabled
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

    const { answer, sources, generatedDocuments, generatedImages, visualizations, userDocErrors } = ragResult;

    // BUG FIX (#2 — Async Processing Race): Check if any documents in the thread's
    // categories (or global docs) are still being processed. If so, include their
    // filenames in the response so the frontend can warn the user that their
    // document isn't ready yet.
    let processingDocuments: string[] = [];
    try {
      processingDocuments = await getProcessingDocumentsByCategory(categoryIds);
      if (processingDocuments.length > 0) {
        console.log('[Chat API] Documents still processing:', processingDocuments);
      }
    } catch (err) {
      console.error('[Chat API] Failed to check processing documents:', err);
    }

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

    // Explicit awaited post-response write-back for durable Personal Memory.
    if (memorySettings.enabled && memorySettings.autoExtractOnThreadEnd && dbUser) {
      // Process with recent conversation
      const recentMessages = conversationHistory.slice(-10).map(m => ({
        role: m.role,
        content: m.content,
      }));
      await processConversationForMemory(dbUser.id, verifiedCategoryId, recentMessages);
    }

    // Explicit awaited Phase 5 post-response hook. This authenticated main-chat
    // route is the only eligible surface; the hook independently re-verifies
    // ownership, exact thread category, and current category access.
    if (dbUser) {
      await runCategoryMemoryCandidateLearning({
        surface: 'main-chat',
        userId: dbUser.id,
        role: dbUser.role,
        threadId,
        categoryId: verifiedCategoryId,
        sourceMessageId: userMessage.id,
        recentMessages: [
          ...conversationHistory.slice(-9).map((item) => ({ role: item.role, content: item.content })),
          { role: 'assistant', content: answer },
        ],
      });
    }

    return NextResponse.json<ChatResponse>({
      message: assistantMessage,
      threadId,
      model: usedModel,
      processingDocuments: processingDocuments.length > 0 ? processingDocuments : undefined,
      userDocErrors,
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

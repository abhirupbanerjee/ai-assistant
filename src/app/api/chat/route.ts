import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail } from '@/lib/db/users';
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
import { getMemorySettings, getSummarizationSettings } from '@/lib/db/config';
import { runWithContextAsync } from '@/lib/request-context';
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
    const dbUser = getUserByEmail(user.email);
    const memorySettings = getMemorySettings();
    const summarizationSettings = getSummarizationSettings();

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
    updateThreadTokenCount(threadId, userTokens);

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
      memoryContext = getMemoryContext(dbUser.id, categoryIds);
    }

    // Get thread summary context if available
    let summaryContext = '';
    const existingSummary = getThreadSummary(threadId);
    if (existingSummary) {
      summaryContext = formatSummaryForContext(existingSummary.summary);
    }

    // Get user uploaded documents
    const uploadPaths = await getUploadPaths(user.id, threadId);

    // Create message ID for context (used by autonomous tools)
    const assistantMessageId = uuidv4();

    // Run RAG query with context for autonomous tools
    // Context allows tools like doc_gen to know the threadId/categoryId
    const { answer, sources, generatedDocuments, generatedImages, visualizations } = await runWithContextAsync(
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
          summaryContext
        )
    );

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
    updateThreadTokenCount(threadId, assistantTokens);

    // Check if summarization is needed (async, non-blocking)
    if (summarizationSettings.enabled && shouldSummarize(threadId)) {
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

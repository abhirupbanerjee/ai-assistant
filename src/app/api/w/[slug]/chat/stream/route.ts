/**
 * Workspace Chat Stream API
 *
 * SSE-based streaming endpoint for workspace chat.
 * Handles both embed and standalone modes with appropriate context.
 *
 * Key differences from main chat:
 * - No user memory (workspace users don't have persistent memory)
 * - Uses workspace-linked categories for RAG
 * - Session-based rather than thread-based for embed mode
 * - Simpler message storage (no artifacts for embed)
 */

import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail } from '@/lib/db/compat';
import {
  validateWorkspaceRequest,
  extractOrigin,
  extractIP,
  hashIP,
  getWorkspaceSystemPrompt,
  getWorkspaceLLMConfig,
} from '@/lib/workspace/validator';
import {
  getSession,
  isSessionValid,
  incrementMessageCount,
  getWorkspaceThread as getThread,
  createWorkspaceThread as createThread,
  touchThread,
  addWorkspaceMessage as addMessage,
  getRecentSessionMessages,
  getRecentThreadMessages,
} from '@/lib/db/compat';
import {
  checkAndIncrementRateLimit,
  getRateLimitHeaders,
} from '@/lib/workspace/rate-limiter';
import { getWorkspaceCategorySlugs, getCategoryIdsBySlugs } from '@/lib/db/compat';
import { runWithContextAsync } from '@/lib/request-context';
import { generateResponseWithTools } from '@/lib/openai';
import { recordTokenUsage } from '@/lib/token-logger';
import {
  createSSEEncoder,
  getSSEHeaders,
  getPhaseMessage,
  performRAGRetrieval,
  STREAMING_CONFIG,
} from '@/lib/streaming';
import type { StreamEvent, Message, Source, MessageVisualization, GeneratedDocumentInfo, GeneratedImageInfo, ImageContent } from '@/types';
import type { WorkspaceMessageSource } from '@/types/workspace';
import { getWorkspaceUploadDetails } from '@/lib/workspace/uploads';
import { readFileBuffer } from '@/lib/storage';
import { getImageCapabilities } from '@/lib/config-capability-checker';
import { countTokens } from '@/lib/summarization';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

interface WorkspaceChatRequest {
  message: string;
  sessionId: string;
  threadId?: string; // Only for standalone mode
  attachments?: string[]; // Filenames of uploaded files to include
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const encoder = createSSEEncoder();
  let keepAliveInterval: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // Helper to send SSE events
      const send = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(event));
        } catch {
          // Controller closed, ignore
        }
      };

      // Setup keep-alive ping
      keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.keepAlive());
        } catch {
          // Controller closed
        }
      }, STREAMING_CONFIG.KEEPALIVE_INTERVAL_MS);

      // Handle client abort
      const cleanup = () => {
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }
      };

      request.signal.addEventListener('abort', cleanup);

      try {
        const { slug } = await context.params;
        const origin = extractOrigin(request.headers);
        const ip = extractIP(request.headers);
        const ipHash = hashIP(ip);

        // ============ Phase 1: Validation ============
        const body = await request.json() as WorkspaceChatRequest;
        const { message, sessionId, threadId, attachments } = body;

        if (!message || !sessionId) {
          send({ type: 'error', code: 'VALIDATION_ERROR', message: 'Missing required fields', recoverable: false });
          cleanup();
          controller.close();
          return;
        }

        // Validate workspace
        const validation = await validateWorkspaceRequest(slug, {
          origin: origin || undefined,
          checkEnabled: true,
        });

        if (!validation.valid || !validation.workspace) {
          send({ type: 'error', code: validation.errorCode || 'VALIDATION_ERROR', message: validation.error || 'Invalid workspace', recoverable: false });
          cleanup();
          controller.close();
          return;
        }

        const workspace = validation.workspace;

        // Validate session
        if (!(await isSessionValid(sessionId))) {
          send({ type: 'error', code: 'SESSION_EXPIRED', message: 'Session expired', recoverable: false });
          cleanup();
          controller.close();
          return;
        }

        const session = await getSession(sessionId);
        if (!session || session.workspace_id !== workspace.id) {
          send({ type: 'error', code: 'SESSION_INVALID', message: 'Invalid session', recoverable: false });
          cleanup();
          controller.close();
          return;
        }

        // Rate limiting for embed mode
        if (workspace.type === 'embed') {
          const rateLimit = await checkAndIncrementRateLimit(workspace.id, ipHash, sessionId);

          if (!rateLimit.allowed) {
            send({
              type: 'error',
              code: 'RATE_LIMITED',
              message: `Rate limit exceeded. Resets at ${rateLimit.resetAt?.toISOString() || 'unknown'}`,
              recoverable: false,
            });
            cleanup();
            controller.close();
            return;
          }
        }

        send({ type: 'status', phase: 'init', content: getPhaseMessage('init') });
        const requestStart = Date.now();

        // ============ Setup ============
        // Get workspace categories for RAG
        const categorySlugs = await getWorkspaceCategorySlugs(workspace.id);
        const categoryIds = categorySlugs.length > 0
          ? await getCategoryIdsBySlugs(categorySlugs)
          : [];

        // Resolve effective LLM config (workspace override → global default)
        const workspaceLLMConfig = await getWorkspaceLLMConfig(workspace);

        // Get system prompt
        const systemPromptOverride = await getWorkspaceSystemPrompt(workspace);

        // Get conversation history based on mode
        let conversationHistory: Message[] = [];
        let currentThreadId: string | undefined;

        if (workspace.type === 'standalone' && threadId) {
          // Standalone mode: use thread-based history
          const thread = await getThread(threadId);
          if (thread && thread.session_id === sessionId) {
            currentThreadId = threadId;
            const recentMessages = await getRecentThreadMessages(threadId, 20);
            conversationHistory = recentMessages.map(m => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: new Date(m.created_at),
            }));
            await touchThread(threadId);
          }
        } else if (workspace.type === 'embed') {
          // Embed mode: use session-based history (last N messages)
          const recentMessages = await getRecentSessionMessages(sessionId, 10);
          conversationHistory = recentMessages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.created_at),
          }));
        }

        // Create user message
        const userMessageId = uuidv4();
        const userMessage = await addMessage({
          workspaceId: workspace.id,
          sessionId,
          threadId: currentThreadId,
          role: 'user',
          content: message,
        });

        // Increment session message count
        await incrementMessageCount(sessionId);

        // Create assistant message ID
        const assistantMessageId = uuidv4();

        // ============ Run with request context ============
        await runWithContextAsync(
          {
            threadId: currentThreadId || sessionId,
            messageId: assistantMessageId,
            categoryIds: categoryIds,
            userId: session.user_id ? String(session.user_id) : undefined,
          },
          async () => {
            // ============ Phase 2: RAG Retrieval ============
            send({ type: 'status', phase: 'rag', content: getPhaseMessage('rag') });

            // Load uploaded files if any attachments specified
            let userDocPaths: string[] = [];
            let imageContents: ImageContent[] = [];

            // Check image processing capabilities for current model
            const imageCapabilities = await getImageCapabilities(workspaceLLMConfig.model);

            if (attachments && attachments.length > 0 && workspace.file_upload_enabled) {
              const uploadDetails = await getWorkspaceUploadDetails(
                workspace.id,
                sessionId,
                attachments
              );

              // Document paths for RAG text extraction (PDFs, DOCX, etc.)
              // Also include images for OCR text extraction as additional context
              userDocPaths = [
                ...uploadDetails.documents.map(d => d.filepath),
                ...uploadDetails.images.map(i => i.filepath),
              ];

              // Check capabilities before loading images
              if (uploadDetails.images.length > 0) {
                if (!imageCapabilities.canProcessImages) {
                  // Scenario 1: No vision, no OCR - warn user
                  send({
                    type: 'status',
                    phase: 'rag',
                    content: `⚠️ Images cannot be processed. ${imageCapabilities.message}`,
                  });
                } else if (imageCapabilities.strategy === 'ocr-only') {
                  // Scenario 2: OCR only - inform user
                  send({
                    type: 'status',
                    phase: 'rag',
                    content: `ℹ️ ${imageCapabilities.message}`,
                  });
                }

                // Only load images for LLM if vision is supported
                if (imageCapabilities.hasVisionSupport) {
                  for (const img of uploadDetails.images) {
                    try {
                      const buffer = await readFileBuffer(img.filepath);
                      imageContents.push({
                        base64: buffer.toString('base64'),
                        mimeType: img.mimeType,
                        filename: img.filename,
                      });
                    } catch (err) {
                      console.warn(`Failed to load image ${img.filename}:`, err);
                    }
                  }
                }
              }
            }

            // No memory context for workspace chat
            // No summary context for workspace chat
            const ragStart = Date.now();
            const ragResult = await performRAGRetrieval(
              message,
              categorySlugs,
              userDocPaths, // User uploaded documents
              '', // No memory context
              '', // No summary context
              send
            );
            const ragMs = Date.now() - ragStart;

            // Apply workspace system prompt override
            let finalSystemPrompt = ragResult.systemPrompt;
            if (systemPromptOverride) {
              finalSystemPrompt = `${systemPromptOverride}\n\n${ragResult.systemPrompt}`;
            }

            // Send sources from RAG
            send({ type: 'sources', data: ragResult.sources });

            // ============ Phase 3: Tool Execution ============
            send({ type: 'status', phase: 'tools', content: getPhaseMessage('tools') });

            // Track collected artifacts (standalone only)
            const visualizations: MessageVisualization[] = [];
            const documents: GeneratedDocumentInfo[] = [];
            const images: GeneratedImageInfo[] = [];
            const webSources: Source[] = [];

            // Determine if this is embed mode (text-only, no visual artifacts)
            const isEmbedMode = workspace.type === 'embed';

            // Determine which tools to exclude based on workspace settings
            const excludeTools: string[] = [];
            if (!workspace.web_search_enabled) {
              excludeTools.push('web_search');
            }

            // Execute tools with streaming callbacks
            const llmStart = Date.now();
            const toolResult = await generateResponseWithTools(
              finalSystemPrompt,
              conversationHistory,
              ragResult.context,
              message,
              true, // Enable tools
              ragResult.categoryIds,
              {
                // Stream content tokens directly to the client as they are generated
                onChunk: (text: string) => send({ type: 'chunk', content: text }),
                onToolStart: (name, displayName) => {
                  send({ type: 'tool_start', name, displayName });
                },
                onToolEnd: (name, success, duration, error) => {
                  send({ type: 'tool_end', name, success, duration, error });
                },
                onArtifact: (type, data) => {
                  // Embed mode: TEXT ONLY - do not send visual artifacts (charts, documents, images)
                  // Standalone mode: Full artifact support
                  if (isEmbedMode) {
                    // Skip all visual artifacts for embed mode
                    // The system prompt already tells the LLM not to use these tools
                    return;
                  }

                  // Standalone mode: process all artifact types
                  if (type === 'visualization') {
                    const viz = data as MessageVisualization;
                    visualizations.push(viz);
                    send({ type: 'artifact', subtype: 'visualization', data: viz });
                  } else if (type === 'document') {
                    const doc = data as GeneratedDocumentInfo;
                    documents.push(doc);
                    send({ type: 'artifact', subtype: 'document', data: doc });
                  } else if (type === 'image') {
                    const img = data as GeneratedImageInfo;
                    images.push(img);
                    send({ type: 'artifact', subtype: 'image', data: img });
                  }
                },
              },
              imageContents.length > 0 ? imageContents : undefined,
              undefined, // summaryContext
              undefined, // memoryContext
              undefined, // categorySlugs
              excludeTools.length > 0 ? excludeTools : undefined,
              imageCapabilities, // Image processing strategy
              workspaceLLMConfig.model || undefined // modelOverride
            );
            const llmMs = Date.now() - llmStart;

            // Extract web sources from tool history
            for (const msg of toolResult.fullHistory) {
              if (msg.role === 'tool') {
                try {
                  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                  const parsed = JSON.parse(content);
                  if (parsed.results && Array.isArray(parsed.results)) {
                    for (const result of parsed.results) {
                      webSources.push({
                        documentName: `[WEB] ${result.title || result.url}`,
                        pageNumber: 0,
                        chunkText: result.content?.substring(0, 200) || '',
                        score: result.score || 0,
                      });
                    }
                  }
                } catch {
                  // Not a web search result
                }
              }
            }

            // Combine all sources
            const allSources = [...ragResult.sources, ...webSources];

            // ============ Phase 4: Finalize Content ============
            // Content tokens were already streamed token-by-token via onChunk above.
            const fullContent = toolResult.content;

            // ============ Save Message ============
            // Convert sources to workspace format
            const workspaceSources: WorkspaceMessageSource[] = allSources.map(s => ({
              document_name: s.documentName,
              page_number: s.pageNumber,
              chunk_text: s.chunkText,
              score: s.score,
            }));

            await addMessage({
              workspaceId: workspace.id,
              sessionId,
              threadId: currentThreadId,
              role: 'assistant',
              content: fullContent,
              sources: workspaceSources,
              latencyMs: Date.now() - new Date(userMessage.created_at).getTime(),
              tokensUsed: toolResult.totalTokens || undefined,
              model: workspaceLLMConfig.model || undefined,
            });

            // Increment session message count for assistant message
            await incrementMessageCount(sessionId);

            // Log token usage for dashboard
            recordTokenUsage({
              category: 'workspace',
              model: workspaceLLMConfig.model || 'unknown',
              totalTokens: toolResult.totalTokens,
            });

            // Send completion
            send({
              type: 'done',
              messageId: assistantMessageId,
              threadId: currentThreadId || sessionId,
              model: workspaceLLMConfig.model || undefined,
              totalMs: Date.now() - requestStart,
              llmMs,
              ragMs,
              completionTokens: toolResult.totalTokens || countTokens(fullContent),
              tokensEstimated: !toolResult.totalTokens,
            });
          }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Workspace chat error:', error);
        send({ type: 'error', code: 'UNKNOWN_ERROR', message, recoverable: false });
      } finally {
        cleanup();
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: getSSEHeaders() });
}

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
import { resolveUserOrganizationIdByUserId } from '@/lib/org-membership';
import { generateResponseWithTools } from '@/lib/openai';
import { recordTokenUsage } from '@/lib/token-logger';
import { TAVILY_TOOL_NAMES } from '@/lib/tools';
import { selectBestModel, isAutoSentinel } from '@/lib/auto-model-selector';
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

// Cap on unique sources surfaced to the client and persisted to history.
// Sources are deduped by document name (RAG dedup in extractSources, combined dedup below)
// so this is a cap on UNIQUE documents, not chunks.
const MAX_SOURCES_DISPLAYED = 3;

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

        // Resolve the session owner's organization server-side for tenancy.
        const organizationId = await resolveUserOrganizationIdByUserId(session.user_id ?? null);

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

        // Resolve Auto model sentinel — workspace model can be set to 'auto'
        let effectiveWorkspaceModel = workspaceLLMConfig.model;
        if (isAutoSentinel(effectiveWorkspaceModel)) {
          try {
            const estimatedTokens = countTokens(message);
            const picked = await selectBestModel({
              userMessage: message,
              categoryIds,
              hasImages: false,
              estimatedTokens,
            });
            effectiveWorkspaceModel = picked.modelId;
            const autoMsg = picked.reason === 'best_score' && picked.dominantFactor
              ? `[Workspace Auto] Auto-selected ${picked.displayName} (best ${picked.dominantFactor})`
              : `[Workspace Auto] Auto-selected ${picked.displayName} (${picked.reason.replace(/_/g, ' ')})`;
            console.log(autoMsg);
          } catch (err) {
            console.error('[Workspace Auto] selection failed, using default:', err);
            const { getDefaultModel } = await import('@/lib/db/compat/enabled-models');
            const defaultModel = await getDefaultModel();
            effectiveWorkspaceModel = defaultModel?.id || '';
          }
        }

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
            organizationId: organizationId ?? undefined,
          },
          async () => {
            // ============ Phase 2: RAG Retrieval ============
            send({ type: 'status', phase: 'rag', content: getPhaseMessage('rag') });

            // Load uploaded files if any attachments specified
            let userDocPaths: string[] = [];
            let imageContents: ImageContent[] = [];

            // Check image processing capabilities for current model
            const imageCapabilities = await getImageCapabilities(effectiveWorkspaceModel);

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

            // Send sources from RAG (only if workspace has sources enabled).
            // Cap at MAX_SOURCES_DISPLAYED; RAG sources are already deduped by document in extractSources.
            if (workspace.sources_enabled) {
              send({ type: 'sources', data: ragResult.sources.slice(0, MAX_SOURCES_DISPLAYED) });
            }

            // ============ Phase 3: Tool Execution ============
            send({ type: 'status', phase: 'tools', content: getPhaseMessage('tools') });

            // Track collected artifacts (standalone only)
            const visualizations: MessageVisualization[] = [];
            const documents: GeneratedDocumentInfo[] = [];
            const images: GeneratedImageInfo[] = [];
            const webSources: Source[] = [];

            // Determine if this is embed mode (text-only, no visual artifacts)
            const isEmbedMode = workspace.type === 'embed';

            // Determine which tools to exclude based on workspace settings.
            // Disabling web search is a category-wide kill switch for every
            // Tavily-backed tool (web_search, web_extract, web_crawl, web_map).
            const excludeTools: string[] = [];
            if (!workspace.web_search_enabled) {
              excludeTools.push(...TAVILY_TOOL_NAMES);
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
              effectiveWorkspaceModel || undefined // modelOverride
            );
            const llmMs = Date.now() - llmStart;

            // Extract sources from tool history, gated by TOOL NAME — not result
            // shape. kb_search also returns a `results` array (with filename/page/
            // text instead of title/url/content); without the name gate it was
            // misclassified as web_search output and rendered "[WEB] undefined".
            const toolNameByCallId = new Map<string, string>();
            for (const msg of toolResult.fullHistory) {
              if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
                for (const tc of msg.tool_calls) {
                  const fn = (tc as { function?: { name?: string } }).function;
                  if (tc.id && fn?.name) toolNameByCallId.set(tc.id, fn.name);
                }
              }
            }

            // kb_search passages become proper KB sources (filename + page
            // citations), deduped by (document, page) before merging.
            const kbToolSources = new Map<string, Source>();

            for (const msg of toolResult.fullHistory) {
              if (msg.role !== 'tool') continue;
              const toolName = toolNameByCallId.get(msg.tool_call_id);
              try {
                const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                const parsed = JSON.parse(content);

                if ((toolName === 'web_search' || toolName === 'web_extract') && parsed.results && Array.isArray(parsed.results)) {
                  for (const result of parsed.results) {
                    webSources.push({
                      documentName: `[WEB] ${result.title || result.url}`,
                      pageNumber: 0,
                      chunkText: result.content?.substring(0, 200) || '',
                      score: result.score || 0,
                      url: result.url,
                    });
                  }
                } else if (toolName === 'kb_search' && parsed.success && Array.isArray(parsed.results)) {
                  for (const r of parsed.results) {
                    if (!r || typeof r.filename !== 'string') continue;
                    const key = `${r.filename}#${typeof r.page === 'number' ? r.page : 0}`;
                    const score = typeof r.score === 'number' ? r.score : 0;
                    const existing = kbToolSources.get(key);
                    if (!existing || score > existing.score) {
                      kbToolSources.set(key, {
                        documentName: r.filename,
                        pageNumber: typeof r.page === 'number' ? r.page : 0,
                        chunkText: typeof r.text === 'string' ? r.text.substring(0, 200) : '',
                        score,
                      });
                    }
                  }
                }
              } catch {
                // Not a JSON tool result — ignore
              }
            }

            // Combine RAG + web sources, dedupe by document name (web entries are prefixed [WEB]
            // so they never collide with RAG docs of the same name), and cap at MAX_SOURCES_DISPLAYED.
            const combinedByName = new Map<string, Source>();
            for (const s of [...ragResult.sources, ...kbToolSources.values(), ...webSources]) {
              const existing = combinedByName.get(s.documentName);
              if (!existing || s.score > existing.score) combinedByName.set(s.documentName, s);
            }
            const allSources = Array.from(combinedByName.values())
              .sort((a, b) => b.score - a.score)
              .slice(0, MAX_SOURCES_DISPLAYED);

            // Send combined sources (including web search results) if workspace has sources enabled
            if (workspace.sources_enabled && allSources.length > 0) {
              send({ type: 'sources', data: allSources });
            }

            // ============ Phase 4: Finalize Content ============
            // Content tokens were already streamed token-by-token via onChunk above.
            const fullContent = toolResult.content;

            // ============ Signal completion ============
            // Emit `done` immediately after the final token so the client can
            // unlock the input and stop the cursor without waiting on persistence.
            send({
              type: 'done',
              messageId: assistantMessageId,
              threadId: currentThreadId || sessionId,
              model: effectiveWorkspaceModel || undefined,
              totalMs: Date.now() - requestStart,
              llmMs,
              ragMs,
              completionTokens: toolResult.totalTokens || countTokens(fullContent),
              tokensEstimated: !toolResult.totalTokens,
            });

            // ============ Save Message (after the client is already done) ============
            // Persistence errors are logged but never surfaced as an SSE error,
            // since the response has already been delivered to the user.
            try {
              // Convert sources to workspace format (persist the same deduped/capped list)
              const workspaceSources: WorkspaceMessageSource[] = allSources.map(s => ({
                document_name: s.documentName,
                page_number: s.pageNumber,
                chunk_text: s.chunkText,
                score: s.score,
                url: s.url,
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
                model: effectiveWorkspaceModel || undefined,
              });

              // Increment session message count for assistant message
              await incrementMessageCount(sessionId);

              // Log token usage for dashboard
              recordTokenUsage({
                category: 'workspace',
                model: effectiveWorkspaceModel || 'unknown',
                totalTokens: toolResult.totalTokens,
              });
            } catch (saveError) {
              console.error('Workspace chat message save error:', saveError);
            }
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

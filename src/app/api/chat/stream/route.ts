/**
 * Streaming Chat API
 *
 * SSE-based streaming endpoint for real-time chat responses.
 * Provides progressive disclosure of processing phases:
 * 1. RAG retrieval with skill/tool info
 * 2. Tool execution with status updates
 * 3. Final LLM response streaming
 */

import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail, linkOutputsToMessage, getEffectiveModelForThread } from '@/lib/db/compat';
import { getThread, addMessage, getMessages, getUploadDetails, getThreadCategorySlugsForQuery } from '@/lib/threads';
import { readFileBuffer } from '@/lib/storage';
import { getMemoryContext, processConversationForMemory } from '@/lib/memory';
import { countTokens, updateThreadTokenCount, shouldSummarize, summarizeThread, getThreadSummary, formatSummaryForContext } from '@/lib/summarization';
import { getMemorySettings, getSummarizationSettings } from '@/lib/db/compat';
import { runWithContextAsync } from '@/lib/request-context';
import { generateResponseWithTools } from '@/lib/openai';
import { recordTokenUsage } from '@/lib/token-logger';
import {
  createSSEEncoder,
  getSSEHeaders,
  getPhaseMessage,
  performRAGRetrieval,
  getStreamingConfigMs,
} from '@/lib/streaming';
import { translate } from '@/lib/translation';
import { TONE_PRESETS } from '@/types/stream';
import type { Message, StreamEvent, StreamChatRequest, Source, MessageVisualization, GeneratedDocumentInfo, GeneratedImageInfo, ImageContent, PodcastHint, DiagramHint } from '@/types';
import { complianceCheckerTool, type ComplianceCheckerResult } from '@/lib/tools/compliance-checker';
import { isToolEnabled } from '@/lib/tools';
import { getImageCapabilities } from '@/lib/config-capability-checker';
import { getLlmSettings } from '@/lib/db/compat';
import {
  buildModelsToTry,
  withModelFallback,
  LlmFallbackError,
  type ModelSwitchEvent,
} from '@/lib/llm-fallback';
import { getAutonomousModeEnabled } from '@/lib/db/compat/agent-config';
import { executeAutonomousWithStreaming } from '@/lib/agent/streaming-executor';

// Route segment config for long-running autonomous tasks
// 1800s (30 min) matches Traefik proxy timeout for autonomous mode.
// The admin UI "Streaming Configuration" controls the inner app-level timeout (default 300s).
export const maxDuration = 1800;

export async function POST(request: NextRequest) {
  const encoder = createSSEEncoder();
  let keepAliveInterval: NodeJS.Timeout | null = null;

  // Get streaming config from database (with fallback defaults)
  const streamingConfig = await getStreamingConfigMs();

  const stream = new ReadableStream({
    async start(controller) {
      let controllerClosed = false;
      const safeClose = () => {
        if (!controllerClosed) {
          controllerClosed = true;
          try { controller.close(); } catch { /* already closed */ }
        }
      };

      // Helper to send SSE events
      const send = (event: StreamEvent) => {
        if (controllerClosed) return;
        try {
          controller.enqueue(encoder.encode(event));
        } catch {
          // Controller closed, ignore
        }
      };

      // Setup keep-alive ping (interval from admin config)
      keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.keepAlive());
        } catch {
          // Controller closed
        }
      }, streamingConfig.KEEPALIVE_INTERVAL_MS);

      // Handle client abort
      const cleanup = () => {
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }
      };

      request.signal.addEventListener('abort', cleanup);

      try {
        // ============ Phase 1: Authentication & Validation ============
        const user = await getCurrentUser();
        if (!user) {
          send({ type: 'error', code: 'AUTH_ERROR', message: 'Unauthorized', recoverable: false });
          cleanup();
          safeClose();
          return;
        }

        const body = await request.json() as StreamChatRequest;
        const {
          message,
          threadId,
          mode = 'normal',
          webSearchEnabled = true,
          targetLanguage = 'en',
          responseTone = 'default',
        } = body;

        if (!message || !threadId) {
          send({ type: 'error', code: 'VALIDATION_ERROR', message: 'Missing required fields', recoverable: false });
          cleanup();
          safeClose();
          return;
        }

        // Validate mode
        if (mode !== 'normal' && mode !== 'autonomous') {
          send({ type: 'error', code: 'VALIDATION_ERROR', message: 'Invalid mode', recoverable: false });
          cleanup();
          safeClose();
          return;
        }

        // Verify thread ownership
        const thread = await getThread(user.id, threadId);
        if (!thread) {
          send({ type: 'error', code: 'VALIDATION_ERROR', message: 'Thread not found', recoverable: false });
          cleanup();
          safeClose();
          return;
        }

        // Resolve effective model for this thread (thread override or global default)
        const effectiveModel = await getEffectiveModelForThread(threadId);
        const requestStart = Date.now();

        send({ type: 'status', phase: 'init', content: getPhaseMessage('init') });

        // ============ Setup ============
        const dbUser = await getUserByEmail(user.email);
        const memorySettings = await getMemorySettings();
        const summarizationSettings = await getSummarizationSettings();

        // Create and save user message
        const userMessageId = uuidv4();
        const userMessage: Message = {
          id: userMessageId,
          role: 'user',
          content: message,
          timestamp: new Date(),
        };
        await addMessage(user.id, threadId, userMessage);
        await updateThreadTokenCount(threadId, countTokens(message));

        // ============ AUTONOMOUS MODE BRANCH ============
        if (mode === 'autonomous') {
          // Server-side check: admin may have disabled autonomous mode
          const autonomousEnabled = await getAutonomousModeEnabled();
          if (!autonomousEnabled) {
            send({ type: 'error', code: 'FEATURE_DISABLED', message: 'Autonomous mode has been disabled by admin', recoverable: false });
            cleanup();
            safeClose();
            return;
          }

          // Get conversation history and category context
          const conversationHistory = await getMessages(user.id, threadId, 50);
          const categorySlugs = await getThreadCategorySlugsForQuery(threadId);
          const categoryIds = thread.categories?.map(c => c.id) || [];

          // Get memory and summary context
          let memoryContext = '';
          if (memorySettings.enabled && dbUser) {
            memoryContext = await getMemoryContext(dbUser.id, categoryIds);
          }

          let summaryContext = '';
          const existingSummary = await getThreadSummary(threadId);
          if (existingSummary) {
            summaryContext = formatSummaryForContext(existingSummary.summary);
          }

          // Prepare RAG context (simplified - no document extraction in autonomous mode for now)
          const ragContext = memoryContext || summaryContext ? `${memoryContext}\n\n${summaryContext}`.trim() : '';

          const assistantMessageId = uuidv4();

          await runWithContextAsync(
            {
              threadId,
              messageId: assistantMessageId,
              categoryIds: categoryIds,
              userId: user.id,
              userMessage: message,
            },
            async () => {
              try {
                // Execute autonomous plan with streaming
                const result = await executeAutonomousWithStreaming(
                  message,
                  {
                    ragContext,
                    // Only include user messages to prevent task type leakage from previous assistant responses
                    conversationHistory: conversationHistory
                      .slice(-10)
                      .filter(m => m.role === 'user')
                      .map(m => m.content)
                      .join('\n\n'),
                    categoryContext: categorySlugs.join(', '),
                  },
                  {
                    threadId,
                    userId: user.id,
                    categorySlug: categorySlugs[0],
                  },
                  send
                );

                // Save assistant message with summary AND artifacts
                const assistantMessage: Message = {
                  id: assistantMessageId,
                  role: 'assistant',
                  content: result.accumulatedContent || result.summary,
                  generatedDocuments: result.generatedDocuments.length > 0 ? result.generatedDocuments : undefined,
                  generatedImages: result.generatedImages.length > 0 ? result.generatedImages : undefined,
                  timestamp: new Date(),
                };

                await addMessage(user.id, threadId, assistantMessage);
                await updateThreadTokenCount(threadId, countTokens(result.summary));

                // Link generated outputs to message
                if (result.generatedDocuments.length > 0 || result.generatedImages.length > 0) {
                  try {
                    await linkOutputsToMessage(threadId, assistantMessageId);
                  } catch (linkError) {
                    console.error('[Stream] Failed to link autonomous outputs to message:', linkError);
                  }
                }

                // Background tasks (non-blocking)
                if (summarizationSettings.enabled && await shouldSummarize(threadId)) {
                  summarizeThread(threadId).catch(() => {});
                }

                if (memorySettings.enabled && memorySettings.autoExtractOnThreadEnd && dbUser) {
                  const recentMessages = conversationHistory.slice(-10).map(m => ({
                    role: m.role,
                    content: m.content,
                  }));
                  processConversationForMemory(dbUser.id, categoryIds[0] || null, recentMessages).catch(() => {});
                }

                // Send completion
                send({ type: 'done', messageId: assistantMessageId, threadId });
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Autonomous execution failed';
                send({ type: 'error', code: 'UNKNOWN_ERROR', message: errorMsg, recoverable: false });
              }
            }
          );

          // Autonomous mode complete - cleanup and return
          cleanup();
          safeClose();
          return;
        }

        // Get conversation history
        const conversationHistory = await getMessages(user.id, threadId, 50);
        const categorySlugs = await getThreadCategorySlugsForQuery(threadId);
        const categoryIds = thread.categories?.map(c => c.id) || [];

        // Get memory and summary context
        let memoryContext = '';
        if (memorySettings.enabled && dbUser) {
          memoryContext = await getMemoryContext(dbUser.id, categoryIds);
        }

        let summaryContext = '';
        const existingSummary = await getThreadSummary(threadId);
        if (existingSummary) {
          summaryContext = formatSummaryForContext(existingSummary.summary);
        }

        if (memoryContext) {
          send({ type: 'operation_log', category: 'memory', message: 'Loading user memory' });
        }
        if (summaryContext) {
          send({ type: 'operation_log', category: 'memory', message: 'Loading conversation summary' });
        }

        // Get user uploads - separate images from documents
        const uploadDetails = await getUploadDetails(user.id, threadId);

        // Check image processing capabilities for the actual model being used
        const llmSettings = await getLlmSettings();
        const imageCapabilities = await getImageCapabilities(effectiveModel || llmSettings.model);

        // Document paths for RAG text extraction (PDFs, DOCX, etc.)
        // Also include images for OCR text extraction as additional context
        const allDocPaths = [
          ...uploadDetails.documents.map(d => d.filepath),
          ...uploadDetails.images.map(i => i.filepath), // Images also get OCR text extraction
        ];

        // Load images as base64 for multimodal visual content (only if vision is supported)
        const imageContents: ImageContent[] = [];

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

        // Create assistant message ID for context
        const assistantMessageId = uuidv4();

        // ============ Run with request context ============
        await runWithContextAsync(
          {
            threadId,
            messageId: assistantMessageId,
            categoryIds: categoryIds,
            userId: user.id,
            userMessage: message,
          },
          async () => {
            // ============ Phase 2: RAG Retrieval ============
            send({ type: 'status', phase: 'rag', content: getPhaseMessage('rag') });

            const ragStart = Date.now();
            const ragResult = await performRAGRetrieval(
              message,
              categorySlugs,
              allDocPaths,
              memoryContext,
              summaryContext,
              send,
              conversationHistory  // Pass for follow-up context boosting
            );
            const ragMs = Date.now() - ragStart;

            // Send sources from RAG
            send({ type: 'sources', data: ragResult.sources });

            // ============ Phase 2.5: Resolve Preflight Clarification Config ============
            // The actual clarification is now handled by the main LLM via the
            // request_clarification tool (Option B). We only resolve config here to
            // get the timeout and determine whether to inject the tool.
            let enableClarification = false;
            let clarificationTimeoutMs = 120000; // 2-minute default
            let clarificationSkillName: string | undefined;
            {
              const { getComplianceConfig } = await import('@/lib/tools/compliance-checker');
              const complianceConfig = await getComplianceConfig();

              if (complianceConfig.preflightEnabled) {
                const { hasPreflightEnabled, findPreflightSkill, resolvePreflightConfig } = await import('@/lib/compliance/preflight');
                if (hasPreflightEnabled(complianceConfig, ragResult.matchedSkills)) {
                  const preflightSkill = findPreflightSkill(ragResult.matchedSkills);
                  if (preflightSkill) {
                    const resolvedPf = resolvePreflightConfig(complianceConfig, preflightSkill.config);
                    enableClarification = true;
                    clarificationTimeoutMs = resolvedPf.timeoutMs;
                    clarificationSkillName = preflightSkill.name;
                  }
                }
              }
            }

            // ============ Build Model Fallback Chain ============
            // Determine models to try based on capabilities and health status
            const hasImages = imageContents.length > 0;
            const { models: modelsToTry, capabilitySwitch } = await buildModelsToTry(
              effectiveModel,
              hasImages,  // requiresVision
              true        // requiresTools (generally enabled)
            );

            // Notify if capability-based switch occurred (e.g., non-vision model with images)
            if (capabilitySwitch) {
              send({
                type: 'model_switch',
                originalModel: capabilitySwitch.originalModel,
                newModel: capabilitySwitch.newModel,
                reason: capabilitySwitch.reason,
                message: `Switched to ${capabilitySwitch.newModel} (${capabilitySwitch.reason.replace('_', ' ')})`,
              });
            }

            // Handle edge case: no models available
            if (modelsToTry.length === 0) {
              send({
                type: 'error',
                code: 'NO_MODELS_AVAILABLE',
                message: 'No LLM models available. Please contact your administrator to configure a fallback model.',
                recoverable: false,
              });
              return;
            }

            // ============ Phase 3: Tool Execution ============
            send({ type: 'status', phase: 'tools', content: getPhaseMessage('tools') });

            // Track collected artifacts
            const visualizations: MessageVisualization[] = [];
            const documents: GeneratedDocumentInfo[] = [];
            const images: GeneratedImageInfo[] = [];
            const diagrams: DiagramHint[] = [];
            const podcasts: PodcastHint[] = [];
            const webSources: Source[] = [];

            // Prepare system prompt with tone injection if needed
            let effectiveSystemPrompt = ragResult.systemPrompt;
            if (responseTone && responseTone !== 'default' && TONE_PRESETS[responseTone]) {
              const tonePrompt = TONE_PRESETS[responseTone].prompt;
              effectiveSystemPrompt = `${tonePrompt}\n\n${ragResult.systemPrompt}`;
            }

            // Append clarification instruction when preflight skill is active
            if (enableClarification) {
              effectiveSystemPrompt += '\n\nIf the user\'s request is genuinely ambiguous after reviewing all documents and conversation history, call request_clarification with 2-4 specific options. Do not ask about topics already covered in the documents or prior conversation.';
            }

            // Determine which tools to exclude based on user preferences
            const excludeTools: string[] = [];
            if (!webSearchEnabled) {
              excludeTools.push('web_search');
            }

            // Execute tools with streaming callbacks and automatic fallback
            // Pass images for multimodal visual analysis (in addition to OCR text in context)
            // Uses conversation context manager for smart history (anchors + recent),
            // follow-up detection, and context-aware cache keys
            const llmStart = Date.now();

            // Define streaming callbacks
            const callbacks = {
              // For English responses: forward content tokens directly to the client as they
              // are generated (true streaming). For non-English: omit so tokens accumulate
              // internally and can be translated before delivery.
              onChunk: (targetLanguage && targetLanguage !== 'en')
                ? undefined
                : (text: string) => send({ type: 'chunk', content: text }),
              onThinkingChunk: (text: string) => send({ type: 'thinking_chunk', content: text }),
              onToolStart: (name: string, displayName: string) => {
                send({ type: 'tool_start', name, displayName });
              },
              onToolEnd: (name: string, success: boolean, duration: number, error?: string) => {
                send({ type: 'tool_end', name, success, duration, error });
              },
              onArtifact: (type: 'visualization' | 'document' | 'image' | 'diagram' | 'podcast', data: MessageVisualization | GeneratedDocumentInfo | GeneratedImageInfo | DiagramHint | PodcastHint) => {
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
                } else if (type === 'diagram') {
                  const diagram = data as DiagramHint;
                  diagrams.push(diagram);
                  send({ type: 'artifact', subtype: 'diagram', data: diagram });
                } else if (type === 'podcast') {
                  const podcast = data as PodcastHint;
                  podcasts.push(podcast);
                  send({ type: 'artifact', subtype: 'podcast', data: podcast });
                }
              },
              // Called when main LLM invokes request_clarification tool
              onClarification: async (question: string, options: string[], allowFreeText: boolean): Promise<string | null> => {
                const { createPreflightResolver } = await import('@/lib/streaming/preflight-resolver');

                const event = {
                  type: 'hitl_preflight' as const,
                  messageId: assistantMessageId,
                  questions: [{
                    id: 'q1',
                    context: '',
                    question,
                    options: options.map((label) => ({
                      id: label, // use label as ID so enrichedContext contains readable text
                      label,
                      action: 'retry_with' as const,
                    })),
                    allowFreeText,
                  }],
                  fallbackActions: [
                    { action: 'continue' as const, label: 'Continue without clarification' },
                    { action: 'cancel' as const, label: 'Cancel' },
                  ],
                  timeoutMs: clarificationTimeoutMs,
                  skillName: clarificationSkillName,
                };

                send({ type: 'status', phase: 'clarifying_question', content: 'Waiting for your input...' });
                send({ type: 'hitl_preflight', data: event });

                const result = await createPreflightResolver(assistantMessageId, clarificationTimeoutMs, request.signal);

                if (!result?.enrichedContext) return null;
                return result.enrichedContext;
              },
            };

            // Track which model was actually used
            let usedModel: string = modelsToTry[0];
            let toolResult: Awaited<ReturnType<typeof generateResponseWithTools>>;

            try {
              const fallbackResult = await withModelFallback({
                modelsToTry,
                execute: (model) => generateResponseWithTools(
                  effectiveSystemPrompt,
                  conversationHistory.slice(0, -1), // Full history, context manager optimizes
                  ragResult.context,
                  message,
                  true, // Enable tools
                  ragResult.categoryIds,
                  callbacks,
                  imageContents.length > 0 ? imageContents : undefined,
                  summaryContext, // Summary context for dynamic positioning
                  memoryContext, // Memory context for cache key
                  categorySlugs, // Category slugs for cache key
                  excludeTools,
                  imageCapabilities, // Image processing strategy
                  model, // Model to use (may change on fallback)
                  enableClarification // Inject request_clarification tool when preflight skill active
                ),
                onSwitch: (event: ModelSwitchEvent) => {
                  // Signal client to discard any partial streamed content from the failed model
                  send({ type: 'stream_reset' });
                  send({
                    type: 'model_switch',
                    originalModel: event.originalModel,
                    newModel: event.newModel,
                    reason: event.reason,
                    message: `${event.originalModel} unavailable, switching to ${event.newModel}`,
                  });
                },
                context: { threadId, userId: user.id },
              });

              toolResult = fallbackResult.result;
              usedModel = fallbackResult.usedModel;
            } catch (error) {
              if (error instanceof LlmFallbackError) {
                send({
                  type: 'error',
                  code: error.code as 'NO_MODELS_AVAILABLE' | 'ALL_MODELS_FAILED',
                  message: error.message,
                  recoverable: error.recoverable,
                });
                return;
              }
              throw error; // Re-throw non-fallback errors
            }

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
            // For English: content tokens were already streamed token-by-token via onChunk
            // during generateResponseWithTools above — no further action needed.
            // For non-English: translate the accumulated content, then chunk it to the client.

            let fullContent = toolResult.content;

            if (targetLanguage && targetLanguage !== 'en') {
              send({ type: 'status', phase: 'generating', content: getPhaseMessage('generating') });
              try {
                const translationResult = await translate({
                  text: fullContent,
                  targetLanguage,
                  context: 'policy document assistant response',
                  formalStyle: true,
                });
                if (translationResult.success) {
                  fullContent = translationResult.translated;
                } else {
                  console.warn('[Stream] Translation failed:', translationResult.error);
                }
              } catch (translationError) {
                console.warn('[Stream] Translation failed, using original response:', translationError);
              }
              // Stream translated content in chunks (true LLM streaming not possible post-translation)
              const chunkSize = 20;
              for (let i = 0; i < fullContent.length; i += chunkSize) {
                send({ type: 'chunk', content: fullContent.slice(i, i + chunkSize) });
                await new Promise(resolve => setTimeout(resolve, 10));
              }
            }

            // ============ Phase 5: Compliance Checking ============
            // Run compliance check if:
            // 1. Compliance checker tool is globally enabled
            // 2. At least one matched skill has compliance explicitly enabled (opt-in model)
            const skillsWithComplianceEnabled = ragResult.matchedSkills.filter(
              s => s.complianceConfig?.enabled === true
            );

            if ((await isToolEnabled('compliance_checker')) && skillsWithComplianceEnabled.length > 0) {
              try {
                const complianceResultStr = await complianceCheckerTool.execute({
                  userMessage: message,
                  response: fullContent,
                  toolExecutions: toolResult.toolExecutionResults,
                  matchedSkills: skillsWithComplianceEnabled, // Only pass skills with compliance enabled
                  toolRoutingMatches: ragResult.toolRoutingMatches,
                  messageId: assistantMessageId,
                  conversationId: threadId,
                });

                const complianceResult: ComplianceCheckerResult = JSON.parse(complianceResultStr);

                if (complianceResult.success) {
                  // Send compliance decision event
                  send({ type: 'compliance', data: complianceResult.decision });

                  // If HITL was triggered, send clarification event
                  if (complianceResult.hitlEvent) {
                    send({ type: 'hitl_clarification', data: complianceResult.hitlEvent });
                  }
                }
              } catch (complianceError) {
                // Log but don't fail the request for compliance check errors
                console.error('[Stream] Compliance check error:', complianceError);
              }
            }

            // ============ Save & Cleanup ============
            const completionTokens = toolResult.totalTokens || countTokens(fullContent);
            const assistantMessage: Message = {
              id: assistantMessageId,
              role: 'assistant',
              content: fullContent,
              sources: allSources,
              generatedDocuments: documents.length > 0 ? documents : undefined,
              generatedImages: images.length > 0 ? images : undefined,
              generatedDiagrams: diagrams.length > 0 ? diagrams : undefined,
              generatedPodcasts: podcasts.length > 0 ? podcasts : undefined,
              visualizations: visualizations.length > 0 ? visualizations : undefined,
              timestamp: new Date(),
              metadata: {
                model: usedModel,
                totalMs: Date.now() - requestStart,
                llmMs,
                ragMs,
                completionTokens,
                tokensEstimated: !toolResult.totalTokens,
              },
            };

            await addMessage(user.id, threadId, assistantMessage);
            await updateThreadTokenCount(threadId, countTokens(fullContent));

            // Link any generated outputs (documents, images, diagrams, podcasts) to this message
            // This must happen after addMessage since message_id is a foreign key
            if (documents.length > 0 || images.length > 0 || diagrams.length > 0 || podcasts.length > 0) {
              try {
                await linkOutputsToMessage(threadId, assistantMessageId);
              } catch (linkError) {
                // Log but don't fail - message is saved, just outputs not linked
                console.error('[Stream] Failed to link outputs to message:', linkError);
              }
            }

            // Background tasks (non-blocking)
            if (summarizationSettings.enabled && await shouldSummarize(threadId)) {
              summarizeThread(threadId).catch(() => {});
            }

            if (memorySettings.enabled && memorySettings.autoExtractOnThreadEnd && dbUser) {
              const recentMessages = conversationHistory.slice(-10).map(m => ({
                role: m.role,
                content: m.content,
              }));
              processConversationForMemory(dbUser.id, categoryIds[0] || null, recentMessages).catch(() => {});
            }

            // Log token usage for dashboard
            recordTokenUsage({
              userId: dbUser?.id,
              category: 'chat',
              model: usedModel,
              totalTokens: toolResult.totalTokens,
            });

            // Send completion with metadata
            send({
              type: 'done',
              messageId: assistantMessageId,
              threadId,
              model: usedModel,
              totalMs: Date.now() - requestStart,
              llmMs,
              ragMs,
              completionTokens,
              tokensEstimated: !toolResult.totalTokens,
            });
          }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        send({ type: 'error', code: 'UNKNOWN_ERROR', message, recoverable: false });
      } finally {
        cleanup();
        safeClose();
      }
    },
  });

  return new Response(stream, { headers: getSSEHeaders() });
}

/**
 * RAG Retrieval for Streaming
 *
 * Extracts the RAG retrieval phase for use in the streaming API.
 * Provides context, sources, and skill information for progressive disclosure.
 */

import type { Source, StreamEvent, SkillInfo, UploadExtractionState, Message } from '@/types';
import type { RetrievedChunk } from '@/types';
import { createEmbeddings } from '../openai';
import { buildContext, expandQueries, deduplicateChunks } from '../rag';
import { rerankChunks } from '../reranker';
import { getRagSettings, getAcronymMappings } from '../db/compat/config';
import { getResolvedSystemPrompt } from '../db/compat/category-prompts';
import { getCategoryIdsBySlugs } from '../db/compat/categories';
import { getDocumentsByCategory, getGlobalDocuments } from '../db/compat';
import { detectReferencedDocument, retrieveFullKbDocumentChunks } from '../document-detection';
import { resolveSkills } from '../skills/resolver';
import { getAvailableDataSourcesDescription } from '../tools/data-source';
import { getToolDefinitions } from '../tools';
import { ragLogger as logger } from '../logger';
import {
  MAX_QUERY_EXPANSIONS,
  CHUNK_PREVIEW_LENGTH,
  USER_UPLOAD_MIN_RERANK_SCORE,
  MAX_USER_DOC_CHUNKS_FOR_SUMMARY,
  MAX_USER_CHUNKS_RETURNED_FOR_SUMMARY,
} from '../constants';
import { detectFollowUp } from '../conversation-context';
/**
 * Matched skill info for compliance checking
 */
export interface MatchedSkillForCompliance {
  id: number;
  name: string;
  complianceConfig?: {
    enabled: boolean;
    sections?: string[];
    passThreshold?: number;
    warnThreshold?: number;
    clarificationInstructions?: string;
    hitlModel?: string;
    preflightClarification?: {
      enabled: boolean;
      instructions?: string;
      maxQuestions?: number;
      timeoutMs?: number;
      skipOnFollowUp?: boolean;
    };
  };
}

/**
 * Tool routing match info for compliance checking
 */
export interface ToolRoutingMatch {
  toolName: string;
  forceMode: string;
}

/**
 * A single chunk's trajectory data (pre-rerank and post-rerank)
 */
export interface ChunkTrajectoryData {
  chunkId: string;
  documentName: string;
  pageNumber: number;
  rawScore: number;
  rerankedScore: number | null;
  wasSelected: boolean;
  rankBefore: number;
  rankAfter: number | null;
  sourceType: 'vector' | 'user_upload';
}

/**
 * Result of RAG retrieval phase
 */
export interface RAGRetrievalResult {
  /** Formatted context string for LLM */
  context: string;
  /** Assembled system prompt with skills, data sources, memory */
  systemPrompt: string;
  /** Extracted sources for citation */
  sources: Source[];
  /** Resolved category IDs */
  categoryIds: number[];
  /** Activated skills for progressive disclosure */
  activatedSkills: SkillInfo[];
  /** Available tool names */
  availableTools: string[];
  /** Matched skills with compliance configs (for compliance checking) */
  matchedSkills: MatchedSkillForCompliance[];
  /** Tool routing matches (for compliance checking) */
  toolRoutingMatches: ToolRoutingMatch[];
  /** Citation trajectory data (pre-rerank and post-rerank scores) */
  trajectoryData?: ChunkTrajectoryData[];
}

/**
 * Determine whether the user's message is directed at an uploaded document.
 *
 * DESIGN DECISION (Fix #3): When a file is attached, ALWAYS treat the query as
 * upload-directed. The previous keyword-regex approach silently failed when the
 * user's phrasing didn't match English trigger words (e.g. "summarise this",
 * "tldr", "key points", or any non-English prompt), causing:
 *   1. The full-document context path to be skipped (model never sees the file)
 *   2. The rerank score floor to stay at 0.30 (all chunks dropped for generic
 *      queries that don't topically match document passages)
 *
 * If the user attached a file, they want the model to use it. The keyword
 * patterns are retained only as a secondary signal for messages that reference
 * a document without uploads being present (shouldn't normally happen, but
 * preserves backward compatibility).
 */
function isUploadDirectedQuery(userMessage: string, hasUploads: boolean): boolean {
  // A file is attached — always treat as upload-directed.
  if (hasUploads) return true;

  const message = userMessage.toLowerCase();
  const mentionsUpload = /\b(attached|attachment|uploaded|upload|provided|selected)\b/.test(message);
  const mentionsDocument = /\b(pdf|file|document|doc|upload|attachment)\b/.test(message);
  const asksForDocumentWork = /\b(summarise|summarize|summary|review|analyse|analyze|explain|read|extract|outline|describe)\b/.test(message);

  if (mentionsUpload && mentionsDocument) return true;
  if (asksForDocumentWork && mentionsDocument) return true;
  if (asksForDocumentWork && /\b(this|that|it)\b/.test(message)) return true;

  return false;
}

function formatUploadErrors(errors: Array<{ filename: string; message: string }>): string {
  if (errors.length === 0) return '';

  let context = '=== USER UPLOADED DOCUMENT EXTRACTION STATUS ===\n\n';
  for (const error of errors) {
    context += `[Source: ${error.filename}]\n`;
    context += `${error.message}\n\n---\n\n`;
  }
  return context;
}

function formatContext(
  globalChunks: RetrievedChunk[],
  userChunks: RetrievedChunk[],
  options: {
    prioritizeUploads?: boolean;
    uploadErrors?: Array<{ filename: string; message: string }>;
  } = {}
): string {
  let context = '';

  const addUserChunks = () => {
    if (userChunks.length === 0) return;
    context += '=== USER UPLOADED DOCUMENT ===\n\n';
    for (const chunk of userChunks) {
      context += `[Source: ${chunk.documentName}, Page ${chunk.pageNumber}]\n`;
      context += `${chunk.text}\n\n---\n\n`;
    }
  };

  const addGlobalChunks = () => {
    if (globalChunks.length === 0) return;
    context += '=== KNOWLEDGE BASE DOCUMENTS ===\n\n';
    for (const chunk of globalChunks) {
      context += `[Source: ${chunk.documentName}, Page ${chunk.pageNumber}]\n`;
      context += `${chunk.text}\n\n---\n\n`;
    }
  };

  if (options.prioritizeUploads) {
    addUserChunks();
    context += formatUploadErrors(options.uploadErrors || []);
    addGlobalChunks();
  } else {
    addGlobalChunks();
    addUserChunks();
    context += formatUploadErrors(options.uploadErrors || []);
  }

  if (!context) {
    context = 'No relevant documents found in the knowledge base.';
  }

  return context;
}

/**
 * Extract source metadata from chunks, deduped by documentName.
 * Multiple chunks from the same document collapse into one source entry;
 * we keep the highest-scoring chunk's page + snippet. Returned sorted by score desc.
 */
function extractSources(globalChunks: RetrievedChunk[], userChunks: RetrievedChunk[]): Source[] {
  const byDocument = new Map<string, Source>();
  for (const chunk of [...globalChunks, ...userChunks]) {
    const candidate: Source = {
      documentName: chunk.documentName,
      pageNumber: chunk.pageNumber,
      chunkText: chunk.text.substring(0, CHUNK_PREVIEW_LENGTH) + (chunk.text.length > CHUNK_PREVIEW_LENGTH ? '...' : ''),
      score: chunk.score,
    };
    const existing = byDocument.get(chunk.documentName);
    if (!existing || candidate.score > existing.score) {
      byDocument.set(chunk.documentName, candidate);
    }
  }
  return Array.from(byDocument.values()).sort((a, b) => b.score - a.score);
}

/**
 * Perform RAG retrieval phase
 *
 * Retrieves relevant documents, resolves skills, and builds context.
 * Does NOT execute tools or generate LLM response - that's handled separately.
 *
 * @param userMessage - User's question
 * @param categorySlugs - Category slugs for the thread
 * @param userDocPaths - Paths to user-uploaded documents
 * @param memoryContext - Optional user memory context
 * @param summaryContext - Optional thread summary context
 * @param send - Optional SSE send function for streaming events
 * @param conversationHistory - Optional conversation history for follow-up context boosting
 */
export async function performRAGRetrieval(
  userMessage: string,
  categorySlugs: string[] = [],
  userDocPaths: string[] = [],
  memoryContext?: string,
  summaryContext?: string,
  send?: (event: StreamEvent) => void,
  conversationHistory: Message[] = []
): Promise<RAGRetrievalResult> {
  // Fetch RAG settings and category IDs in parallel
  const [ragSettings, categoryIds] = await Promise.all([
    getRagSettings(),
    categorySlugs.length > 0 ? getCategoryIdsBySlugs(categorySlugs) : Promise.resolve([]),
  ]);
  const { queryExpansionEnabled, llmQueryRewritingEnabled, cragFallbackEnabled } = ragSettings;
  const uploadDirected = isUploadDirectedQuery(userMessage, userDocPaths.length > 0);

  logger.debug('Starting RAG retrieval', { categorySlugs, userDocPaths: userDocPaths.length, uploadDirected });

  // Expand query and create the primary embedding in parallel.
  // The original query is embedded immediately so retrieval can start while
  // LLM-based rewriting (when enabled) is still running.
  const [expandedQueries, primaryEmbeddingArray] = await Promise.all([
    expandQueries(userMessage, queryExpansionEnabled, llmQueryRewritingEnabled),
    createEmbeddings([userMessage]),
  ]);
  const primaryEmbedding = primaryEmbeddingArray[0];

  // Embed any additional expanded queries, avoiding a duplicate embedding of
  // the original query since expandQueries always includes it as the first element.
  const additionalQueries = expandedQueries.filter(q => q !== userMessage);
  const additionalEmbeddings = additionalQueries.length > 0
    ? await createEmbeddings(additionalQueries)
    : [];

  // Build context from documents
  send?.({ type: 'operation_log', category: 'rag', message: 'Searching vector database' });
  if (uploadDirected && userDocPaths.length > 0) {
    send?.({ type: 'operation_log', category: 'rag', message: 'Reading uploaded document(s) for full context' });
  }
  const { globalChunks, userChunks, userDocTruncations, userDocErrors, fullDocContexts } = await buildContext(
    primaryEmbedding,
    userDocPaths,
    additionalEmbeddings,
    ragSettings,
    categorySlugs.length > 0 ? categorySlugs : undefined,
    uploadDirected ? {
      userDocMaxChunks: MAX_USER_DOC_CHUNKS_FOR_SUMMARY,
      userDocReturnChunks: MAX_USER_CHUNKS_RETURNED_FOR_SUMMARY,
      sampleUserDocChunks: true,
      uploadDirected,
      userMessage,
    } : undefined,
    userMessage
  );

  // ============ KB Document Detection & Full-Document Retrieval ============
  // When a user references a specific KB document by name (e.g. "summarise the
  // Q3_Report.pdf"), the standard similarity search + reranker may drop all
  // chunks because "summarise this" doesn't topically match any paragraph.
  // We detect the document reference, fetch ALL its chunks directly from Qdrant,
  // and merge them into the global chunks so the model sees the full document.
  let kbDocTargetedName: string | null = null;
  let kbDocChunks: RetrievedChunk[] = [];

  // Only attempt detection when there are no user uploads (user uploads are
  // already handled by the upload-directed path above) and we have categories
  // or global docs to search.
  if (userDocPaths.length === 0) {
    try {
      // Fetch documents for the thread's categories + global documents in parallel
      const categoryDocPromises = categoryIds.map(id => getDocumentsByCategory(id));
      const [categoryDocSets, globalDocs] = await Promise.all([
        Promise.all(categoryDocPromises),
        getGlobalDocuments(),
      ]);

      // Combine all documents (deduplicate by id), filter to 'ready' status
      const allKbDocs = [...globalDocs, ...categoryDocSets.flat()]
        .filter(doc => doc.status === 'ready');
      const seenDocIds = new Set<number>();
      const uniqueKbDocs = allKbDocs.filter(doc => {
        if (seenDocIds.has(doc.id)) return false;
        seenDocIds.add(doc.id);
        return true;
      });

      const detected = detectReferencedDocument(userMessage, uniqueKbDocs);
      if (detected) {
        kbDocTargetedName = detected.document.filename;
        send?.({ type: 'operation_log', category: 'rag', message: `Retrieving full document: ${detected.document.filename}` });
        kbDocChunks = await retrieveFullKbDocumentChunks(detected.document, categorySlugs);
        logger.debug('KB document targeted by user', {
          filename: detected.document.filename,
          matchStrategy: detected.matchStrategy,
          chunkCount: kbDocChunks.length,
        });
      }
    } catch (err) {
      logger.warn('KB document detection failed', { error: String(err) });
    }
  }

  // Merge KB document chunks into the global chunks pool
  let mergedGlobalChunks = globalChunks;
  if (kbDocChunks.length > 0) {
    mergedGlobalChunks = deduplicateChunks([...globalChunks, ...kbDocChunks]);
    logger.debug('Merged KB document chunks into global pool', {
      originalCount: globalChunks.length,
      kbDocChunkCount: kbDocChunks.length,
      mergedCount: mergedGlobalChunks.length,
    });
  }
  // ============ END KB Document Detection ============

  // Detect follow-up and extract previous sources for boosting
  const { isFollowUp } = detectFollowUp(userMessage);
  let boostDocuments: string[] = [];

  if (isFollowUp && conversationHistory.length > 0) {
    // Get the last assistant message with sources
    const lastAssistantMsg = [...conversationHistory]
      .reverse()
      .find(m => m.role === 'assistant' && m.sources?.length);

    if (lastAssistantMsg?.sources) {
      boostDocuments = lastAssistantMsg.sources.map(s => s.documentName);
      logger.debug('Follow-up detected, boosting documents', { boostDocuments });
      send?.({ type: 'operation_log', category: 'rag', message: 'Boosting results from prior conversation' });
    }
  }

  // Apply reranking with boost for follow-up context
  send?.({ type: 'operation_log', category: 'rag', message: 'Reranking search results' });
  if (userChunks.length > 0) {
    send?.({
      type: 'operation_log',
      category: 'rag',
      message: uploadDirected ? 'Reviewing uploaded document content' : 'Ranking user documents',
    });
  }

  // Rerank global and user chunks concurrently.
  // When a KB document was targeted by name, lower the global rerank floor to 0
  // and enable the KB-document safety net so the referenced document's chunks
  // are never silently dropped by the reranker threshold.
  // cragFallbackOut is populated by rerankChunks when the CRAG graded-fallback
  // tier fires (opt-in via RAG settings), so we can surface the signal.
  const globalCragOut = { fired: false };
  const [rerankedGlobalChunks, rerankedUserChunks] = await Promise.all([
    rerankChunks(userMessage, mergedGlobalChunks, {
      boostDocuments,
      cragFallbackEnabled,
      cragFallbackOut: globalCragOut,
      ...(kbDocTargetedName
        ? { minScoreOverride: 0, isKbDocumentTargeted: true }
        : {}),
    }),
    rerankChunks(userMessage, userChunks, {
      minScoreOverride: uploadDirected ? 0 : USER_UPLOAD_MIN_RERANK_SCORE,
      boostDocuments,
      isUserUpload: true,
    }),
  ]);

  // CRAG graded fallback fired: the reranker threshold zeroed the pool, so
  // top-N low-confidence originals were kept instead. Tell the user the KB
  // results are best-effort and web search may add context.
  if (globalCragOut.fired) {
    logger.warn('CRAG fallback fired — returning low-confidence KB chunks', {
      chunkCount: rerankedGlobalChunks.length,
    });
    send?.({
      type: 'operation_log',
      category: 'rag',
      message: 'KB retrieval inconclusive — showing best available matches; consider web search for additional context',
    });
  }

  // Emit truncation warnings for documents with content cut off
  if (send && userDocTruncations.length > 0) {
    for (const truncation of userDocTruncations) {
      // Only warn if content was actually truncated
      const wasProcessingTruncated = truncation.totalChunks > truncation.processedChunks;
      const wasContextTruncated = truncation.processedChunks > truncation.includedChunks;

      if (wasProcessingTruncated || wasContextTruncated) {
        let message = '';
        if (wasProcessingTruncated && wasContextTruncated) {
          message = uploadDirected
            ? `Partial document used: processed ${truncation.processedChunks} of ${truncation.totalChunks} sections, using ${truncation.includedChunks} in context`
            : `Large document: processed ${truncation.processedChunks} of ${truncation.totalChunks} sections, using ${truncation.includedChunks} in context`;
        } else if (wasProcessingTruncated) {
          message = uploadDirected
            ? `Partial document used: processed ${truncation.processedChunks} of ${truncation.totalChunks} sections`
            : `Large document: processed ${truncation.processedChunks} of ${truncation.totalChunks} sections`;
        } else {
          message = uploadDirected
            ? `Partial document used: using ${truncation.includedChunks} of ${truncation.processedChunks} available sections`
            : `Using ${truncation.includedChunks} of ${truncation.processedChunks} relevant sections`;
        }

        send({
          type: 'context_truncation',
          filename: truncation.filename,
          totalChunks: truncation.totalChunks,
          processedChunks: truncation.processedChunks,
          includedChunks: truncation.includedChunks,
          message,
        });

        logger.debug('Context truncation warning', truncation);
      }
    }
  }

  // Build upload status for progressive disclosure
  if (send && userDocPaths.length > 0) {
    // Group chunks by document to get content stats
    const docStats = new Map<string, { totalLength: number; preview: string }>();
    const errorsByFilename = new Map(userDocErrors.map(error => [error.filename, error.message]));
    for (const chunk of rerankedUserChunks) {
      const existing = docStats.get(chunk.documentName);
      if (existing) {
        existing.totalLength += chunk.text.length;
      } else {
        docStats.set(chunk.documentName, {
          totalLength: chunk.text.length,
          preview: chunk.text.substring(0, 300),
        });
      }
    }

    // Build upload status from paths
    const uploadStatuses: UploadExtractionState[] = userDocPaths.map(path => {
      const filename = path.split('/').pop() || path;
      // Determine source type from filename
      const sourceType: UploadExtractionState['sourceType'] =
        filename.startsWith('youtube-') ? 'youtube' :
        filename.startsWith('web-') ? 'web' : 'file';

      // Find matching doc stats
      const stats = docStats.get(filename);
      const extractionError = errorsByFilename.get(filename);

      return {
        filename,
        sourceType,
        status: stats ? 'success' : 'error',
        contentLength: stats?.totalLength,
        contentPreview: stats?.preview,
        error: stats ? undefined : extractionError || 'No content extracted from this upload',
      };
    });

    send({
      type: 'upload_status',
      uploads: uploadStatuses,
    });
  }

  // Format context
  let context = formatContext(rerankedGlobalChunks, rerankedUserChunks, {
    prioritizeUploads: uploadDirected,
    uploadErrors: userDocErrors,
  });

  // Full-document context: when the query is upload-directed and we produced
  // full-document context (full text or LLM summary), prepend it to the
  // chunk-based context so the LLM has access to the entire uploaded document.
  if (fullDocContexts.length > 0) {
    let fullDocSection = '';
    for (const doc of fullDocContexts) {
      const label = doc.isSummary
        ? `=== FULL DOCUMENT SUMMARY: ${doc.filename} ===\n` +
          `(Original: ${doc.originalCharCount.toLocaleString()} characters — summarised by LLM)\n\n`
        : `=== FULL DOCUMENT CONTENT: ${doc.filename} ===\n\n`;
      fullDocSection += label + doc.content + '\n\n---\n\n';
    }
    context = fullDocSection + context;
    logger.debug('Injected full-document context (streaming)', {
      docCount: fullDocContexts.length,
      totalChars: fullDocSection.length,
    });
  }

  // Extract sources
  const sources = extractSources(rerankedGlobalChunks, rerankedUserChunks);

  // Build system prompt and resolve independent DB reads in parallel
  const categoryId = categoryIds[0];
  let [systemPrompt, resolvedSkills, dataSourcesDescription, toolDefs] = await Promise.all([
    getResolvedSystemPrompt(categoryId),
    resolveSkills(categoryIds, userMessage),
    categoryIds.length > 0 ? getAvailableDataSourcesDescription(categoryIds) : Promise.resolve(''),
    getToolDefinitions(categoryIds),
  ]);

  const activatedSkills: SkillInfo[] = resolvedSkills.skills.map(skill => {
    // Determine trigger reason
    const triggerReason = resolvedSkills.activatedBy.always.includes(skill.name)
      ? 'always'
      : resolvedSkills.activatedBy.keyword.includes(skill.name)
      ? 'keyword'
      : 'category';
    return { name: skill.name, triggerReason };
  });

  if (resolvedSkills.combinedPrompt) {
    systemPrompt = `${systemPrompt}\n\n${resolvedSkills.combinedPrompt}`;
  }

  if (uploadDirected) {
    systemPrompt = `${systemPrompt}\n\nThe user is asking about uploaded files in this conversation. Prioritize the USER UPLOADED DOCUMENT context over the general knowledge base. If uploaded document content is partial or extraction failed, state that clearly instead of saying there was no attachment.`;
  }

  if (kbDocTargetedName) {
    systemPrompt = `${systemPrompt}\n\nThe user is asking about a specific knowledge base document: "${kbDocTargetedName}". Prioritize the content from this document in the KNOWLEDGE BASE DOCUMENTS section. The full document has been retrieved and included in context — use it to answer the user's question comprehensively.`;
  }

  // Inject data source descriptions
  if (dataSourcesDescription) {
    systemPrompt = `${systemPrompt}\n\n${dataSourcesDescription}`;
  }

  // KB summary tool instruction: tell the LLM to use kb_summary when the user
  // asks about KB contents, even if the search-based context is empty.
  systemPrompt = `${systemPrompt}\n\nIMPORTANT: If the user asks what documents are in the knowledge base, asks for a KB summary/overview, or asks what information is available, you MUST call the kb_summary tool. Do NOT say "no documents found" based on the search context alone — the kb_summary tool has pre-computed summaries that are separate from search results. If the user references a specific KB document by name (e.g. "review the CMS RFP"), call the kb_read tool with the filename or a partial name to retrieve its content — always prefer kb_read over web_search for documents that exist in the knowledge base.`;

  // Inject memory context into system prompt
  if (memoryContext?.trim()) {
    systemPrompt = `${systemPrompt}\n\n${memoryContext}`;
  }

  // Note: Summary context is NOT injected here - it's passed separately to
  // generateResponseWithTools which positions it dynamically based on
  // follow-up detection via the conversation-context module

  // Extract available tool names
  const availableTools = toolDefs.map(t => t.function.name);

  // Send context_loaded event for progressive disclosure
  if (send) {
    send({
      type: 'context_loaded',
      skills: activatedSkills,
      toolsAvailable: availableTools,
    });
  }

  logger.debug('RAG retrieval complete', {
    sourcesCount: sources.length,
    skillsCount: activatedSkills.length,
    toolsCount: availableTools.length,
  });

  // Build matched skills with compliance configs for compliance checking
  const matchedSkills: MatchedSkillForCompliance[] = resolvedSkills.skills.map(skill => ({
    id: skill.id,
    name: skill.name,
    complianceConfig: skill.compliance_config ? {
      enabled: skill.compliance_config.enabled,
      sections: skill.compliance_config.sections,
      passThreshold: skill.compliance_config.passThreshold,
      warnThreshold: skill.compliance_config.warnThreshold,
      clarificationInstructions: skill.compliance_config.clarificationInstructions,
      hitlModel: skill.compliance_config.hitlModel,
      preflightClarification: skill.compliance_config.preflightClarification,
    } : undefined,
  }));

  // Build tool routing matches for compliance checking
  const toolRoutingMatches: ToolRoutingMatch[] = resolvedSkills.toolRouting?.matches.map(m => ({
    toolName: m.toolName,
    forceMode: m.forceMode,
  })) || [];

  // ============ Build Citation Trajectory Data ============
  // Capture pre-rerank and post-rerank scores for each chunk
  // to enable the Citation Trajectory visualization.
  const allPreRerank = [...mergedGlobalChunks, ...userChunks];
  const allPostRerank = [...rerankedGlobalChunks, ...rerankedUserChunks];

  // Track which chunk IDs belong to user uploads so we can label them correctly
  const userChunkIds = new Set(userChunks.map(c => c.id));

  // Build a map of post-rerank chunks by their ID for quick lookup
  const postRerankMap = new Map<string, { score: number; index: number }>();
  allPostRerank.forEach((chunk, index) => {
    postRerankMap.set(chunk.id, { score: chunk.score, index });
  });

  // Build trajectory data: for each pre-rerank chunk, find its post-rerank position
  const trajectoryData: ChunkTrajectoryData[] = allPreRerank
    .map((chunk, index) => {
      const postRerank = postRerankMap.get(chunk.id);
      return {
        chunkId: chunk.id,
        documentName: chunk.documentName,
        pageNumber: chunk.pageNumber,
        rawScore: chunk.score,
        rerankedScore: postRerank?.score ?? null,
        wasSelected: postRerank !== undefined,
        rankBefore: index + 1,
        rankAfter: postRerank !== undefined ? postRerank.index + 1 : null,
        sourceType: userChunkIds.has(chunk.id)
          ? 'user_upload' as const
          : 'vector' as const,
      };
    })
    // Sort by rank after reranking (selected chunks first, then by rerank position)
    .sort((a, b) => {
      if (a.wasSelected !== b.wasSelected) return a.wasSelected ? -1 : 1;
      return (a.rankAfter ?? 999) - (b.rankAfter ?? 999);
    });

  return {
    context,
    systemPrompt,
    sources,
    categoryIds,
    activatedSkills,
    availableTools,
    matchedSkills,
    toolRoutingMatches,
    trajectoryData,
  };
}

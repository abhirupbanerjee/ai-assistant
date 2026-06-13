/**
 * RAG Retrieval for Streaming
 *
 * Extracts the RAG retrieval phase for use in the streaming API.
 * Provides context, sources, and skill information for progressive disclosure.
 */

import type { Source, StreamEvent, SkillInfo, UploadExtractionState, Message } from '@/types';
import type { RetrievedChunk } from '@/types';
import { createEmbeddings } from '../openai';
import { buildContext, expandQueries } from '../rag';
import { rerankChunks } from '../reranker';
import { getRagSettings, getAcronymMappings } from '../db/compat/config';
import { getResolvedSystemPrompt } from '../db/compat/category-prompts';
import { getCategoryIdsBySlugs } from '../db/compat/categories';
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
 * Format chunks into context string for LLM
 */
function isUploadDirectedQuery(userMessage: string, hasUploads: boolean): boolean {
  if (!hasUploads) return false;

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
  const { queryExpansionEnabled, llmQueryRewritingEnabled } = ragSettings;
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
  const { globalChunks, userChunks, userDocTruncations, userDocErrors } = await buildContext(
    primaryEmbedding,
    userDocPaths,
    additionalEmbeddings,
    ragSettings,
    categorySlugs.length > 0 ? categorySlugs : undefined,
    uploadDirected ? {
      userDocMaxChunks: MAX_USER_DOC_CHUNKS_FOR_SUMMARY,
      userDocReturnChunks: MAX_USER_CHUNKS_RETURNED_FOR_SUMMARY,
      sampleUserDocChunks: true,
    } : undefined,
    userMessage
  );

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

  // Rerank global and user chunks concurrently
  const [rerankedGlobalChunks, rerankedUserChunks] = await Promise.all([
    rerankChunks(userMessage, globalChunks, { boostDocuments }),
    rerankChunks(userMessage, userChunks, {
      minScoreOverride: uploadDirected ? 0 : USER_UPLOAD_MIN_RERANK_SCORE,
      boostDocuments,
    }),
  ]);

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
  const context = formatContext(rerankedGlobalChunks, rerankedUserChunks, {
    prioritizeUploads: uploadDirected,
    uploadErrors: userDocErrors,
  });

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

  // Inject data source descriptions
  if (dataSourcesDescription) {
    systemPrompt = `${systemPrompt}\n\n${dataSourcesDescription}`;
  }

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
  const allPreRerank = [...globalChunks, ...userChunks];
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
        sourceType: userChunkIds.has(chunk.id) ? 'user_upload' as const : 'vector' as const,
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

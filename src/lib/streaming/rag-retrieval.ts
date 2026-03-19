/**
 * RAG Retrieval for Streaming
 *
 * Extracts the RAG retrieval phase for use in the streaming API.
 * Provides context, sources, and skill information for progressive disclosure.
 */

import type { Source, StreamEvent, SkillInfo, UploadExtractionState, Message } from '@/types';
import type { RetrievedChunk } from '@/types';
import { createEmbeddings } from '../openai';
import { buildContext, type UserDocTruncation } from '../rag';
import { rerankChunks } from '../reranker';
import { getRagSettings, getAcronymMappings } from '../db/compat/config';
import { getResolvedSystemPrompt } from '../db/compat/category-prompts';
import { getCategoryIdsBySlugs } from '../db/compat/categories';
import { resolveSkills } from '../skills/resolver';
import { getAvailableDataSourcesDescription } from '../tools/data-source';
import { getToolDefinitions } from '../tools';
import { ragLogger as logger } from '../logger';
import { MAX_QUERY_EXPANSIONS, CHUNK_PREVIEW_LENGTH } from '../constants';
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
}

/**
 * Expand queries using acronym mappings
 */
async function expandQueries(originalQuery: string, enabled: boolean): Promise<string[]> {
  const queries = [originalQuery];

  if (!enabled) {
    return queries;
  }

  const lowerQuery = originalQuery.toLowerCase();
  const acronymExpansions = await getAcronymMappings();

  for (const [acronym, expansions] of Object.entries(acronymExpansions)) {
    for (const expansion of expansions) {
      if (lowerQuery.includes(acronym.toLowerCase())) {
        queries.push(originalQuery.replace(new RegExp(acronym, 'gi'), expansion));
      }
      if (lowerQuery.includes(expansion.toLowerCase())) {
        queries.push(originalQuery.replace(new RegExp(expansion, 'gi'), acronym.toUpperCase()));
      }
    }
  }

  return queries.slice(0, MAX_QUERY_EXPANSIONS);
}

/**
 * Format chunks into context string for LLM
 */
function formatContext(globalChunks: RetrievedChunk[], userChunks: RetrievedChunk[]): string {
  let context = '';

  if (globalChunks.length > 0) {
    context += '=== KNOWLEDGE BASE DOCUMENTS ===\n\n';
    for (const chunk of globalChunks) {
      context += `[Source: ${chunk.documentName}, Page ${chunk.pageNumber}]\n`;
      context += `${chunk.text}\n\n---\n\n`;
    }
  }

  if (userChunks.length > 0) {
    context += '=== USER UPLOADED DOCUMENT ===\n\n';
    for (const chunk of userChunks) {
      context += `[Source: ${chunk.documentName}, Page ${chunk.pageNumber}]\n`;
      context += `${chunk.text}\n\n---\n\n`;
    }
  }

  if (!context) {
    context = 'No relevant documents found in the knowledge base.';
  }

  return context;
}

/**
 * Extract source metadata from chunks
 */
function extractSources(globalChunks: RetrievedChunk[], userChunks: RetrievedChunk[]): Source[] {
  const allChunks = [...globalChunks, ...userChunks];
  return allChunks.map(chunk => ({
    documentName: chunk.documentName,
    pageNumber: chunk.pageNumber,
    chunkText: chunk.text.substring(0, CHUNK_PREVIEW_LENGTH) + (chunk.text.length > CHUNK_PREVIEW_LENGTH ? '...' : ''),
    score: chunk.score,
  }));
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
  const ragSettings = await getRagSettings();
  const { queryExpansionEnabled } = ragSettings;

  logger.debug('Starting RAG retrieval', { categorySlugs, userDocPaths: userDocPaths.length });

  // Resolve category IDs
  const categoryIds = categorySlugs.length > 0
    ? await getCategoryIdsBySlugs(categorySlugs)
    : [];

  // Expand query for better retrieval
  const expandedQueries = await expandQueries(userMessage, queryExpansionEnabled);

  // Create embeddings for all queries
  const allQueryEmbeddings = await createEmbeddings(expandedQueries);
  const primaryEmbedding = allQueryEmbeddings[0];
  const additionalEmbeddings = allQueryEmbeddings.slice(1);

  // Build context from documents
  send?.({ type: 'operation_log', category: 'rag', message: 'Searching vector database' });
  const { globalChunks, userChunks, userDocTruncations } = await buildContext(
    primaryEmbedding,
    userDocPaths,
    additionalEmbeddings,
    ragSettings,
    categorySlugs.length > 0 ? categorySlugs : undefined
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
  const rerankedGlobalChunks = await rerankChunks(userMessage, globalChunks, { boostDocuments });
  // User uploads bypass threshold - user explicitly added these docs for this conversation
  if (userChunks.length > 0) {
    send?.({ type: 'operation_log', category: 'rag', message: 'Ranking user documents' });
  }
  const rerankedUserChunks = await rerankChunks(userMessage, userChunks, { bypassThreshold: true, boostDocuments });

  // Emit truncation warnings for documents with content cut off
  if (send && userDocTruncations.length > 0) {
    for (const truncation of userDocTruncations) {
      // Only warn if content was actually truncated
      const wasProcessingTruncated = truncation.totalChunks > truncation.processedChunks;
      const wasContextTruncated = truncation.processedChunks > truncation.includedChunks;

      if (wasProcessingTruncated || wasContextTruncated) {
        let message = '';
        if (wasProcessingTruncated && wasContextTruncated) {
          message = `Large document: processed ${truncation.processedChunks} of ${truncation.totalChunks} sections, using ${truncation.includedChunks} in context`;
        } else if (wasProcessingTruncated) {
          message = `Large document: processed ${truncation.processedChunks} of ${truncation.totalChunks} sections`;
        } else {
          message = `Using ${truncation.includedChunks} of ${truncation.processedChunks} relevant sections`;
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

      return {
        filename,
        sourceType,
        status: stats ? 'success' : 'error',
        contentLength: stats?.totalLength,
        contentPreview: stats?.preview,
        error: stats ? undefined : 'No content extracted',
      };
    });

    send({
      type: 'upload_status',
      uploads: uploadStatuses,
    });
  }

  // Format context
  const context = formatContext(rerankedGlobalChunks, rerankedUserChunks);

  // Extract sources
  const sources = extractSources(rerankedGlobalChunks, rerankedUserChunks);

  // Build system prompt
  const categoryId = categoryIds[0];
  let systemPrompt = await getResolvedSystemPrompt(categoryId);

  // Resolve skills and extract info for progressive disclosure
  const resolvedSkills = await resolveSkills(categoryIds, userMessage);
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

  // Inject data source descriptions
  if (categoryIds.length > 0) {
    const dataSourcesDescription = getAvailableDataSourcesDescription(categoryIds);
    if (dataSourcesDescription) {
      systemPrompt = `${systemPrompt}\n\n${dataSourcesDescription}`;
    }
  }

  // Inject memory context into system prompt
  if (memoryContext?.trim()) {
    systemPrompt = `${systemPrompt}\n\n${memoryContext}`;
  }

  // Note: Summary context is NOT injected here - it's passed separately to
  // generateResponseWithTools which positions it dynamically based on
  // follow-up detection via the conversation-context module

  // Get available tools
  const toolDefs = await getToolDefinitions(categoryIds);
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

  return {
    context,
    systemPrompt,
    sources,
    categoryIds,
    activatedSkills,
    availableTools,
    matchedSkills,
    toolRoutingMatches,
  };
}

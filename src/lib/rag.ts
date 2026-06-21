/**
 * RAG (Retrieval Augmented Generation) Module
 *
 * Supports category-based multi-collection search.
 * When categories are specified, queries all relevant category collections plus global.
 */

import { createEmbeddings, generateResponseWithTools } from './openai';
import { createInternalCompletion } from './llm-client';
import type { OpenAI } from 'openai';
import { getVectorStore, getCollectionNames } from './vector-store';
import {
  getCachedQuery,
  cacheQuery,
  hashQuery,
  getCachedUserDocEmbeddings,
  cacheUserDocEmbeddings,
  type CachedUserDocData,
} from './redis';
import { extractTextFromDocument, chunkText } from './ingest';
import { readFileBuffer } from './storage';
import { getRagSettings, getAcronymMappings } from './db/compat/config';
import { getResolvedSystemPrompt } from './db/compat/category-prompts';
import { getCategoryIdsBySlugs } from './db/compat/categories';
import { resolveSkills } from './skills/resolver';
import { rerankChunks } from './reranker';
import { getAvailableDataSourcesDescription } from './tools/data-source';
import { ragLogger as logger } from './logger';
import { detectFollowUp } from './conversation-context';
import {
  graphAugmentedRetrieval,
  shouldSkipGraphAugmentation,
  type GraphAugmentationResult,
} from './graph/retrieval';
import { getGraphSettings } from './db/compat';
import { insertQueryLog, insertRetrievalTrace } from './db/compat/query-logs';
import {
  MAX_QUERY_EXPANSIONS,
  MAX_USER_DOC_CHUNKS,
  MAX_USER_CHUNKS_RETURNED,
  CHUNK_PREVIEW_LENGTH,
  USER_UPLOAD_MIN_RERANK_SCORE,
} from './constants';
import type { Message, Source, RetrievedChunk, RAGResponse, GeneratedDocumentInfo, GeneratedImageInfo, MessageVisualization } from '@/types';

/**
 * Rewrite a query using an LLM to generate semantic variations.
 * Results are cached in Redis for 1 hour.
 * Gracefully returns empty array on any failure.
 */
async function rewriteQueryWithLLM(query: string): Promise<string[]> {
  try {
    const cacheKey = 'query-rewrite:' + hashQuery(query);
    const cached = await getCachedQuery(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as string[];
        if (Array.isArray(parsed) && parsed.every(q => typeof q === 'string')) {
          return parsed;
        }
      } catch {
        // Invalid cache, continue with LLM call
      }
    }

    const prompt = `Generate 3-5 alternative phrasings for the search query below.
Return ONLY a JSON array of strings. No markdown, no preamble, no explanation.
Query: "${query}"`;

    const response = await createInternalCompletion({
      messages: [
        { role: 'system', content: 'You are a helpful assistant that generates search query variations. Always return a valid JSON array of strings — start your reply with [ and end with ]. Do not include any other text.' },
        { role: 'user', content: prompt },
        { role: 'assistant', content: '[' },
      ],
      maxTokens: 256,
      temperature: 0.3,
    });

    // Extract JSON array from response. Use greedy match from first '[' to last ']'
    // so we capture nested/multiline arrays even when the model wraps them in prose.
    const first = response.indexOf('[');
    const last = response.lastIndexOf(']');
    const jsonStr = first !== -1 && last > first ? response.slice(first, last + 1) : response;
    const variations = JSON.parse(jsonStr) as string[];

    if (!Array.isArray(variations) || !variations.every(q => typeof q === 'string')) {
      return [];
    }

    // Cache for 1 hour
    await cacheQuery(cacheKey, JSON.stringify(variations), 3600);

    return variations;
  } catch (err) {
    logger.warn('LLM query rewriting failed, falling back to acronym-only expansion', { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/**
 * Generate expanded queries to improve retrieval coverage
 */
export async function expandQueries(originalQuery: string, enabled: boolean, llmRewritingEnabled: boolean = false): Promise<string[]> {
  const queries = [originalQuery];

  if (!enabled) {
    return queries;
  }

  // Extract key terms and create variations
  const lowerQuery = originalQuery.toLowerCase();

  // Get acronym mappings from SQLite config
  const acronymExpansions = await getAcronymMappings();

  for (const [acronym, expansions] of Object.entries(acronymExpansions)) {
    // expansions is now an array of possible expansions
    for (const expansion of expansions) {
      if (lowerQuery.includes(acronym.toLowerCase())) {
        queries.push(originalQuery.replace(new RegExp(acronym, 'gi'), expansion));
      }
      if (lowerQuery.includes(expansion.toLowerCase())) {
        queries.push(originalQuery.replace(new RegExp(expansion, 'gi'), acronym.toUpperCase()));
      }
    }
  }

  // LLM-based semantic rewriting (opt-in)
  if (llmRewritingEnabled) {
    const rewritten = await rewriteQueryWithLLM(originalQuery);
    for (const variation of rewritten) {
      if (!queries.includes(variation)) {
        queries.push(variation);
      }
    }
  }

  return queries.slice(0, MAX_QUERY_EXPANSIONS);
}

/**
 * Deduplicate chunks based on document and page, keeping highest scored
 */
function deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Map<string, RetrievedChunk>();

  for (const chunk of chunks) {
    const key = chunk.id;
    const existing = seen.get(key);

    if (!existing || chunk.score > existing.score) {
      seen.set(key, chunk);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score);
}

/**
 * Build context from knowledge base documents
 *
 * Retrieves relevant document chunks from the vector store using similarity search.
 * Supports multi-category search, query expansion, and user document processing.
 *
 * @param queryEmbedding - Primary query embedding vector (3072 dimensions for text-embedding-3-large)
 * @param userDocPaths - Paths to user-uploaded documents for additional context (default: [])
 * @param additionalEmbeddings - Additional embeddings from query expansion (default: [])
 * @param settings - RAG settings (optional, fetched from config if not provided)
 * @param categorySlugs - Category slugs to search (if empty, uses global/legacy collection)
 * @returns Object containing globalChunks from knowledge base and userChunks from uploads
 *
 * @example
 * ```typescript
 * const { globalChunks, userChunks } = await buildContext(
 *   queryEmbedding,
 *   ['/path/to/user/doc.pdf'],
 *   additionalEmbeddings,
 *   undefined,
 *   ['hr', 'finance']
 * );
 * ```
 */
/**
 * Truncation stats for user documents
 */
export interface UserDocTruncation {
  filename: string;
  totalChunks: number;
  processedChunks: number;
  includedChunks: number;
}

export interface UserDocExtractionError {
  filename: string;
  message: string;
}

export interface BuildContextOptions {
  userDocMaxChunks?: number;
  userDocReturnChunks?: number;
  sampleUserDocChunks?: boolean;
}

function selectUserDocumentChunks<T>(chunks: T[], limit: number, sampleAcrossDocument: boolean): T[] {
  if (chunks.length <= limit) {
    return chunks;
  }

  if (!sampleAcrossDocument || limit <= 1) {
    return chunks.slice(0, limit);
  }

  const selected: T[] = [];
  const used = new Set<number>();
  const lastIndex = chunks.length - 1;

  for (let i = 0; i < limit; i++) {
    const index = Math.round((i * lastIndex) / (limit - 1));
    if (!used.has(index)) {
      used.add(index);
      selected.push(chunks[index]);
    }
  }

  return selected;
}

export async function buildContext(
  queryEmbedding: number[],
  userDocPaths: string[] = [],
  additionalEmbeddings: number[][] = [],
  settings?: { topKChunks: number; maxContextChunks: number; similarityThreshold: number; hybridSearchEnabled?: boolean },
  categorySlugs?: string[],
  options: BuildContextOptions = {},
  queryText?: string
): Promise<{
  globalChunks: RetrievedChunk[];
  userChunks: RetrievedChunk[];
  userDocTruncations: UserDocTruncation[];
  userDocErrors: UserDocExtractionError[];
}> {
  // Use provided settings or fetch from SQLite config
  const ragSettings = settings || await getRagSettings();
  const { topKChunks, maxContextChunks, similarityThreshold } = ragSettings;

  logger.debug('buildContext called', {
    categorySlugs,
    topKChunks,
    maxContextChunks,
    similarityThreshold,
    embeddingCount: 1 + additionalEmbeddings.length,
  });

  // Collect all embeddings (original + expanded queries)
  const allEmbeddings = [queryEmbedding, ...additionalEmbeddings];

  // Get vector store and collection names
  const store = await getVectorStore();
  const collNames = getCollectionNames();

  // Query with each embedding and collect results
  const allGlobalChunks: RetrievedChunk[] = [];

  for (const embedding of allEmbeddings) {
    // Build list of collections to query.
    // Always include the legacy collection so documents that predate
    // proper categorization (or are intentionally uncategorized) are still found.
    const collectionsToQuery = categorySlugs && categorySlugs.length > 0
      ? [...categorySlugs.map(collNames.forCategory), collNames.global, collNames.legacy]
      : [collNames.global, collNames.legacy];

    logger.debug('Querying collections', { collectionsToQuery });

    // Pass the similarity threshold to the vector store for consistent filtering
    // This ensures Qdrant's pre-filter threshold matches RAG's post-filter threshold
    const results = await store.queryMultipleCollections(
      collectionsToQuery,
      embedding,
      topKChunks,
      undefined, // filter
      similarityThreshold, // scoreThreshold
      ragSettings.hybridSearchEnabled, // hybridSearch
      queryText // queryText for sparse vector tokenization
    );

    logger.debug('Query returned', {
      documentCount: results.documents.length,
      sampleIds: results.ids.slice(0, 3),
    });

    const chunks: RetrievedChunk[] = results.documents.map((doc, i) => ({
      id: results.ids[i],
      text: doc,
      documentName: results.metadatas[i]?.documentName || 'Unknown',
      pageNumber: results.metadatas[i]?.pageNumber || 1,
      score: results.scores[i] || 0, // Already similarity score from abstraction
      source: 'global' as const,
    }));

    allGlobalChunks.push(...chunks);
  }

  // Deduplicate and filter by similarity threshold
  const beforeFilter = deduplicateChunks(allGlobalChunks);
  const globalChunks = beforeFilter
    .filter(chunk => chunk.score >= similarityThreshold)
    .slice(0, maxContextChunks);

  logger.debug('After filtering', {
    beforeDedup: allGlobalChunks.length,
    afterDedup: beforeFilter.length,
    afterThresholdFilter: globalChunks.length,
    threshold: similarityThreshold,
    topScores: beforeFilter.slice(0, 3).map(c => ({ score: c.score, doc: c.documentName })),
  });

  // Process user documents if provided
  const userChunks: RetrievedChunk[] = [];
  const userDocTruncations: UserDocTruncation[] = [];
  const userDocErrors: UserDocExtractionError[] = [];
  const userDocMaxChunks = options.userDocMaxChunks ?? MAX_USER_DOC_CHUNKS;
  const userDocReturnChunks = options.userDocReturnChunks ?? MAX_USER_CHUNKS_RETURNED;
  const sampleUserDocChunks = options.sampleUserDocChunks ?? false;

  for (const docPath of userDocPaths) {
    try {
      const filename = docPath.split('/').pop() || 'user-document';
      // Extract threadId from path: /data/thread-uploads/{userId}/{threadId}/{filename}
      const pathParts = docPath.split('/');
      const threadId = pathParts.length >= 3 ? pathParts[pathParts.length - 2] : undefined;

      // Check cache for existing embeddings
      let cachedData: CachedUserDocData | null = null;
      if (threadId) {
        cachedData = await getCachedUserDocEmbeddings(threadId, filename);
        if (cachedData) {
          const expectedChunkCount = cachedData.totalChunks
            ? Math.min(cachedData.totalChunks, userDocMaxChunks)
            : userDocMaxChunks;
          if (cachedData.chunks.length < expectedChunkCount) {
            cachedData = null;
          }
        }
      }

      let chunksWithEmbeddings: Array<{ id: string; text: string; embedding: number[]; pageNumber: number; documentId: string; source: string; threadId?: string }>;
      let totalChunks: number;

      if (cachedData) {
        // Use cached embeddings
        logger.debug(`Using cached embeddings for ${filename}`, { threadId, chunkCount: cachedData.chunks.length });
        // CRITICAL FIX: Map cached data to include full metadata for source attribution
        chunksWithEmbeddings = cachedData.chunks.map(cachedChunk => ({
          id: cachedChunk.id,
          text: cachedChunk.text,
          embedding: cachedChunk.embedding,
          pageNumber: cachedChunk.pageNumber,
          // Restore metadata from cache to prevent source attribution loss
          documentId: cachedChunk.documentId,
          source: cachedChunk.source,
          threadId: cachedChunk.threadId,
        }));
        // Use cached total or fallback to processed count
        totalChunks = cachedData.totalChunks ?? cachedData.chunks.length;
      } else {
        // Extract and embed - no cache available
        logger.debug(`Processing user document (no cache): ${filename}`);
        const buffer = await readFileBuffer(docPath);
        const { text, pages } = await extractTextFromDocument(buffer, filename);

        // Create temporary chunks from user document with page info
        const chunks = await chunkText(text, 'user-temp', filename, 'user', threadId, undefined, pages);
        totalChunks = chunks.length;
        const selectedChunks = selectUserDocumentChunks(chunks, userDocMaxChunks, sampleUserDocChunks);

        // Get embeddings for user document chunks
        const chunkTexts = selectedChunks.map(c => c.text);
        if (chunkTexts.length === 0) {
          userDocErrors.push({
            filename,
            message: getUploadExtractionErrorMessage(filename),
          });
          continue;
        }

        const chunkEmbeddings = await createEmbeddings(chunkTexts);

        // Build chunks with embeddings - include full metadata for caching
        chunksWithEmbeddings = selectedChunks.map((chunk, i) => ({
          id: chunk.id,
          text: chunk.text,
          embedding: chunkEmbeddings[i],
          pageNumber: chunk.metadata.pageNumber,
          // Include full metadata for proper source attribution and caching
          documentId: chunk.metadata.documentId,
          source: chunk.metadata.source,
          threadId: chunk.metadata.threadId,
        }));

        // Cache the embeddings for future queries (with total chunk count and full metadata)
        if (threadId && chunksWithEmbeddings.length > 0) {
          await cacheUserDocEmbeddings(threadId, filename, {
            chunks: chunksWithEmbeddings,
            totalChunks,
            createdAt: Date.now(),
          });
          logger.debug(`Cached embeddings for ${filename}`, { threadId, chunkCount: chunksWithEmbeddings.length, totalChunks });
        }
      }

      // Track chunks matched for this document
      let matchedChunks = 0;

      // Calculate similarity with query. Filtering happens later in reranking, where
      // explicit attached-file requests can keep low-scoring chunks available.
      for (const chunk of chunksWithEmbeddings) {
        const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
        matchedChunks++;
        userChunks.push({
          id: chunk.id,
          text: chunk.text,
          documentName: filename,
          pageNumber: chunk.pageNumber,
          score: similarity,
          source: 'user',
        });
      }

      // Track truncation stats for this document
      userDocTruncations.push({
        filename,
        totalChunks,
        processedChunks: chunksWithEmbeddings.length,
        includedChunks: matchedChunks,
      });
    } catch (error) {
      logger.error(`Failed to process user document: ${docPath}`, error);
      const filename = docPath.split('/').pop() || 'user-document';
      userDocErrors.push({
        filename,
        message: getUploadExtractionErrorMessage(filename, error),
      });
    }
  }

  // Sort user chunks by relevance
  userChunks.sort((a, b) => b.score - a.score);

  // Update truncation stats with final included counts (after user document return limit)
  const finalUserChunks = userChunks.slice(0, userDocReturnChunks);
  const finalIncludedByDoc = new Map<string, number>();
  for (const chunk of finalUserChunks) {
    finalIncludedByDoc.set(chunk.documentName, (finalIncludedByDoc.get(chunk.documentName) || 0) + 1);
  }

  // Update includedChunks to reflect actual chunks used in context
  for (const truncation of userDocTruncations) {
    truncation.includedChunks = finalIncludedByDoc.get(truncation.filename) || 0;
  }

  return { globalChunks, userChunks: finalUserChunks, userDocTruncations, userDocErrors };
}

function getUploadExtractionErrorMessage(filename: string, error?: unknown): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return 'PDF text could not be extracted. The file may be scanned, image-only, protected, or require OCR.';
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'No text content could be extracted from this upload.';
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

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

function extractSources(globalChunks: RetrievedChunk[], userChunks: RetrievedChunk[]): Source[] {
  // Dedupe by documentName: multiple chunks from the same document collapse into one source.
  // Keeps the highest-scoring chunk's page + snippet. Sorted by score desc.
  const byDocument = new Map<string, Source>();
  for (const chunk of [...globalChunks, ...userChunks]) {
    const candidate: Source = {
      documentName: chunk.documentName,
      pageNumber: chunk.pageNumber,
      chunkText: chunk.text.substring(0, CHUNK_PREVIEW_LENGTH) + (chunk.text.length > CHUNK_PREVIEW_LENGTH ? '...' : ''),
      score: chunk.score,
      retrievalMethod: chunk.retrievalMethod,
    };
    const existing = byDocument.get(chunk.documentName);
    if (!existing || candidate.score > existing.score) {
      byDocument.set(chunk.documentName, candidate);
    }
  }
  return Array.from(byDocument.values()).sort((a, b) => b.score - a.score);
}

/**
 * Main RAG query function
 *
 * Executes a complete RAG pipeline: query expansion, embedding, retrieval,
 * reranking, and LLM response generation with tool support.
 *
 * @param userMessage - The user's question
 * @param conversationHistory - Previous messages in the conversation (default: [])
 * @param userDocPaths - Paths to user-uploaded documents for context (default: [])
 * @param categorySlugs - Category slugs to search (if empty, uses legacy collection)
 * @param memoryContext - Optional user memory context to inject into prompt
 * @param summaryContext - Optional thread summary context for long conversations
 * @returns Promise with answer, sources, generated documents, and visualizations
 *
 * @example
 * ```typescript
 * const response = await ragQuery(
 *   "What is the leave policy?",
 *   conversationHistory,
 *   [],
 *   ["hr", "policies"]
 * );
 * console.log(response.answer);
 * console.log(response.sources);
 * ```
 */
export async function ragQuery(
  userMessage: string,
  conversationHistory: Message[] = [],
  userDocPaths: string[] = [],
  categorySlugs?: string[],
  memoryContext?: string,
  summaryContext?: string,
  modelOverride?: string  // Optional model ID to override the default
): Promise<RAGResponse> {
  // Input validation
  if (!userMessage?.trim()) {
    throw new Error('User message is required');
  }
  if (userMessage.length > 10000) {
    throw new Error('Message exceeds maximum length (10000 characters)');
  }

  // Get RAG settings and category IDs in parallel (category IDs needed later for prompt assembly)
  const [ragSettings, categoryIds] = await Promise.all([
    getRagSettings(),
    categorySlugs && categorySlugs.length > 0 ? getCategoryIdsBySlugs(categorySlugs) : Promise.resolve([]),
  ]);
  const { cacheEnabled, cacheTTLSeconds, queryExpansionEnabled, llmQueryRewritingEnabled } = ragSettings;

  // Include category info in cache key for category-specific results
  const cacheKeyBase = categorySlugs?.length
    ? `${userMessage}:categories:${categorySlugs.sort().join(',')}`
    : userMessage;

  // Check cache (only for queries without user documents and if caching is enabled)
  if (cacheEnabled && userDocPaths.length === 0) {
    const queryHash = hashQuery(cacheKeyBase);
    const cached = await getCachedQuery(queryHash);
    if (cached) {
      try {
        return JSON.parse(cached) as RAGResponse;
      } catch {
        // Invalid cache, continue with fresh query
      }
    }
  }

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

  // Build context from documents using multiple query embeddings
  const { globalChunks, userChunks } = await buildContext(
    primaryEmbedding,
    userDocPaths,
    additionalEmbeddings,
    ragSettings,
    categorySlugs,
    undefined,
    userMessage
  );

  // ============ Phase 2: Graph-Augmented Retrieval ============
  const graphSettings = await getGraphSettings();
  const graphEnabled = graphSettings.graphAugmentationEnabled;
  let graphResult: GraphAugmentationResult = { graphChunks: [], seedEntityIds: [], pprTopEntities: [], used: false };
  let mergedGlobalChunks = globalChunks;

  if (graphEnabled && !shouldSkipGraphAugmentation(globalChunks, graphSettings.skipThreshold)) {
    const graphStart = Date.now();
    try {
      graphResult = await graphAugmentedRetrieval(globalChunks, {
        seedChunkCount: graphSettings.seedChunkCount,
        pprTopK: graphSettings.pprTopK,
      });
      if (graphResult.used && graphResult.graphChunks.length > 0) {
        mergedGlobalChunks = deduplicateChunks([...globalChunks, ...graphResult.graphChunks]);
        logger.debug('Graph augmentation added chunks', {
          originalCount: globalChunks.length,
          graphChunkCount: graphResult.graphChunks.length,
          mergedCount: mergedGlobalChunks.length,
          seedEntities: graphResult.seedEntityIds.length,
          pprTopEntities: graphResult.pprTopEntities.length,
        });
      }
    } catch (err) {
      logger.warn('Graph augmentation failed, falling back to pure RAG', { error: String(err) });
    }
    const graphLatency = Date.now() - graphStart;

    // Log to query_logs + retrieval_traces (Phase 3 foundation)
    try {
      const queryLogId = await insertQueryLog({
        query: userMessage,
        category_slugs: categorySlugs?.join(',') || null,
        graph_enabled: true,
        graph_skipped: !graphResult.used,
        skip_reason: graphResult.used ? null : 'no_seed_entities_or_ppr_empty',
        latency_ms: graphLatency,
      });
      if (graphResult.used) {
        await insertRetrievalTrace({
          query_log_id: queryLogId,
          seed_entity_ids: JSON.stringify(graphResult.seedEntityIds),
          ppr_top_entities: JSON.stringify(graphResult.pprTopEntities),
          traversal_paths: null,
          graph_chunk_ids: JSON.stringify(graphResult.graphChunks.map(c => c.id)),
          final_chunk_ids: null,
          rerank_scores: null,
        });
      }
    } catch (logErr) {
      // Logging is non-blocking
      logger.warn('Failed to write query log', { error: String(logErr) });
    }
  } else if (graphEnabled) {
    // Graph was enabled but skipped (high-confidence Qdrant result)
    try {
      await insertQueryLog({
        query: userMessage,
        category_slugs: categorySlugs?.join(',') || null,
        graph_enabled: true,
        graph_skipped: true,
        skip_reason: 'high_confidence_qdrant',
        latency_ms: 0,
      });
    } catch { /* non-blocking */ }
  }

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
    }
  }

  // Apply reranking if enabled (improves relevance ordering)
  // Pass boostDocuments to prioritize chunks from previous conversation context
  // Run global and user rerankers concurrently.
  const [rerankedGlobalChunks, rerankedUserChunks] = await Promise.all([
    rerankChunks(userMessage, globalChunks, { boostDocuments }),
    rerankChunks(userMessage, userChunks, { minScoreOverride: USER_UPLOAD_MIN_RERANK_SCORE, boostDocuments }),
  ]);

  // Format context for LLM
  const context = formatContext(rerankedGlobalChunks, rerankedUserChunks);

  // Build system prompt and resolve independent DB reads in parallel
  const categoryId = categoryIds[0]; // Use first category for prompt resolution
  let [systemPrompt, resolvedSkills, dataSourcesDescription] = await Promise.all([
    getResolvedSystemPrompt(categoryId),
    resolveSkills(categoryIds, userMessage),
    categoryIds.length > 0 ? getAvailableDataSourcesDescription(categoryIds) : Promise.resolve(''),
  ]);

  if (resolvedSkills.combinedPrompt) {
    systemPrompt = `${systemPrompt}\n\n${resolvedSkills.combinedPrompt}`;
  }

  // Inject data source descriptions (if data sources are available for these categories)
  if (dataSourcesDescription) {
    systemPrompt = `${systemPrompt}\n\n${dataSourcesDescription}`;
  }

  // Inject memory context into system prompt
  if (memoryContext && memoryContext.trim()) {
    systemPrompt = `${systemPrompt}\n\n${memoryContext}`;
  }

  // Note: Summary context is NOT injected here - it's passed separately to
  // generateResponseWithTools which positions it dynamically based on
  // follow-up detection via the conversation-context module

  // Generate response with tools (web search, function APIs)
  // Includes conversation context management for follow-up detection and smart caching
  const { content: answer, fullHistory, cacheKey, cacheable } = await generateResponseWithTools(
    systemPrompt,
    conversationHistory,
    context,
    userMessage,
    true, // Enable tools
    categoryIds, // Pass category IDs for dynamic Function API tools
    undefined, // callbacks (not used in non-streaming)
    undefined, // images (not used in non-streaming)
    summaryContext, // Summary context for dynamic positioning
    memoryContext, // Memory context for cache key
    categorySlugs, // Category slugs for cache key
    undefined, // excludeTools
    undefined, // imageCapabilities
    modelOverride // Optional model override for fallback
  );

  // Extract sources from RAG (use reranked chunks for accurate scores)
  const sources = extractSources(rerankedGlobalChunks, rerankedUserChunks);

  // DESIGN FIX: Route web sources through reranker with threshold filtering
  // Web results previously bypassed all relevance filtering - now they go through reranker
  const webChunks = extractWebSourcesAsChunks(fullHistory);
  const rerankedWebChunks = await rerankChunks(userMessage, webChunks, {
    minScoreOverride: 0.3, // Apply minimum relevance threshold for web results
  });
  const webSources = rerankedWebChunks.map(chunk => ({
    documentName: chunk.documentName,
    pageNumber: chunk.pageNumber,
    chunkText: chunk.text.substring(0, CHUNK_PREVIEW_LENGTH),
    score: chunk.score,
  }));
  sources.push(...webSources);

  // Extract generated documents from tool call results
  const generatedDocuments = extractGeneratedDocumentsFromHistory(fullHistory);

  // Extract generated images from image_gen tool results
  const generatedImages = extractGeneratedImagesFromHistory(fullHistory);

  // Extract visualizations from data_source tool results
  const visualizations = extractVisualizationsFromHistory(fullHistory);

  const response: RAGResponse = { answer, sources, generatedDocuments, generatedImages, visualizations };

  // Cache response using context-aware cache key
  // Only cache if: caching enabled, no user documents, and response is cacheable
  // (cacheable=false for follow-ups and conversations with summaries)
  if (cacheEnabled && userDocPaths.length === 0 && cacheable) {
    await cacheQuery(cacheKey, JSON.stringify(response), cacheTTLSeconds);
  }

  return response;
}

/**
 * Extract web search sources from tool call history
 * DEPRECATED: Use extractWebSourcesAsChunks + rerankChunks for filtered web results
 */
function extractWebSourcesFromHistory(
  history: OpenAI.Chat.ChatCompletionMessageParam[]
): Source[] {
  const webSources: Source[] = [];

  for (const msg of history) {
    if (msg.role === 'tool') {
      try {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const toolResult = JSON.parse(content);

        if (toolResult.results && Array.isArray(toolResult.results)) {
          for (const result of toolResult.results) {
            webSources.push({
              documentName: `[WEB] ${result.title || result.url}`,
              pageNumber: 0, // N/A for web results
              chunkText: result.content?.substring(0, CHUNK_PREVIEW_LENGTH) || '',
              score: result.score || 0,
            });
          }
        }
      } catch (error) {
        // Ignore JSON parse errors
        logger.warn('Failed to parse tool result as web search', { error });
      }
    }
  }

  return webSources;
}

/**
 * Extract web search results as RetrievedChunks for reranking
 * DESIGN FIX: Converts web results to chunk format so they can be filtered by reranker
 */
function extractWebSourcesAsChunks(
  history: OpenAI.Chat.ChatCompletionMessageParam[]
): RetrievedChunk[] {
  const webChunks: RetrievedChunk[] = [];

  for (const msg of history) {
    if (msg.role === 'tool') {
      try {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const toolResult = JSON.parse(content);

        if (toolResult.results && Array.isArray(toolResult.results)) {
          for (let i = 0; i < toolResult.results.length; i++) {
            const result = toolResult.results[i];
            webChunks.push({
              id: `web-${i}`,
              text: result.content || '',
              documentName: `[WEB] ${result.title || result.url}`,
              pageNumber: 0, // N/A for web results
              score: result.score || 0,
              source: 'web' as const,
            });
          }
        }
      } catch (error) {
        // Ignore JSON parse errors
        logger.warn('Failed to parse tool result as web search chunks', { error });
      }
    }
  }

  return webChunks;
}

/**
 * Extract generated documents from tool call history (doc_gen tool)
 */
function extractGeneratedDocumentsFromHistory(
  history: OpenAI.Chat.ChatCompletionMessageParam[]
): GeneratedDocumentInfo[] {
  const documents: GeneratedDocumentInfo[] = [];

  for (const msg of history) {
    if (msg.role === 'tool') {
      try {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const toolResult = JSON.parse(content);

        // Check if this is a successful doc_gen result
        if (toolResult.success && toolResult.document) {
          const doc = toolResult.document;
          documents.push({
            id: doc.id,
            filename: doc.filename,
            fileType: doc.fileType,
            fileSize: doc.fileSize,
            fileSizeFormatted: doc.fileSizeFormatted,
            downloadUrl: doc.downloadUrl,
            expiresAt: doc.expiresAt,
          });
        }
      } catch {
        // Ignore JSON parse errors - not a doc_gen result
      }
    }
  }

  return documents;
}

/**
 * Extract visualizations from tool call history (data_source or chart_gen tool)
 */
function extractVisualizationsFromHistory(
  history: OpenAI.Chat.ChatCompletionMessageParam[]
): MessageVisualization[] {
  const visualizations: MessageVisualization[] = [];

  for (const msg of history) {
    if (msg.role === 'tool') {
      try {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const toolResult = JSON.parse(content);

        // Check if this is a successful data_source or chart_gen result with visualization hint
        if (toolResult.success && toolResult.data && toolResult.visualizationHint) {
          const hint = toolResult.visualizationHint;
          const metadata = toolResult.metadata;

          visualizations.push({
            chartType: hint.chartType,
            data: toolResult.data,
            xField: hint.xField,
            yField: hint.yField,
            groupBy: hint.groupBy,
            sourceName: metadata?.source,
            cached: metadata?.cached,
            fields: metadata?.fields,
            // chart_gen specific fields
            title: toolResult.chartTitle,
            notes: toolResult.notes,
            seriesMode: toolResult.seriesMode,
          });
        }
      } catch {
        // Ignore JSON parse errors - not a data_source/chart_gen result
      }
    }
  }

  return visualizations;
}

/**
 * Extract generated images from tool call history (image_gen tool)
 */
function extractGeneratedImagesFromHistory(
  history: OpenAI.Chat.ChatCompletionMessageParam[]
): GeneratedImageInfo[] {
  const images: GeneratedImageInfo[] = [];

  for (const msg of history) {
    if (msg.role === 'tool') {
      try {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const toolResult = JSON.parse(content);

        // Check if this is a successful image_gen result with imageHint
        if (toolResult.success && toolResult.imageHint) {
          const hint = toolResult.imageHint;
          const metadata = toolResult.metadata;

          images.push({
            id: hint.id,
            url: hint.url,
            thumbnailUrl: hint.thumbnailUrl,
            width: hint.width,
            height: hint.height,
            alt: hint.alt || 'Generated image',
            provider: metadata?.provider,
            model: metadata?.model,
          });
        }
      } catch {
        // Ignore JSON parse errors - not an image_gen result
      }
    }
  }

  return images;
}

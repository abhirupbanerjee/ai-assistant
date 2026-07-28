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
import { getDocumentsByCategory, getGlobalDocuments } from './db/compat';
import { detectReferencedDocument, retrieveFullKbDocumentChunks } from './document-detection';
import { resolveSkills } from './skills/resolver';
import { rerankChunks } from './reranker';
import { getAvailableDataSourcesDescription } from './tools/data-source';
import { ragLogger as logger } from './logger';
import { detectFollowUp } from './conversation-context';
import {
  MAX_QUERY_EXPANSIONS,
  MAX_USER_DOC_CHUNKS,
  MAX_USER_CHUNKS_RETURNED,
  MAX_USER_DOC_CHUNKS_FOR_SUMMARY,
  MAX_USER_CHUNKS_RETURNED_FOR_SUMMARY,
  CHUNK_PREVIEW_LENGTH,
  USER_UPLOAD_MIN_RERANK_SCORE,
  FULL_DOC_CHAR_BUDGET,
  SUMMARY_DOC_CHAR_THRESHOLD,
  CHAPTER_DOC_CHAR_THRESHOLD,
  CHAPTER_SECTION_CHAR_SIZE,
} from './constants';
import { getLlmSettings } from './db/compat/config';
import type { Message, Source, RetrievedChunk, RAGResponse, GeneratedDocumentInfo, GeneratedImageInfo, MessageVisualization } from '@/types';

/**
 * Denylist for the query-rewrite fallback extractor.
 *
 * When the LLM emits malformed JSON (e.g. duplicate-key objects like
 * `{"query": "...", "query": "..."}`), the quote-extraction fallback pulls out
 * every double-quoted string — including literal JSON keys such as "query" —
 * which then get embedded and searched as real query variations (and cached in
 * Redis for 1 hour). These tokens never match anything useful and pollute
 * retrieval. Filter them out along with very short strings and filler words.
 */
const REWRITE_FALLBACK_DENYLIST = new Set([
  // Common JSON keys seen in malformed rewrite responses
  'query', 'queries', 'q', 'search', 'term', 'terms',
  // Generic filler words that add noise without retrieval value
  'the', 'and', 'for', 'with', 'from', 'into', 'about',
]);

/**
 * Returns true if an extracted fallback string is a usable query variation.
 * Rejects denylisted tokens, strings shorter than 3 chars, and strings that
 * contain no alphanumeric characters (pure punctuation/braces).
 */
function isUsableRewriteVariation(value: string): boolean {
  const cleaned = value.trim().toLowerCase();
  if (cleaned.length < 3) return false;
  if (!/[a-z0-9]/i.test(cleaned)) return false;
  if (REWRITE_FALLBACK_DENYLIST.has(cleaned)) return false;
  return true;
}

/**
 * Helper to repair a truncated JSON array.
 * Truncates back to the last complete item, strips trailing commas, and closes with ']'.
 */
function repairJsonArray(jsonStr: string): string {
  jsonStr = jsonStr.trim();
  if (!jsonStr.startsWith('[')) {
    jsonStr = '[' + jsonStr;
  }
  
  let inString = false;
  let escaped = false;
  let cleanIndex = 0; // index of last safe char after closed token
  
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      if (!inString) {
        cleanIndex = i + 1;
      }
      continue;
    }
    if (!inString) {
      if (char === ',' || char === ']' || char === '[') {
        cleanIndex = i + 1;
      }
    }
  }
  
  if (inString) {
    jsonStr = jsonStr.slice(0, cleanIndex).trim();
  }
  
  jsonStr = jsonStr.replace(/,\s*$/, '').trim();
  
  if (!jsonStr.endsWith(']')) {
    jsonStr += ']';
  }
  
  return jsonStr;
}

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

    const prompt = `Generate 3-5 alternative search queries for: "${query}"

CRITICAL: Your ENTIRE response must be a single valid JSON array. Nothing else.

Example correct response:
["alternative query one", "alternative query two", "alternative query three"]

Rules:
- Start with [ and end with ]
- Each query in double quotes, separated by commas
- No explanation, no markdown, no code fences`;

    const response = await createInternalCompletion({
      messages: [
        { role: 'system', content: 'You generate search query variations. Output ONLY a JSON array of strings. Start with [ and end with ]. No other text.' },
        { role: 'user', content: prompt },
        { role: 'assistant', content: '[' },
      ],
      maxTokens: 1024,
      temperature: 0.3,
    });

    // Extract and repair JSON array from response.
    // Use greedy match from first '[' to last ']'.
    let jsonStr = response.trim();
    // Strip markdown code fences if present
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    // Strip any text before the first '[' (some models add preamble)
    const first = jsonStr.indexOf('[');
    const last = jsonStr.lastIndexOf(']');
    if (first !== -1 && last > first) {
      jsonStr = jsonStr.slice(first, last + 1);
    } else if (first !== -1) {
      // Has opening bracket but no closing bracket — truncated JSON
      jsonStr = jsonStr.slice(first);
    } else {
      // No opening bracket — prefill '[' consumed by non-Anthropic model response
      jsonStr = '[' + jsonStr;
    }

    // Repair truncated or malformed JSON (safe no-op on valid input)
    if (jsonStr.startsWith('[')) {
      jsonStr = repairJsonArray(jsonStr);
    }

    let variations: string[] = [];
    try {
      variations = JSON.parse(jsonStr) as string[];
    } catch (parseErr) {
      logger.warn('Failed to parse query-rewrite JSON, attempting line/quote extraction fallback', { 
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        rawResponse: response 
      });
      
      // Fallback 1: Extract all double-quoted strings.
      // Filter out JSON keys ("query", "queries", ...) and junk tokens so
      // malformed responses don't pollute retrieval (see REWRITE_FALLBACK_DENYLIST).
      const quoteMatches = [...response.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
      if (quoteMatches.length > 0) {
        variations = quoteMatches
          .map(m => m[1].replace(/\\"/g, '"').trim())
          .filter(isUsableRewriteVariation);
      }

      // Fallback 2: Extract list items line-by-line
      if (variations.length === 0) {
        const lines = response.split('\n');
        for (const line of lines) {
          const cleanedLine = line.replace(/^\s*[-*•\d+.]+\s*/, '').trim();
          if (cleanedLine && cleanedLine !== '[' && cleanedLine !== ']' && isUsableRewriteVariation(cleanedLine)) {
            variations.push(cleanedLine);
          }
        }
      }
    }

    if (!Array.isArray(variations) || !variations.every(q => typeof q === 'string') || variations.length === 0) {
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
export function deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
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
  /** When true, the query is upload-directed (summarise/review/analyse) */
  uploadDirected?: boolean;
  /** User's original message — used to steer the LLM summarisation prompt */
  userMessage?: string;
}

/**
 * Full-document context entry for user-uploaded files.
 * When the user asks to summarise/review an uploaded file, we inject the
 * full text (or an LLM-generated summary if the document is too long) into
 * the context in addition to (or instead of) chunk-based retrieval.
 */
export interface UserDocFullContext {
  filename: string;
  /** Full text if it fit within budget, or an LLM-generated summary */
  content: string;
  /** Whether the content is the full text or a summarised version */
  isSummary: boolean;
  /** Original character count of the extracted text */
  originalCharCount: number;
}

/**
 * Produce context text for a user-uploaded document.
 *
 * - If the extracted text is short enough (≤ FULL_DOC_CHAR_BUDGET), the full
 *   text is returned as-is so the LLM can read the entire document.
 * - If the text exceeds the budget, an LLM call is made to produce a
 *   comprehensive summary. For very long documents (> CHAPTER_DOC_CHAR_THRESHOLD),
 *   a chapter-wise strategy is used: the text is split into sections, each
 *   section is summarised individually, and the section summaries are
 *   concatenated. This avoids losing information that a single whole-document
 *   summary might omit.
 *
 * If the LLM call fails, the function falls back to returning the truncated
 * full text (first FULL_DOC_CHAR_BUDGET chars) rather than nothing.
 */
/** Thresholds for full-document summarization, passed from buildContext */
interface SummarizationThresholds {
  fullDocCharBudget: number;
  summaryDocCharThreshold: number;
  chapterDocCharThreshold: number;
  chapterSectionCharSize: number;
}

async function summarizeUserDocument(
  fullText: string,
  filename: string,
  userMessage: string,
  thresholds: SummarizationThresholds,
): Promise<UserDocFullContext> {
  const { fullDocCharBudget, summaryDocCharThreshold, chapterDocCharThreshold, chapterSectionCharSize } = thresholds;
  const originalCharCount = fullText.length;

  // Short document — inject full text directly
  if (originalCharCount <= summaryDocCharThreshold) {
    return {
      filename,
      content: fullText,
      isSummary: false,
      originalCharCount,
    };
  }

  // Document needs summarisation
  try {
    const llmSettings = await getLlmSettings();
    const model = llmSettings.model;

    if (originalCharCount > chapterDocCharThreshold) {
      // Chapter-wise summarisation for very long documents.
      // Each section is summarised independently — a failure on one section
      // does NOT discard the summaries already computed for other sections.
      const sections: string[] = [];
      let failedSections = 0;
      const totalSections = Math.ceil(fullText.length / chapterSectionCharSize);
      for (let i = 0; i < fullText.length; i += chapterSectionCharSize) {
        const section = fullText.slice(i, i + chapterSectionCharSize);
        const sectionNum = Math.floor(i / chapterSectionCharSize) + 1;
        try {
          const sectionSummary = await createInternalCompletion({
            messages: [
              {
                role: 'system',
                content:
                  'You are a precise document summariser. Produce a detailed, faithful summary of the provided document section. ' +
                  'Preserve all key facts, data points, names, dates, and conclusions. Do not omit important details. ' +
                  'Write in clear prose. Do not add commentary or opinions.',
              },
              {
                role: 'user',
                content:
                  `Summarise section ${sectionNum} of the document "${filename}". ` +
                  `The user's request is: "${userMessage}". ` +
                  `Tailor the summary to be maximally useful for that request, but cover all key content.\n\n` +
                  `--- DOCUMENT SECTION ${sectionNum} ---\n\n${section}`,
              },
            ],
            model,
            temperature: 0.2,
            maxTokens: 4096,
          });
          if (sectionSummary && sectionSummary.trim()) {
            sections.push(`## Section ${sectionNum}\n\n${sectionSummary}`);
          } else {
            // Empty response — use a truncated version of the raw section
            sections.push(`## Section ${sectionNum}\n\n${section.slice(0, 2000)}\n\n[... section ${sectionNum} could not be summarised ...]`);
            failedSections++;
          }
        } catch (sectionErr) {
          // Individual section failure — log and continue with remaining sections
          logger.warn('Section summarisation failed, using truncated raw text', {
            filename,
            section: sectionNum,
            error: String(sectionErr),
          });
          sections.push(`## Section ${sectionNum}\n\n${section.slice(0, 2000)}\n\n[... section ${sectionNum} could not be summarised ...]`);
          failedSections++;
        }
      }

      // If ALL sections failed, fall through to the truncated-text fallback
      if (sections.length > 0) {
        if (failedSections > 0) {
          logger.warn('Chapter-wise summarisation completed with some failures', {
            filename,
            totalSections,
            failedSections,
          });
        }
        return {
          filename,
          content: sections.join('\n\n'),
          isSummary: true,
          originalCharCount,
        };
      }
    } else {
      // Single whole-document summary for moderately long documents
      const summary = await createInternalCompletion({
        messages: [
          {
            role: 'system',
            content:
              'You are a precise document summariser. Produce a comprehensive, detailed summary of the provided document. ' +
              'Preserve all key facts, data points, names, dates, structure, and conclusions. ' +
              'Organise the summary by the document\'s natural sections or themes. ' +
              'Do not omit important details. Write in clear prose. Do not add commentary or opinions.',
          },
          {
            role: 'user',
            content:
              `Summarise the document "${filename}" in detail. ` +
              `The user's request is: "${userMessage}". ` +
              `Tailor the summary to be maximally useful for that request, but cover all key content.\n\n` +
              `--- DOCUMENT CONTENT ---\n\n${fullText}`,
          },
        ],
        model,
        temperature: 0.2,
        maxTokens: 4096,
      });

      if (summary && summary.trim()) {
        return {
          filename,
          content: summary,
          isSummary: true,
          originalCharCount,
        };
      }
    }
  } catch (err) {
    logger.warn('Full-document summarisation failed, falling back to truncated text', {
      filename,
      error: String(err),
    });
  }

  // Fallback: truncated full text
  const truncated = fullText.slice(0, fullDocCharBudget);
  return {
    filename,
    content: truncated + (originalCharCount > fullDocCharBudget ? '\n\n[... document truncated due to length ...]' : ''),
    isSummary: false,
    originalCharCount,
  };
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
  settings?: { topKChunks: number; maxContextChunks: number; similarityThreshold: number; hybridSearchEnabled?: boolean; fullDocCharBudget?: number; summaryDocCharThreshold?: number; chapterDocCharThreshold?: number; chapterSectionCharSize?: number },
  categorySlugs?: string[],
  options: BuildContextOptions = {},
  queryText?: string
): Promise<{
  globalChunks: RetrievedChunk[];
  userChunks: RetrievedChunk[];
  userDocTruncations: UserDocTruncation[];
  userDocErrors: UserDocExtractionError[];
  fullDocContexts: UserDocFullContext[];
}> {
  // Use provided settings or fetch from SQLite config
  const ragSettings = settings || await getRagSettings();
  const { topKChunks, maxContextChunks, similarityThreshold } = ragSettings;

  // Extract full-document summarization thresholds (fall back to compile-time constants)
  const summaryThresholds: SummarizationThresholds = {
    fullDocCharBudget: ragSettings.fullDocCharBudget ?? FULL_DOC_CHAR_BUDGET,
    summaryDocCharThreshold: ragSettings.summaryDocCharThreshold ?? SUMMARY_DOC_CHAR_THRESHOLD,
    chapterDocCharThreshold: ragSettings.chapterDocCharThreshold ?? CHAPTER_DOC_CHAR_THRESHOLD,
    chapterSectionCharSize: ragSettings.chapterSectionCharSize ?? CHAPTER_SECTION_CHAR_SIZE,
  };

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

  // Pre-fetch existing collections once to avoid querying non-existent
  // collections (e.g., global_documents / organizational_documents may
  // never have been created if no uncategorized docs were ingested).
  const existingCollections = await store.listCollections();

  for (const embedding of allEmbeddings) {
    // Build list of collections to query.
    // Always include the legacy collection so documents that predate
    // proper categorization (or are intentionally uncategorized) are still found.
    // Filter to only collections that actually exist in Qdrant.
    //
    // INTENTIONAL DESIGN: When no categories are selected for a thread, only the
    // global_documents and organizational_documents (legacy) collections are
    // queried. This segregation is by design — it prevents users from accessing
    // category-restricted documents without explicitly selecting that category.
    // Category-tagged documents are only retrieved when the thread has that
    // category assigned.
    const collectionsToQuery = (categorySlugs && categorySlugs.length > 0
      ? [...categorySlugs.map(collNames.forCategory), collNames.global, collNames.legacy]
      : [collNames.global, collNames.legacy])
      .filter(name => existingCollections.includes(name));

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
  const fullDocContexts: UserDocFullContext[] = [];
  const userDocMaxChunks = options.userDocMaxChunks ?? MAX_USER_DOC_CHUNKS;
  const userDocReturnChunks = options.userDocReturnChunks ?? MAX_USER_CHUNKS_RETURNED;
  const sampleUserDocChunks = options.sampleUserDocChunks ?? false;
  const uploadDirected = options.uploadDirected ?? false;
  const userMessageForSummary = options.userMessage ?? '';

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

        // When the query is upload-directed and embeddings were cached,
        // we still need to re-read the file to get the full text for
        // full-document context (the cache only stores chunked embeddings).
        if (uploadDirected) {
          try {
            const buffer = await readFileBuffer(docPath);
            const { text: fullText } = await extractTextFromDocument(buffer, filename);
            if (fullText.trim()) {
              const fullDoc = await summarizeUserDocument(fullText, filename, userMessageForSummary, summaryThresholds);
              fullDocContexts.push(fullDoc);
              logger.debug('Full-document context prepared (from cache path)', {
                filename,
                isSummary: fullDoc.isSummary,
                originalChars: fullDoc.originalCharCount,
                contextChars: fullDoc.content.length,
              });
            }
          } catch (err) {
            logger.warn('Full-document context preparation failed (cache path)', { filename, error: String(err) });
          }
        }
      } else {
        // Extract and embed - no cache available
        logger.debug(`Processing user document (no cache): ${filename}`);
        const buffer = await readFileBuffer(docPath);
        const { text, pages } = await extractTextFromDocument(buffer, filename);

        // When the query is upload-directed (summarise/review/analyse),
        // produce full-document context: inject the entire text if it fits
        // the character budget, or use an LLM to summarise it if too long.
        // This ensures the LLM sees the complete document, not just top-K
        // chunks by similarity — which is critical for summary requests.
        if (uploadDirected && text.trim()) {
          try {
            const fullDoc = await summarizeUserDocument(text, filename, userMessageForSummary, summaryThresholds);
            fullDocContexts.push(fullDoc);
            logger.debug('Full-document context prepared', {
              filename,
              isSummary: fullDoc.isSummary,
              originalChars: fullDoc.originalCharCount,
              contextChars: fullDoc.content.length,
            });
          } catch (err) {
            logger.warn('Full-document context preparation failed', { filename, error: String(err) });
          }
        }

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

  return { globalChunks, userChunks: finalUserChunks, userDocTruncations, userDocErrors, fullDocContexts };
}

function getUploadExtractionErrorMessage(filename: string, error?: unknown): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return 'PDF text could not be extracted. The file may be scanned, image-only, protected, or require OCR.';
  }
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) {
    return 'Word document text could not be extracted. The file may be corrupted or protected.';
  }
  if (lower.endsWith('.ppt') || lower.endsWith('.pptx')) {
    return 'PowerPoint text could not be extracted. The file may be corrupted or contain only images.';
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

  // Interleave KB and user chunks by score so user-uploaded documents are not
  // always positioned at the end (where token-budget truncation drops them first).
  const allChunks = [...globalChunks.map(c => ({ ...c, source: 'global' as const })),
                     ...userChunks.map(c => ({ ...c, source: 'user' as const }))]
    .sort((a, b) => b.score - a.score);

  let hasGlobal = false;
  let hasUser = false;

  for (const chunk of allChunks) {
    if (chunk.source === 'global') {
      if (!hasGlobal) {
        context += '=== KNOWLEDGE BASE DOCUMENTS ===\n\n';
        hasGlobal = true;
      }
    } else {
      if (!hasUser) {
        if (hasGlobal) context += '\n';
        context += '=== USER UPLOADED DOCUMENT ===\n\n';
        hasUser = true;
      }
    }
    context += `[Source: ${chunk.documentName}, Page ${chunk.pageNumber}]\n`;
    context += `${chunk.text}\n\n---\n\n`;
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

/**
 * Detect whether the user's message is directed at an uploaded document.
 * When true, the rerank score floor is lowered to 0, expanded chunk limits are
 * used, and the full-document context path is activated so the model sees the
 * entire uploaded file.
 *
 * This mirrors the logic in src/lib/streaming/rag-retrieval.ts (isUploadDirectedQuery)
 * to keep the non-streaming route consistent with the streaming route.
 *
 * DESIGN DECISION (Fix #3): When a file is attached, ALWAYS treat the query as
 * upload-directed. The previous keyword-regex approach silently failed when the
 * user's phrasing didn't match English trigger words (e.g. "summarise this",
 * "tldr", "key points", or any non-English prompt), causing the full-document
 * context path to be skipped and the rerank floor to drop all chunks.
 *
 * BUG FIX (#4 — Non-Streaming Rerank Floor Discrepancy): Previously the non-streaming
 * ragQuery() always used USER_UPLOAD_MIN_RERANK_SCORE (0.30) for user chunks, causing
 * "summarise this" / "review the attached file" queries to drop all chunks when the
 * query didn't lexically match the document content. The streaming route already had
 * this fix; now the non-streaming route does too.
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

  // Detect upload-directed queries (e.g., "summarise this", "review the attached file")
  // to apply expanded chunk limits and a lowered rerank floor — same logic as the
  // streaming route's performRAGRetrieval().
  const uploadDirected = isUploadDirectedQuery(userMessage, userDocPaths.length > 0);

  // Build context from documents using multiple query embeddings
  // When the query is upload-directed, use expanded chunk limits so summary/review
  // requests get more document content into context, and produce full-document
  // context (full text or LLM summary) so the LLM sees the entire uploaded file.
  const { globalChunks, userChunks, userDocErrors, fullDocContexts } = await buildContext(
    primaryEmbedding,
    userDocPaths,
    additionalEmbeddings,
    ragSettings,
    categorySlugs,
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
  // already handled by the upload-directed path above).
  if (userDocPaths.length === 0) {
    try {
      const categoryDocPromises = categoryIds.map(id => getDocumentsByCategory(id));
      const [categoryDocSets, globalDocs] = await Promise.all([
        Promise.all(categoryDocPromises),
        getGlobalDocuments(),
      ]);

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
        kbDocChunks = await retrieveFullKbDocumentChunks(detected.document, categorySlugs ?? []);
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
    }
  }

  // Apply reranking if enabled (improves relevance ordering)
  // Pass boostDocuments to prioritize chunks from previous conversation context
  // Run global and user rerankers concurrently.
  //
  // BUG FIX (#4): When the query is upload-directed (e.g., "summarise this"), lower
  // the user-chunk rerank floor to 0 so chunks aren't dropped just because the query
  // doesn't lexically match the document content. Previously the non-streaming route
  // always used 0.30, silently dropping all chunks for summary/review requests.
  // Rerank global and user chunks concurrently.
  // Use mergedGlobalChunks (which includes KB document chunks) for the
  // global rerank. When a KB document was targeted by name, lower the rerank
  // floor to 0 and enable the KB-document safety net so the referenced
  // document's chunks are never silently dropped by the reranker threshold.
  const globalCragOut = { fired: false };
  const [rerankedGlobalChunks, rerankedUserChunks] = await Promise.all([
    rerankChunks(userMessage, mergedGlobalChunks, {
      boostDocuments,
      cragFallbackEnabled: ragSettings.cragFallbackEnabled,
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

  if (globalCragOut.fired) {
    logger.warn('CRAG fallback fired — returning low-confidence KB chunks', {
      chunkCount: rerankedGlobalChunks.length,
    });
  }

  // Format context for LLM
  let context = formatContext(rerankedGlobalChunks, rerankedUserChunks);

  // Full-document context: when the query is upload-directed and we produced
  // full-document context (full text or LLM summary), prepend it to the
  // chunk-based context so the LLM has access to the entire uploaded document.
  // This is critical for "summarise this" / "review this document" requests
  // where top-K chunk retrieval alone would miss most of the document.
  if (fullDocContexts.length > 0) {
    let fullDocSection = '';
    for (const doc of fullDocContexts) {
      const label = doc.isSummary
        ? `=== FULL DOCUMENT SUMMARY: ${doc.filename} ===\n` +
          `(Original: ${doc.originalCharCount.toLocaleString()} characters — summarised by LLM)\n\n`
        : `=== FULL DOCUMENT CONTENT: ${doc.filename} ===\n\n`;
      fullDocSection += label + doc.content + '\n\n---\n\n';
    }
    // Prepend full-document context before chunk-based context
    context = fullDocSection + context;
    logger.debug('Injected full-document context', {
      docCount: fullDocContexts.length,
      totalChars: fullDocSection.length,
    });
  }

  // BUG FIX (#5 — Silent Extraction Failure): When context is empty but user document
  // extraction errors exist, inject the error messages into the context so the LLM can
  // explain to the user why their uploaded file couldn't be processed (e.g., scanned PDF
  // with no OCR, corrupt file, protected document). Previously these errors were silently
  // swallowed, resulting in "I don't have any context" with no explanation.
  if (!context.trim() && userDocErrors.length > 0) {
    context = '=== USER UPLOADED DOCUMENT EXTRACTION STATUS ===\n\n';
    for (const error of userDocErrors) {
      context += `[Source: ${error.filename}]\n${error.message}\n\n---\n\n`;
    }
    context += 'NOTE: No document content could be extracted from the uploaded file(s). ' +
      'Please inform the user about the extraction issue above and suggest possible solutions ' +
      '(e.g., upload a text-based PDF instead of a scanned one, or check if the file is corrupted/protected).';
    logger.warn('User document extraction failed — injecting error context', {
      errorCount: userDocErrors.length,
      filenames: userDocErrors.map(e => e.filename),
    });
  }

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

  if (kbDocTargetedName) {
    systemPrompt = `${systemPrompt}\n\nThe user is asking about a specific knowledge base document: "${kbDocTargetedName}". Prioritize the content from this document in the KNOWLEDGE BASE DOCUMENTS section. The full document has been retrieved and included in context — use it to answer the user's question comprehensively.`;
  }

  // Inject data source descriptions (if data sources are available for these categories)
  if (dataSourcesDescription) {
    systemPrompt = `${systemPrompt}\n\n${dataSourcesDescription}`;
  }

  // KB summary tool instruction: tell the LLM to use kb_summary when the user
  // asks about KB contents, even if the search-based context is empty.
  systemPrompt = `${systemPrompt}\n\nIMPORTANT: If the user asks what documents are in the knowledge base, asks for a KB summary/overview, or asks what information is available, you MUST call the kb_summary tool. Do NOT say "no documents found" based on the search context alone — the kb_summary tool has pre-computed summaries that are separate from search results. If the user references a specific KB document by name (e.g. "review the CMS RFP"), call the kb_read tool with the filename or a partial name to retrieve its content — always prefer kb_read over web_search for documents that exist in the knowledge base.`;

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

  const response: RAGResponse = {
    answer,
    sources,
    generatedDocuments,
    generatedImages,
    visualizations,
    // BUG FIX (#5): Surface extraction errors so callers can display them to the user
    userDocErrors: userDocErrors.length > 0 ? userDocErrors : undefined,
  };

  // Cache response using context-aware cache key
  // Only cache if: caching enabled, no user documents, and response is cacheable
  // (cacheable=false for follow-ups and conversations with summaries)
  if (cacheEnabled && userDocPaths.length === 0 && cacheable) {
    await cacheQuery(cacheKey, JSON.stringify(response), cacheTTLSeconds);
  }

  return response;
}

/**
 * Build a tool_call_id → tool name map from assistant messages in the history.
 * Source extraction must gate on tool identity, not result shape: any tool
 * whose result JSON contains a `results` array (e.g. kb_search) would
 * otherwise be misread as web_search output and surface "[WEB] undefined".
 */
function buildToolNameByCallId(
  history: OpenAI.Chat.ChatCompletionMessageParam[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const msg of history) {
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const fn = (tc as { function?: { name?: string } }).function;
        if (tc.id && fn?.name) map.set(tc.id, fn.name);
      }
    }
  }
  return map;
}

/** Tool names whose `results` arrays use the Tavily {title, url, content, score} shape. */
const WEB_SOURCE_TOOLS = new Set(['web_search', 'web_extract']);

/**
 * Extract web search sources from tool call history
 * DEPRECATED: Use extractWebSourcesAsChunks + rerankChunks for filtered web results
 */
function extractWebSourcesFromHistory(
  history: OpenAI.Chat.ChatCompletionMessageParam[]
): Source[] {
  const webSources: Source[] = [];
  const toolNames = buildToolNameByCallId(history);

  for (const msg of history) {
    if (msg.role === 'tool') {
      if (!WEB_SOURCE_TOOLS.has(toolNames.get(msg.tool_call_id) ?? '')) continue;
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
              url: result.url,
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
  const toolNames = buildToolNameByCallId(history);

  for (const msg of history) {
    if (msg.role === 'tool') {
      if (!WEB_SOURCE_TOOLS.has(toolNames.get(msg.tool_call_id) ?? '')) continue;
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
            expiresAt: null,
          });
        }
      } catch {
        // Ignore JSON parse errors - not an image_gen result
      }
    }
  }

  return images;
}

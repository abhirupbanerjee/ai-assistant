/**
 * Reranker Module
 *
 * Supports multiple providers:
 * - Cohere API (fast, requires API key)
 * - Jina Reranker v2 (cross-encoder, best accuracy, free)
 * - Local bi-encoder (legacy, less accurate, free)
 *
 * Includes Redis caching for performance.
 */

import { getRerankerSettings } from './db/config';
import { getCachedQuery, cacheQuery, hashQuery } from './redis';
import type { RetrievedChunk } from '@/types';

/**
 * Options for reranking chunks
 */
export interface RerankOptions {
  /** If true, skip threshold filtering (useful for user uploads) */
  bypassThreshold?: boolean;
  /** Document names to boost (from previous conversation) */
  boostDocuments?: string[];
  /** Boost multiplier for matching documents (default: 1.3) */
  boostFactor?: number;
}

// Cohere rerank result type
interface CohereRerankResult {
  index: number;
  relevanceScore: number;
}

// Cohere client interface (subset of what we use)
interface CohereClientInterface {
  rerank(params: {
    query: string;
    documents: { text: string }[];
    model: string;
    topN: number;
  }): Promise<{ results: CohereRerankResult[] }>;
}

// Lazy-loaded Cohere client
let cohereClient: CohereClientInterface | null = null;

/**
 * Reset the Cohere client (call when API key changes)
 */
export function resetCohereClient(): void {
  cohereClient = null;
}

/**
 * Get or create Cohere client
 * Uses API key from Settings > Reranker (DB-first), falls back to COHERE_API_KEY env var
 */
async function getCohereClient(): Promise<CohereClientInterface> {
  if (cohereClient) return cohereClient;

  const settings = getRerankerSettings();
  const apiKey = settings.cohereApiKey || process.env.COHERE_API_KEY;  // DB first

  if (!apiKey) {
    throw new Error('Cohere API key not configured. Set in Settings > Reranker or COHERE_API_KEY environment variable.');
  }

  const { CohereClient } = await import('cohere-ai');
  cohereClient = new CohereClient({ token: apiKey }) as CohereClientInterface;
  return cohereClient;
}

/**
 * Rerank chunks using Cohere API
 */
async function rerankWithCohere(
  query: string,
  chunks: RetrievedChunk[],
  minScore: number
): Promise<RetrievedChunk[]> {
  try {
    const client = await getCohereClient();

    const response = await client.rerank({
      query,
      documents: chunks.map(c => ({ text: c.text })),
      model: 'rerank-english-v3.0',
      topN: chunks.length,
    });

    // Map reranker scores back to chunks and filter by minimum score
    const rerankedChunks: RetrievedChunk[] = response.results
      .filter((result) => result.relevanceScore >= minScore)
      .map((result) => ({
        ...chunks[result.index],
        score: result.relevanceScore,
      }));

    return rerankedChunks.sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error('[Reranker] Cohere error:', error);
    // Fallback to original chunks on error
    return chunks;
  }
}

// Lazy-loaded local reranker pipeline
let localReranker: ReturnType<typeof import('@xenova/transformers').pipeline> | null = null;

/**
 * Rerank chunks using local @xenova/transformers
 * Uses feature-extraction to compute query-document similarity
 */
async function rerankWithLocal(
  query: string,
  chunks: RetrievedChunk[],
  minScore: number
): Promise<RetrievedChunk[]> {
  try {
    // Dynamic import for @xenova/transformers
    const { pipeline, env, cos_sim } = await import('@xenova/transformers');

    // Configure cache directory from environment variable (set in docker-compose.yml)
    // This prevents EACCES errors when running as non-root in Docker
    env.cacheDir = process.env.TRANSFORMERS_CACHE || '/tmp/transformers_cache';
    env.allowLocalModels = false;

    // Lazy-load the feature extraction pipeline
    // Using all-MiniLM-L6-v2 for semantic similarity (well-tested, fast)
    if (!localReranker) {
      console.log('[Reranker] Loading local model (first time may take a moment)...');
      localReranker = pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        { quantized: true }
      );
    }

    // Cast to a simpler function type for feature extraction
    type FeatureExtractor = (text: string, options?: { pooling?: string; normalize?: boolean }) => Promise<{ data: Float32Array }>;
    const extractor = (await localReranker) as unknown as FeatureExtractor;

    // Get query embedding
    const queryOutput = await extractor(query, { pooling: 'mean', normalize: true });
    const queryEmbedding = Array.from(queryOutput.data);

    // Score each chunk against the query using cosine similarity
    const scoredChunks: RetrievedChunk[] = [];

    for (const chunk of chunks) {
      try {
        // Get chunk embedding
        // Truncate long chunks to avoid model issues
        const truncatedText = chunk.text.slice(0, 512);
        const chunkOutput = await extractor(truncatedText, { pooling: 'mean', normalize: true });
        const chunkEmbedding = Array.from(chunkOutput.data);

        // Calculate cosine similarity
        const similarity = cos_sim(queryEmbedding, chunkEmbedding);

        // Normalize similarity from [-1, 1] to [0, 1]
        const score = (similarity + 1) / 2;

        if (score >= minScore) {
          scoredChunks.push({
            ...chunk,
            score,
          });
        }
      } catch (chunkError) {
        console.warn('[Reranker] Error scoring chunk:', chunkError);
        // Keep chunk with original score if reranking fails
        if (chunk.score >= minScore) {
          scoredChunks.push(chunk);
        }
      }
    }

    console.log(`[Reranker] Local scoring complete: ${scoredChunks.length} chunks passed threshold`);
    return scoredChunks.sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error('[Reranker] Local reranker error:', error);
    // Fallback to original chunks on error
    return chunks;
  }
}

// Lazy-loaded Jina reranker model
let jinaReranker: {
  tokenizer: Awaited<ReturnType<typeof import('@xenova/transformers').AutoTokenizer.from_pretrained>>;
  model: Awaited<ReturnType<typeof import('@xenova/transformers').AutoModelForSequenceClassification.from_pretrained>>;
} | null = null;

// Track if Jina model loading has failed to avoid repeated attempts
let jinaLoadFailed = false;

/**
 * Reset the Jina reranker state (call to retry loading after fixing issues)
 */
export function resetJinaReranker(): void {
  jinaReranker = null;
  jinaLoadFailed = false;
}

/**
 * Sigmoid function to convert logits to probability
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Rerank chunks using Jina Reranker v2 (cross-encoder)
 *
 * This is a true reranker that jointly processes query+document pairs,
 * providing more accurate relevance scoring than bi-encoder approaches.
 *
 * Model: jinaai/jina-reranker-v2-base-multilingual
 * - 278M parameters (half the size of BGE-Reranker)
 * - 15x faster than BGE-Reranker
 * - Supports 100+ languages
 * - Max context: 1024 tokens
 */
async function rerankWithJina(
  query: string,
  chunks: RetrievedChunk[],
  minScore: number
): Promise<RetrievedChunk[]> {
  try {
    const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import('@xenova/transformers');

    // Configure cache directory from environment variable (set in docker-compose.yml)
    // This prevents EACCES errors when running as non-root in Docker
    env.cacheDir = process.env.TRANSFORMERS_CACHE || '/tmp/transformers_cache';
    env.allowLocalModels = false;

    // Lazy-load the Jina Reranker v2 model
    if (!jinaReranker) {
      // Skip loading if previous attempt failed (avoid repeated failures)
      if (jinaLoadFailed) {
        console.log('[Reranker] Skipping Jina model load (previous attempt failed)');
        return chunks;
      }

      console.log('[Reranker] Loading Jina Reranker v2 model (first time may take a moment)...');
      const modelId = 'jinaai/jina-reranker-v2-base-multilingual';

      try {
        const [tokenizer, model] = await Promise.all([
          AutoTokenizer.from_pretrained(modelId),
          AutoModelForSequenceClassification.from_pretrained(modelId, {
            quantized: false, // Use full-precision (fp32) model for better accuracy
          }),
        ]);

        // Validate model loaded correctly
        if (!tokenizer || !model) {
          throw new Error('Model or tokenizer failed to initialize (null/undefined)');
        }

        jinaReranker = { tokenizer, model };
        console.log('[Reranker] Jina Reranker v2 model loaded successfully');
      } catch (loadError) {
        jinaLoadFailed = true;
        console.error('[Reranker] Failed to load Jina model - will use original chunks:', loadError);
        return chunks;
      }
    }

    const scoredChunks: RetrievedChunk[] = [];

    for (const chunk of chunks) {
      try {
        // Cross-encoder: tokenize query + document together
        // Truncate to 1024 tokens max (model limit)
        const truncatedText = chunk.text.slice(0, 4000); // ~1000 tokens approximate

        const inputs = await jinaReranker.tokenizer(query, truncatedText, {
          padding: true,
          truncation: true,
          max_length: 1024,
        });

        // Get relevance score from model
        const outputs = await jinaReranker.model(inputs);

        // Convert logits to probability score (0-1)
        // The model outputs a single logit for relevance
        const logits = outputs.logits.data as Float32Array;
        const score = sigmoid(logits[0]);

        if (score >= minScore) {
          scoredChunks.push({
            ...chunk,
            score,
          });
        }
      } catch (chunkError) {
        console.warn('[Reranker] Error scoring chunk with Jina:', chunkError);
        // Keep chunk with original score if reranking fails
        if (chunk.score >= minScore) {
          scoredChunks.push(chunk);
        }
      }
    }

    console.log(`[Reranker] Jina scoring complete: ${scoredChunks.length} chunks passed threshold`);
    return scoredChunks.sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error('[Reranker] Jina reranker error:', error);
    // Fallback to original chunks on error
    return chunks;
  }
}

/**
 * Main reranking function
 *
 * Reranks retrieved chunks using the configured provider.
 * Includes caching for performance.
 *
 * @param query - The user's search query
 * @param chunks - Retrieved chunks from vector search
 * @param options - Optional settings
 * @param options.bypassThreshold - If true, skip threshold filtering (useful for user uploads)
 * @param options.boostDocuments - Document names to boost (for follow-up context)
 * @param options.boostFactor - Boost multiplier (default: 1.3)
 * @returns Reranked chunks sorted by relevance
 */
export async function rerankChunks(
  query: string,
  chunks: RetrievedChunk[],
  options?: RerankOptions
): Promise<RetrievedChunk[]> {
  const settings = getRerankerSettings();
  // When bypassThreshold is true, use 0 as minScore to include all chunks
  const minScore = options?.bypassThreshold ? 0 : settings.minRerankerScore;

  // Return original chunks if no chunks
  if (chunks.length === 0) {
    return chunks;
  }

  // If reranker is disabled, still apply boost logic if provided
  if (!settings.enabled) {
    let result = [...chunks];

    // Apply boost for follow-up context even without reranking
    if (options?.boostDocuments?.length) {
      const boostFactor = options.boostFactor ?? 1.3;
      result = result.map(chunk => {
        if (options.boostDocuments!.includes(chunk.documentName)) {
          return {
            ...chunk,
            score: Math.min(chunk.score * boostFactor, 1.0),
          };
        }
        return chunk;
      });
      result.sort((a, b) => b.score - a.score);
    }

    // Apply threshold filtering
    return result.filter(c => c.score >= minScore);
  }

  // Check cache first
  const cacheKey = `reranker:${hashQuery(`${query}:${chunks.map(c => c.id).join(',')}`)}`;

  try {
    const cached = await getCachedQuery(cacheKey);
    if (cached) {
      const cachedScores: number[] = JSON.parse(cached);
      // Apply cached scores to chunks
      return chunks
        .map((chunk, i) => ({
          ...chunk,
          score: cachedScores[i] ?? chunk.score,
        }))
        .filter(c => c.score >= minScore)
        .sort((a, b) => b.score - a.score);
    }
  } catch {
    // Cache miss or error, continue with reranking
  }

  // Limit chunks to rerank for performance
  const chunksToRerank = chunks.slice(0, settings.topKForReranking);
  const remainingChunks = chunks.slice(settings.topKForReranking);

  console.log(`[Reranker] Reranking ${chunksToRerank.length} chunks with ${settings.provider}`);

  let rerankedChunks: RetrievedChunk[];

  if (settings.provider === 'cohere') {
    rerankedChunks = await rerankWithCohere(
      query,
      chunksToRerank,
      minScore
    );
  } else if (settings.provider === 'jina') {
    rerankedChunks = await rerankWithJina(
      query,
      chunksToRerank,
      minScore
    );
  } else {
    // Legacy 'local' bi-encoder fallback
    rerankedChunks = await rerankWithLocal(
      query,
      chunksToRerank,
      minScore
    );
  }

  // Cache the scores for future use
  try {
    const scores = chunks.map(chunk => {
      const reranked = rerankedChunks.find(r => r.id === chunk.id);
      return reranked?.score ?? chunk.score;
    });
    await cacheQuery(cacheKey, JSON.stringify(scores), settings.cacheTTLSeconds);
  } catch {
    // Ignore cache errors
  }

  // Combine reranked chunks with remaining (unranked) chunks
  // Filter remaining chunks by the same threshold
  const filteredRemaining = remainingChunks.filter(
    c => c.score >= minScore
  );

  console.log(`[Reranker] After reranking: ${rerankedChunks.length} chunks passed threshold`);

  // Combine reranked and remaining chunks
  let finalChunks = [...rerankedChunks, ...filteredRemaining];

  // Apply boost for documents from previous conversation (follow-up context)
  if (options?.boostDocuments?.length) {
    const boostFactor = options.boostFactor ?? 1.3;
    let boostedCount = 0;

    finalChunks = finalChunks.map(chunk => {
      if (options.boostDocuments!.includes(chunk.documentName)) {
        boostedCount++;
        return {
          ...chunk,
          score: Math.min(chunk.score * boostFactor, 1.0), // Cap at 1.0
        };
      }
      return chunk;
    });

    // Re-sort after boosting
    finalChunks.sort((a, b) => b.score - a.score);

    if (boostedCount > 0) {
      console.log(`[Reranker] Boosted ${boostedCount} chunks from previous conversation`);
    }
  }

  return finalChunks;
}

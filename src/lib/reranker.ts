/**
 * Reranker Module
 *
 * Supports dual providers:
 * - Cohere API (fast, requires API key)
 * - Local @xenova/transformers (free, slower first load)
 *
 * Includes Redis caching for performance.
 */

import { getRerankerSettings } from './db/config';
import { getCachedQuery, cacheQuery, hashQuery } from './redis';
import type { RetrievedChunk } from '@/types';

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
 * Get or create Cohere client
 */
async function getCohereClient(): Promise<CohereClientInterface> {
  if (cohereClient) return cohereClient;

  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    throw new Error('COHERE_API_KEY environment variable is not set');
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

    // Disable local model caching warnings
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
 * @returns Reranked chunks sorted by relevance
 */
export async function rerankChunks(
  query: string,
  chunks: RetrievedChunk[],
  options?: { bypassThreshold?: boolean }
): Promise<RetrievedChunk[]> {
  const settings = getRerankerSettings();
  // When bypassThreshold is true, use 0 as minScore to include all chunks
  const minScore = options?.bypassThreshold ? 0 : settings.minRerankerScore;

  // Return original chunks if reranker is disabled or no chunks
  if (!settings.enabled || chunks.length === 0) {
    return chunks;
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
  } else {
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

  return [...rerankedChunks, ...filteredRemaining];
}

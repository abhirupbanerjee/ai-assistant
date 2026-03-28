/**
 * Reranker Module
 *
 * Supports multiple providers with priority-based fallback:
 * - BGE Reranker Large (cross-encoder, best accuracy, free)
 * - Cohere API (fast, requires API key)
 * - BGE Reranker Base (cross-encoder, smaller, free)
 * - Local bi-encoder (legacy, less accurate, free)
 *
 * Includes Redis caching for performance.
 */

import { getRerankerSettings, type RerankerProvider } from './db/compat/config';
import { getCachedQuery, cacheQuery, hashQuery } from './redis';
import { getApiKey } from './provider-helpers';
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

  const settings = await getRerankerSettings();
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

/**
 * Rerank chunks using Fireworks AI API (Qwen3 Reranker)
 * OpenAI-compatible /v1/rerank endpoint
 */
async function rerankWithFireworks(
  query: string,
  chunks: RetrievedChunk[],
  minScore: number
): Promise<RetrievedChunk[]> {
  const apiKey = await getApiKey('fireworks');
  if (!apiKey) {
    throw new Error('Fireworks API key not configured. Set in Settings > Providers or FIREWORKS_AI_API_KEY environment variable.');
  }

  const response = await fetch('https://api.fireworks.ai/inference/v1/rerank', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'accounts/fireworks/models/qwen3-reranker-8b',
      query,
      documents: chunks.map(c => c.text),
      top_n: chunks.length,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Fireworks rerank API error: ${response.status} ${response.statusText} ${errorText}`);
  }

  const data = await response.json() as { results: { index: number; relevance_score: number }[] };

  const rerankedChunks: RetrievedChunk[] = data.results
    .filter((result) => result.relevance_score >= minScore)
    .map((result) => ({
      ...chunks[result.index],
      score: result.relevance_score,
    }));

  return rerankedChunks.sort((a, b) => b.score - a.score);
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

// Lazy-loaded BGE reranker pipelines
let bgeRerankerLarge: Awaited<ReturnType<typeof import('@xenova/transformers').pipeline>> | null = null;
let bgeRerankerBase: Awaited<ReturnType<typeof import('@xenova/transformers').pipeline>> | null = null;

/**
 * Reset the BGE reranker state (call to retry loading after fixing issues)
 */
export function resetBGEReranker(): void {
  bgeRerankerLarge = null;
  bgeRerankerBase = null;
}

/**
 * Rerank chunks using BGE cross-encoder
 *
 * BGE rerankers are true cross-encoders that jointly process query+document pairs,
 * providing accurate relevance scoring.
 *
 * Models:
 * - Xenova/bge-reranker-large (335M params, ~670MB, best accuracy)
 * - Xenova/bge-reranker-base (110M params, ~220MB, good accuracy)
 *
 * Max context: 512 tokens
 */
async function rerankWithBGE(
  query: string,
  chunks: RetrievedChunk[],
  minScore: number,
  variant: 'large' | 'base' = 'large'
): Promise<RetrievedChunk[]> {
  const { pipeline, env } = await import('@xenova/transformers');

  // Configure cache directory
  env.cacheDir = process.env.TRANSFORMERS_CACHE || '/tmp/transformers_cache';
  env.allowLocalModels = false;

  const modelId = variant === 'large'
    ? 'Xenova/bge-reranker-large'
    : 'Xenova/bge-reranker-base';

  // Load model if needed
  if (variant === 'large' && !bgeRerankerLarge) {
    console.log('[Reranker] Loading BGE Reranker Large (first time may take ~670MB download)...');
    bgeRerankerLarge = await pipeline('text-classification', modelId, { quantized: true });
    console.log('[Reranker] BGE Reranker Large loaded successfully');
  } else if (variant === 'base' && !bgeRerankerBase) {
    console.log('[Reranker] Loading BGE Reranker Base (first time may take ~220MB download)...');
    bgeRerankerBase = await pipeline('text-classification', modelId, { quantized: true });
    console.log('[Reranker] BGE Reranker Base loaded successfully');
  }

  const reranker = variant === 'large' ? bgeRerankerLarge : bgeRerankerBase;
  const scoredChunks: RetrievedChunk[] = [];

  // Type for text-classification pipeline results
  type ClassificationResult = { label: string; score: number }[];

  for (const chunk of chunks) {
    try {
      // BGE reranker expects query and passage combined
      const truncatedText = chunk.text.slice(0, 512);
      const input = `${query} [SEP] ${truncatedText}`;

      // Cast to proper function type for text-classification pipeline
      const classify = reranker as unknown as (text: string) => Promise<ClassificationResult>;
      const result = await classify(input);

      // BGE outputs [{ label: 'LABEL_0', score: 0.xxx }]
      const score = Array.isArray(result) ? result[0]?.score ?? 0 : 0;

      if (score >= minScore) {
        scoredChunks.push({
          ...chunk,
          score,
        });
      }
    } catch (chunkError) {
      console.warn('[Reranker] Error scoring chunk with BGE:', chunkError);
      // Keep chunk with original score if reranking fails
      if (chunk.score >= minScore) {
        scoredChunks.push(chunk);
      }
    }
  }

  console.log(`[Reranker] BGE ${variant} scoring complete: ${scoredChunks.length} chunks passed threshold`);
  return scoredChunks.sort((a, b) => b.score - a.score);
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
  const settings = await getRerankerSettings();
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

  const enabledProviders = settings.providers.filter(p => p.enabled);
  console.log(`[Reranker] Reranking ${chunksToRerank.length} chunks (${enabledProviders.length} providers available)`);

  let rerankedChunks: RetrievedChunk[] | null = null;

  // Try providers in priority order
  for (const providerConfig of settings.providers) {
    if (!providerConfig.enabled) continue;

    try {
      console.log(`[Reranker] Trying ${providerConfig.provider}...`);

      switch (providerConfig.provider) {
        case 'bge-large':
          rerankedChunks = await rerankWithBGE(query, chunksToRerank, minScore, 'large');
          break;
        case 'bge-base':
          rerankedChunks = await rerankWithBGE(query, chunksToRerank, minScore, 'base');
          break;
        case 'cohere':
          rerankedChunks = await rerankWithCohere(query, chunksToRerank, minScore);
          break;
        case 'fireworks':
          rerankedChunks = await rerankWithFireworks(query, chunksToRerank, minScore);
          break;
        case 'local':
          rerankedChunks = await rerankWithLocal(query, chunksToRerank, minScore);
          break;
      }

      // If we got results, break out of the loop
      if (rerankedChunks !== null) {
        console.log(`[Reranker] ${providerConfig.provider} succeeded`);
        break;
      }
    } catch (error) {
      console.error(`[Reranker] ${providerConfig.provider} failed:`, error);
      // Continue to next provider
    }
  }

  // Fallback to original chunks if all providers failed
  if (rerankedChunks === null) {
    console.warn('[Reranker] All providers failed, returning original chunks filtered by threshold');
    rerankedChunks = chunksToRerank.filter(c => c.score >= minScore);
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

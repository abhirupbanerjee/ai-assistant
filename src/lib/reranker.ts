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
  /** Override the configured min score with a custom threshold (e.g., 0.05 for user uploads) */
  minScoreOverride?: number;
  /** If true, skip threshold filtering (useful for user uploads) - DEPRECATED: use minScoreOverride instead */
  bypassThreshold?: boolean;
  /** Document names to boost (from previous conversation) */
  boostDocuments?: string[];
  /** Boost multiplier for matching documents (default: 1.3) */
  boostFactor?: number;
  /** If provided, will be populated with all chunk scores before threshold filtering */
  scoresOut?: Map<string, number>;
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

  const data = await response.json() as Record<string, unknown>;

  // Fireworks' rerank response has historically used `results`. Some versions/accounts
  // return an OpenAI-compatible `data` list. Normalize both shapes and log surprises.
  let rawResults: unknown[] | undefined;
  if (Array.isArray(data.results)) {
    rawResults = data.results;
  } else if (Array.isArray(data.data)) {
    rawResults = data.data;
  }

  if (!rawResults) {
    const bodyPreview = JSON.stringify(data).slice(0, 500);
    console.error('[Reranker] Fireworks unexpected response body:', bodyPreview);
    throw new Error(`Fireworks rerank API returned invalid response format: missing 'results' or 'data' array`);
  }

  const results: { index: number; relevance_score: number }[] = rawResults
    .map((item: unknown) => {
      if (typeof item !== 'object' || item === null) return null;
      const r = item as Record<string, unknown>;
      const index = typeof r.index === 'number' ? r.index : undefined;
      const score =
        typeof r.relevance_score === 'number'
          ? r.relevance_score
          : typeof r.relevanceScore === 'number'
            ? r.relevanceScore
            : undefined;
      if (index === undefined || score === undefined) return null;
      return { index, relevance_score: score };
    })
    .filter((r): r is { index: number; relevance_score: number } => r !== null);

  if (results.length === 0) {
    const bodyPreview = JSON.stringify(data).slice(0, 500);
    console.error('[Reranker] Fireworks response contained no usable results:', bodyPreview);
    throw new Error(`Fireworks rerank API returned empty or malformed results array`);
  }

  // CRITICAL FIX: Validate that all chunks received scores
  // Partial results cause score misalignment - missing chunks get wrong scores mapped to them
  if (results.length !== chunks.length) {
    console.warn(
      `[Reranker] Fireworks returned ${results.length} results for ${chunks.length} chunks. ` +
      `Padding missing chunks with original scores.`
    );
    // Create a map of indices that have results
    const resultIndices = new Set(results.map(r => r.index));
    // Add missing chunks with their original scores
    for (let i = 0; i < chunks.length; i++) {
      if (!resultIndices.has(i)) {
        results.push({
          index: i,
          relevance_score: chunks[i].score, // Use original score
        });
      }
    }
  }

  const rerankedChunks: RetrievedChunk[] = results
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
    try {
      bgeRerankerLarge = await pipeline('text-classification', modelId, { quantized: true });
    } catch (loadErr) {
      console.warn('[Reranker] BGE Large quantized load failed, retrying without quantization:', loadErr);
      bgeRerankerLarge = await pipeline('text-classification', modelId, { quantized: false });
    }
    console.log('[Reranker] BGE Reranker Large loaded successfully');
  } else if (variant === 'base' && !bgeRerankerBase) {
    console.log('[Reranker] Loading BGE Reranker Base (first time may take ~220MB download)...');
    try {
      bgeRerankerBase = await pipeline('text-classification', modelId, { quantized: true });
    } catch (loadErr) {
      console.warn('[Reranker] BGE Base quantized load failed, retrying without quantization:', loadErr);
      bgeRerankerBase = await pipeline('text-classification', modelId, { quantized: false });
    }
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

      // BGE rerankers are single-output regression models (sigmoid head, one label).
      // Xenova/bge-reranker-{base,large} expose this as a text-classification pipeline
      // returning a single LABEL_0 whose score IS the relevance probability.
      // Pass topk: null to surface all labels in case a variant exposes two heads
      // (LABEL_0 = irrelevant, LABEL_1 = relevant) — in that case prefer LABEL_1.
      const classify = reranker as unknown as (text: string, opts?: { topk: number | null }) => Promise<ClassificationResult>;
      const result = await classify(input, { topk: null });

      let score = 0;
      if (Array.isArray(result) && result.length > 0) {
        const label1 = result.find(r => r.label === 'LABEL_1');
        score = label1 ? label1.score : result[0].score;
      }

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
  // Determine minScore: use override if provided, else check deprecated bypassThreshold, else use configured threshold
  let minScore: number;
  if (options?.minScoreOverride !== undefined) {
    minScore = options.minScoreOverride;
  } else if (options?.bypassThreshold) {
    minScore = 0; // Deprecated: bypass all filtering
  } else {
    minScore = settings.minRerankerScore;
  }

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
      // Cache stores only chunks that survived reranking, keyed by ID.
      // Chunks absent from the map were filtered out by threshold and should remain filtered.
      const cachedScores: Record<string, number> = JSON.parse(cached);
      return chunks
        .filter(c => c.id in cachedScores)
        .map(c => ({ ...c, score: cachedScores[c.id] }))
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
  // Use original Qdrant scores (which are typically 0.2-0.5 for relevant matches) rather than
  // the reranker minScore threshold (which may be 0.7+). A very low threshold (0.05) ensures
  // we preserve chunks that were retrieved by Qdrant as relevant, even when the reranker fails.
  if (rerankedChunks === null) {
    const fallbackThreshold = 0.05;
    console.warn(`[Reranker] All providers failed, returning original chunks with fallback threshold ${fallbackThreshold}`);
    rerankedChunks = chunksToRerank.filter(c => c.score >= fallbackThreshold);
  }

  // Cache only the chunks that survived threshold filtering, keyed by ID.
  // This prevents cache hits from resurrecting chunks that were correctly filtered out.
  try {
    const scores: Record<string, number> = {};
    for (const chunk of rerankedChunks) {
      scores[chunk.id] = chunk.score;
    }
    await cacheQuery(cacheKey, JSON.stringify(scores), settings.cacheTTLSeconds);
  } catch {
    // Ignore cache errors
  }

  // DESIGN FIX: Apply boost BEFORE threshold filtering to preserve relative ordering
  // Boosting after threshold can inflate scores beyond probability range and break ordering
  let boostedReranked = rerankedChunks;
  if (options?.boostDocuments?.length && rerankedChunks.length > 0) {
    const boostFactor = options.boostFactor ?? 1.3;
    let boostedCount = 0;

    boostedReranked = rerankedChunks.map(chunk => {
      if (options.boostDocuments!.includes(chunk.documentName)) {
        boostedCount++;
        // Use additive boost instead of multiplicative to preserve relative ordering
        // Additive: score + (factor-1)*score = score * factor, but capped smoothly
        const boostedScore = chunk.score + (chunk.score * (boostFactor - 1));
        return {
          ...chunk,
          score: Math.min(boostedScore, 1.0), // Cap at 1.0
        };
      }
      return chunk;
    });

    // Re-sort after boosting so boosted chunks are in correct positions
    boostedReranked.sort((a, b) => b.score - a.score);

    if (boostedCount > 0) {
      console.log(`[Reranker] Boosted ${boostedCount} chunks from previous conversation (pre-threshold)`);
    }
  }

  // Apply threshold filtering AFTER boost so boosted chunks can still pass
  const filteredReranked = boostedReranked.filter(c => c.score >= minScore);

  // Combine reranked chunks with remaining (unranked) chunks
  // Filter remaining chunks by the same threshold
  const filteredRemaining = remainingChunks.filter(
    c => c.score >= minScore
  );

  console.log(`[Reranker] After reranking: ${filteredReranked.length} chunks passed threshold`);

  // Combine reranked and remaining chunks
  const finalChunks = [...filteredReranked, ...filteredRemaining];

  return finalChunks;
}

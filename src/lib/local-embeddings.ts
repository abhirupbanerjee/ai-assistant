/**
 * Local Embedding Models using @xenova/transformers
 *
 * Supports local embedding models that run directly in Node.js
 * without requiring external APIs. Uses the same pattern as
 * the reranker module for lazy loading and caching.
 *
 * Models:
 * - mxbai-embed-large: MixedBread Large (1024 dims, ~670MB, English-focused)
 * - bge-m3: BGE-M3 (1024 dims, ~1.2GB, multilingual, 100+ languages)
 */

// Local model configurations
const LOCAL_MODELS: Record<string, { modelId: string; dimensions: number; maxTokens: number }> = {
  'mxbai-embed-large': {
    modelId: 'Xenova/mxbai-embed-large-v1',
    dimensions: 1024,
    maxTokens: 512,
  },
  'bge-m3': {
    modelId: 'Xenova/bge-m3',
    dimensions: 1024,
    maxTokens: 8192,
  },
} as const;

export type LocalEmbeddingModel = keyof typeof LOCAL_MODELS;

// Lazy-loaded embedding pipeline (same pattern as reranker)
let localEmbedder: Awaited<ReturnType<typeof import('@xenova/transformers').pipeline>> | null = null;
let currentModel: string | null = null;
let loadFailed = false;

/**
 * Check if a model ID is a local embedding model
 */
export function isLocalEmbeddingModel(model: string): model is LocalEmbeddingModel {
  return model in LOCAL_MODELS;
}

/**
 * Get the dimensions for a local embedding model
 */
export function getLocalModelDimensions(model: LocalEmbeddingModel): number {
  return LOCAL_MODELS[model]?.dimensions ?? 1024;
}

/**
 * Reset the local embedder state
 * Call this to retry loading after fixing issues
 */
export function resetLocalEmbedder(): void {
  localEmbedder = null;
  currentModel = null;
  loadFailed = false;
  console.log('[LocalEmbedding] Reset embedder state');
}

/**
 * Create embedding for a single text using local transformer model
 */
export async function createLocalEmbedding(
  text: string,
  model: LocalEmbeddingModel = 'mxbai-embed-large'
): Promise<number[]> {
  const embeddings = await createLocalEmbeddings([text], model);
  return embeddings[0];
}

/**
 * Create batch embeddings using local transformer model
 *
 * @param texts - Array of texts to embed
 * @param model - Local model to use (default: mxbai-embed-large)
 * @returns Array of embedding vectors
 */
export async function createLocalEmbeddings(
  texts: string[],
  model: LocalEmbeddingModel = 'mxbai-embed-large'
): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (loadFailed) {
    throw new Error('Local embedding model failed to load previously. Call resetLocalEmbedder() to retry.');
  }

  const modelConfig = LOCAL_MODELS[model];
  if (!modelConfig) {
    throw new Error(`Unknown local embedding model: ${model}`);
  }

  try {
    // Dynamic import for @xenova/transformers (same as reranker)
    const { pipeline, env } = await import('@xenova/transformers');

    // Configure cache directory from environment variable
    // This prevents EACCES errors when running as non-root in Docker
    env.cacheDir = process.env.TRANSFORMERS_CACHE || '/tmp/transformers_cache';
    env.allowLocalModels = false;

    // Load model if not loaded or different model requested
    if (!localEmbedder || currentModel !== model) {
      console.log(`[LocalEmbedding] Loading ${model} (first time may take a moment to download ${model === 'bge-m3' ? '~1.2GB' : '~670MB'})...`);

      localEmbedder = await pipeline(
        'feature-extraction',
        modelConfig.modelId,
        { quantized: true }
      );
      currentModel = model;

      console.log(`[LocalEmbedding] ${model} loaded successfully`);
    }

    // Type for feature extraction pipeline
    type FeatureExtractor = (
      text: string,
      options?: { pooling?: string; normalize?: boolean }
    ) => Promise<{ data: Float32Array }>;

    const extractor = localEmbedder as unknown as FeatureExtractor;
    const embeddings: number[][] = [];

    // Process texts in sequence (transformers.js handles batching internally)
    for (const text of texts) {
      try {
        // Truncate to model's max tokens (approximate: 4 chars per token)
        const maxChars = modelConfig.maxTokens * 4;
        const truncatedText = text.slice(0, maxChars);

        const output = await extractor(truncatedText, {
          pooling: 'mean',
          normalize: true,
        });

        embeddings.push(Array.from(output.data));
      } catch (textError) {
        console.warn('[LocalEmbedding] Error embedding text, using zero vector:', textError);
        // Return zero vector on error to maintain array alignment
        embeddings.push(new Array(modelConfig.dimensions).fill(0));
      }
    }

    console.log(`[LocalEmbedding] Generated ${embeddings.length} embeddings with ${model}`);
    return embeddings;
  } catch (error) {
    loadFailed = true;
    console.error('[LocalEmbedding] Failed to load model:', error);
    throw error;
  }
}

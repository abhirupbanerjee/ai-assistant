/**
 * Vector Store Factory
 *
 * Provides a unified interface for vector store operations with support for
 * multiple backends (ChromaDB, Qdrant). Provider is selected via environment
 * variable and cached for the lifetime of the process.
 */

import type {
  VectorStoreClient,
  VectorStoreProvider,
  CollectionNameHelpers,
  VectorStoreHealthResult,
  VectorStoreStats,
} from './types';
import { ChromaDBVectorStore, chromadbCollectionNames } from './chromadb-adapter';
import { QdrantVectorStore, qdrantCollectionNames } from './qdrant';

// Cached instances
let vectorStore: VectorStoreClient | null = null;
let currentProvider: VectorStoreProvider | null = null;
let connectionPromise: Promise<VectorStoreClient> | null = null;

/**
 * Get the configured vector store provider from environment
 */
export function getVectorStoreProvider(): VectorStoreProvider {
  const provider = process.env.VECTOR_STORE_PROVIDER || 'chromadb';
  if (provider === 'chromadb' || provider === 'qdrant') {
    return provider;
  }
  console.warn(`[VectorStore] Unknown provider "${provider}", defaulting to chromadb`);
  return 'chromadb';
}

/**
 * Get or create the vector store client singleton
 *
 * This function handles connection initialization and caching.
 * The client is created on first call and reused for subsequent calls.
 */
export async function getVectorStore(): Promise<VectorStoreClient> {
  // Return existing connected client
  if (vectorStore) {
    return vectorStore;
  }

  // Return existing connection promise to prevent race conditions
  if (connectionPromise) {
    return connectionPromise;
  }

  // Create new connection promise
  connectionPromise = (async () => {
    currentProvider = getVectorStoreProvider();

    const store = currentProvider === 'qdrant'
      ? new QdrantVectorStore()
      : new ChromaDBVectorStore();

    await store.connect();
    console.log(`[VectorStore] Ready (provider: ${currentProvider})`);

    vectorStore = store;
    return store;
  })();

  return connectionPromise;
}

/**
 * Get the collection name helpers for the current provider
 */
export function getCollectionNames(): CollectionNameHelpers {
  const provider = currentProvider || getVectorStoreProvider();
  return provider === 'qdrant' ? qdrantCollectionNames : chromadbCollectionNames;
}

/**
 * Check the health of the vector store
 */
export async function checkVectorStoreHealth(): Promise<VectorStoreHealthResult> {
  const provider = currentProvider || getVectorStoreProvider();
  try {
    const store = await getVectorStore();
    const healthy = await store.healthCheck();
    return { provider, healthy };
  } catch (error) {
    return {
      provider,
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get statistics about the vector store
 */
export async function getVectorStoreStats(): Promise<VectorStoreStats> {
  const provider = currentProvider || getVectorStoreProvider();
  const store = await getVectorStore();

  const collectionNames = await store.listCollections();
  const collections = await Promise.all(
    collectionNames.map(async name => ({
      name,
      count: await store.getCollectionCount(name),
    }))
  );

  const totalVectors = collections.reduce((sum, c) => sum + c.count, 0);

  return {
    provider,
    collections,
    totalVectors,
  };
}

/**
 * Reset the vector store connection (for testing or reconfiguration)
 *
 * Note: This does NOT change the provider - that requires a restart
 */
export async function resetVectorStoreConnection(): Promise<void> {
  if (vectorStore) {
    await vectorStore.disconnect();
    vectorStore = null;
    connectionPromise = null;
    console.log('[VectorStore] Connection reset');
  }
}

// Re-export types and helpers
export * from './types';
export { chromadbCollectionNames } from './chromadb-adapter';
export { qdrantCollectionNames } from './qdrant';

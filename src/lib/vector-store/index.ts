/**
 * Vector Store Factory
 *
 * Provides a unified interface for vector store operations using Qdrant.
 * Client is cached for the lifetime of the process.
 */

import type {
  VectorStoreClient,
  VectorStoreProvider,
  CollectionNameHelpers,
  VectorStoreHealthResult,
  VectorStoreStats,
} from './types';
import { QdrantVectorStore, qdrantCollectionNames } from './qdrant';

// Cached instances
let vectorStore: VectorStoreClient | null = null;
let connectionPromise: Promise<VectorStoreClient> | null = null;

/**
 * Get the configured vector store provider from environment
 */
export function getVectorStoreProvider(): VectorStoreProvider {
  return 'qdrant';
}

/**
 * Get or create the vector store client singleton
 */
export async function getVectorStore(): Promise<VectorStoreClient> {
  if (vectorStore) {
    return vectorStore;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    const store = new QdrantVectorStore();
    await store.connect();
    console.log('[VectorStore] Ready (provider: qdrant)');
    vectorStore = store;
    return store;
  })();

  return connectionPromise;
}

/**
 * Get the collection name helpers
 */
export function getCollectionNames(): CollectionNameHelpers {
  return qdrantCollectionNames;
}

/**
 * Check the health of the vector store
 */
export async function checkVectorStoreHealth(): Promise<VectorStoreHealthResult> {
  try {
    const store = await getVectorStore();
    const healthy = await store.healthCheck();
    return { provider: 'qdrant', healthy };
  } catch (error) {
    return {
      provider: 'qdrant',
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get statistics about the vector store
 */
export async function getVectorStoreStats(): Promise<VectorStoreStats> {
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
    provider: 'qdrant',
    collections,
    totalVectors,
  };
}

/**
 * Reset the vector store connection (for testing or reconfiguration)
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
export { qdrantCollectionNames } from './qdrant';

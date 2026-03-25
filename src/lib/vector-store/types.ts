/**
 * Vector Store Abstraction Layer - Type Definitions
 *
 * Provides a unified interface for different vector store backends
 * (Qdrant) for vector similarity search.
 */

import type { ChunkMetadata } from '@/types';

export type VectorStoreProvider = 'qdrant';

/**
 * Standardized query result format across all vector store providers
 */
export interface VectorQueryResult {
  ids: string[];
  documents: string[];
  metadatas: ChunkMetadata[];
  /** Similarity scores (0-1, higher = more similar) */
  scores: number[];
}

/**
 * Unified interface for vector store operations
 */
export interface VectorStoreClient {
  /**
   * Initialize connection to the vector store
   */
  connect(): Promise<void>;

  /**
   * Close connection to the vector store
   */
  disconnect(): Promise<void>;

  /**
   * Check if the vector store is healthy and responsive
   */
  healthCheck(): Promise<boolean>;

  // ============ Collection Operations ============

  /**
   * Create a new collection (if it doesn't exist)
   */
  createCollection(name: string): Promise<void>;

  /**
   * Delete a collection
   */
  deleteCollection(name: string): Promise<void>;

  /**
   * List all collections
   */
  listCollections(): Promise<string[]>;

  /**
   * Check if a collection exists
   */
  collectionExists(name: string): Promise<boolean>;

  /**
   * Get the number of vectors in a collection
   */
  getCollectionCount(name: string): Promise<number>;

  // ============ Document Operations ============

  /**
   * Add documents to a collection
   */
  addDocuments(
    collectionName: string,
    ids: string[],
    embeddings: number[][],
    documents: string[],
    metadatas: ChunkMetadata[]
  ): Promise<void>;

  /**
   * Delete documents by IDs from a collection
   */
  deleteDocuments(collectionName: string, ids: string[]): Promise<void>;

  /**
   * Delete documents by filter from a collection
   * @returns Number of documents deleted
   */
  deleteDocumentsByFilter(
    collectionName: string,
    filter: Record<string, unknown>
  ): Promise<number>;

  /**
   * Delete documents from ALL collections (for global document removal)
   */
  deleteDocumentsFromAllCollections(ids: string[]): Promise<void>;

  // ============ Query Operations ============

  /**
   * Query a single collection
   */
  query(
    collectionName: string,
    queryEmbedding: number[],
    nResults: number,
    filter?: Record<string, unknown>
  ): Promise<VectorQueryResult>;

  /**
   * Query multiple collections and merge results (deduplicated, sorted by score)
   */
  queryMultipleCollections(
    collectionNames: string[],
    queryEmbedding: number[],
    nResults: number,
    filter?: Record<string, unknown>
  ): Promise<VectorQueryResult>;
}

/**
 * Collection name helper functions
 */
export interface CollectionNameHelpers {
  /** Get collection name for a category slug */
  forCategory: (slug: string) => string;
  /** Extract category slug from collection name */
  toSlug: (collectionName: string) => string;
  /** Check if a collection name is a category collection */
  isCategory: (name: string) => boolean;
  /** Global documents collection name */
  global: string;
  /** Legacy collection name (for backward compatibility) */
  legacy: string;
}

/**
 * Vector store health check result
 */
export interface VectorStoreHealthResult {
  provider: VectorStoreProvider;
  healthy: boolean;
  error?: string;
}

/**
 * Vector store statistics
 */
export interface VectorStoreStats {
  provider: VectorStoreProvider;
  collections: Array<{ name: string; count: number }>;
  totalVectors: number;
}

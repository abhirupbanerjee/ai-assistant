/**
 * ChromaDB Adapter for Vector Store Abstraction Layer
 *
 * Wraps the existing chroma.ts module to implement the VectorStoreClient interface.
 */

import type { VectorStoreClient, VectorQueryResult, CollectionNameHelpers } from './types';
import type { ChunkMetadata } from '@/types';
import {
  getChromaClient,
  getCollectionByName,
  addDocumentsToCollection,
  queryCollection,
  queryCategories,
  listCategoryCollections,
  deleteCategoryCollection,
  deleteDocumentsFromCollection,
  deleteDocumentsFromAllCollections as chromaDeleteFromAll,
  getCollectionCount,
  collectionNames as chromaCollectionNames,
  clearCollectionCache,
} from '../chroma';

/**
 * Collection name helpers for ChromaDB
 */
export const chromadbCollectionNames: CollectionNameHelpers = {
  forCategory: chromaCollectionNames.forCategory,
  toSlug: chromaCollectionNames.toSlug,
  isCategory: chromaCollectionNames.isCategory,
  global: chromaCollectionNames.global,
  legacy: chromaCollectionNames.legacy,
};

/**
 * ChromaDB implementation of VectorStoreClient
 */
export class ChromaDBVectorStore implements VectorStoreClient {
  async connect(): Promise<void> {
    const client = await getChromaClient();
    await client.heartbeat();
    console.log('[ChromaDB] Connected');
  }

  async disconnect(): Promise<void> {
    clearCollectionCache();
    console.log('[ChromaDB] Disconnected (cache cleared)');
  }

  async healthCheck(): Promise<boolean> {
    try {
      const client = await getChromaClient();
      await client.heartbeat();
      return true;
    } catch {
      return false;
    }
  }

  // ============ Collection Operations ============

  async createCollection(name: string): Promise<void> {
    await getCollectionByName(name);
  }

  async deleteCollection(name: string): Promise<void> {
    // Check if it's a category collection
    if (chromaCollectionNames.isCategory(name)) {
      await deleteCategoryCollection(chromaCollectionNames.toSlug(name));
    } else {
      // For non-category collections, delete directly
      const client = await getChromaClient();
      try {
        await client.deleteCollection({ name });
      } catch {
        // Collection may not exist
      }
    }
  }

  async listCollections(): Promise<string[]> {
    const client = await getChromaClient();
    const collections = await client.listCollections();
    return collections as string[];
  }

  async collectionExists(name: string): Promise<boolean> {
    const collections = await this.listCollections();
    return collections.includes(name);
  }

  async getCollectionCount(name: string): Promise<number> {
    return getCollectionCount(name);
  }

  // ============ Document Operations ============

  async addDocuments(
    collectionName: string,
    ids: string[],
    embeddings: number[][],
    documents: string[],
    metadatas: ChunkMetadata[]
  ): Promise<void> {
    await addDocumentsToCollection(collectionName, ids, embeddings, documents, metadatas);
  }

  async deleteDocuments(collectionName: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await deleteDocumentsFromCollection(collectionName, ids);
  }

  async deleteDocumentsByFilter(
    collectionName: string,
    filter: Record<string, unknown>
  ): Promise<number> {
    const collection = await getCollectionByName(collectionName);
    const countBefore = await collection.count();
    await collection.delete({ where: filter });
    const countAfter = await collection.count();
    return countBefore - countAfter;
  }

  async deleteDocumentsFromAllCollections(ids: string[]): Promise<void> {
    await chromaDeleteFromAll(ids);
  }

  // ============ Query Operations ============

  async query(
    collectionName: string,
    queryEmbedding: number[],
    nResults: number,
    filter?: Record<string, unknown>
  ): Promise<VectorQueryResult> {
    const result = await queryCollection(collectionName, queryEmbedding, nResults, filter);
    return {
      ids: result.ids,
      documents: result.documents,
      metadatas: result.metadatas,
      // Convert distances to scores (ChromaDB uses cosine distance, lower = more similar)
      // Score = 1 - distance for cosine similarity
      scores: result.distances.map(d => 1 - d),
    };
  }

  async queryMultipleCollections(
    collectionNames: string[],
    queryEmbedding: number[],
    nResults: number,
    filter?: Record<string, unknown>
  ): Promise<VectorQueryResult> {
    // Extract category slugs from collection names
    const categorySlugs = collectionNames
      .filter(name => chromaCollectionNames.isCategory(name))
      .map(name => chromaCollectionNames.toSlug(name));

    // If no category collections, query each collection individually
    if (categorySlugs.length === 0) {
      // Query each collection and merge
      const allResults: Array<{
        id: string;
        document: string;
        metadata: ChunkMetadata;
        score: number;
      }> = [];

      for (const name of collectionNames) {
        try {
          const result = await this.query(name, queryEmbedding, nResults, filter);
          for (let i = 0; i < result.ids.length; i++) {
            allResults.push({
              id: result.ids[i],
              document: result.documents[i],
              metadata: result.metadatas[i],
              score: result.scores[i],
            });
          }
        } catch {
          // Collection may not exist
        }
      }

      // Deduplicate and sort
      const uniqueResults = new Map<string, typeof allResults[0]>();
      for (const result of allResults) {
        const existing = uniqueResults.get(result.id);
        if (!existing || result.score > existing.score) {
          uniqueResults.set(result.id, result);
        }
      }

      const sorted = Array.from(uniqueResults.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, nResults);

      return {
        ids: sorted.map(r => r.id),
        documents: sorted.map(r => r.document),
        metadatas: sorted.map(r => r.metadata),
        scores: sorted.map(r => r.score),
      };
    }

    // Use existing queryCategories function (includes global collection automatically)
    const result = await queryCategories(categorySlugs, queryEmbedding, nResults, filter);
    return {
      ids: result.ids,
      documents: result.documents,
      metadatas: result.metadatas,
      scores: result.distances.map(d => 1 - d),
    };
  }
}

/**
 * Singleton instance
 */
export const chromaStore = new ChromaDBVectorStore();

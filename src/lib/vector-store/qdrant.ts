/**
 * Qdrant Vector Store Implementation
 *
 * Implements VectorStoreClient interface for Qdrant vector database.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import * as crypto from 'crypto';
import type { VectorStoreClient, VectorQueryResult, CollectionNameHelpers } from './types';
import type { ChunkMetadata } from '@/types';
import { getEmbeddingSettings } from '../db/compat/config';

// Collection naming conventions
const CATEGORY_PREFIX = 'category_';
const GLOBAL_COLLECTION = 'global_documents';
const LEGACY_COLLECTION = 'organizational_documents';

// Default vector size (used as fallback)
const DEFAULT_VECTOR_SIZE = 3072;

/**
 * Get the current vector size from embedding settings
 * Dynamically returns the dimensions of the configured embedding model
 */
async function getVectorSize(): Promise<number> {
  try {
    const settings = await getEmbeddingSettings();
    return settings.dimensions || DEFAULT_VECTOR_SIZE;
  } catch {
    // If settings can't be loaded (e.g., during initialization), use default
    return DEFAULT_VECTOR_SIZE;
  }
}

/**
 * Collection name helpers for Qdrant
 */
export const qdrantCollectionNames: CollectionNameHelpers = {
  forCategory: (slug: string): string => `${CATEGORY_PREFIX}${slug}`,
  toSlug: (name: string): string => name.replace(CATEGORY_PREFIX, ''),
  isCategory: (name: string): boolean => name.startsWith(CATEGORY_PREFIX),
  global: GLOBAL_COLLECTION,
  legacy: LEGACY_COLLECTION,
};

// Singleton client
let client: QdrantClient | null = null;

/**
 * Get or create the Qdrant client
 */
function getClient(): QdrantClient {
  if (!client) {
    const host = process.env.QDRANT_HOST || 'localhost';
    const port = parseInt(process.env.QDRANT_PORT || '6333', 10);
    const apiKey = process.env.QDRANT_API_KEY || undefined;

    client = new QdrantClient({
      host,
      port,
      apiKey: apiKey || undefined,
    });
  }
  return client;
}

/**
 * Convert a string ID to UUID format (Qdrant requires UUIDs)
 */
function stringToUuid(str: string): string {
  const hash = crypto.createHash('md5').update(str).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Convert a filter object to Qdrant filter format
 */
function convertFilter(filter: Record<string, unknown>): { must?: Array<Record<string, unknown>> } {
  const must: Array<Record<string, unknown>> = [];

  for (const [key, value] of Object.entries(filter)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      must.push({
        key,
        match: { value },
      });
    } else if (Array.isArray(value)) {
      must.push({
        key,
        match: { any: value },
      });
    }
  }

  return must.length > 0 ? { must } : {};
}

/**
 * Qdrant implementation of VectorStoreClient
 */
export class QdrantVectorStore implements VectorStoreClient {
  async connect(): Promise<void> {
    const qdrant = getClient();
    const collections = await qdrant.getCollections();
    console.log(`[Qdrant] Connected. Collections: ${collections.collections.length}`);
  }

  async disconnect(): Promise<void> {
    client = null;
    console.log('[Qdrant] Disconnected');
  }

  async healthCheck(): Promise<boolean> {
    try {
      await getClient().getCollections();
      return true;
    } catch {
      return false;
    }
  }

  // ============ Collection Operations ============

  async createCollection(name: string): Promise<void> {
    const qdrant = getClient();

    // Check if collection already exists
    if (await this.collectionExists(name)) {
      return;
    }

    // Get dynamic vector size from embedding settings
    const vectorSize = await getVectorSize();

    await qdrant.createCollection(name, {
      vectors: {
        size: vectorSize,
        distance: 'Cosine',
      },
      optimizers_config: {
        default_segment_number: 2,
        indexing_threshold: 1000,
      },
      quantization_config: {
        scalar: {
          type: 'int8',
          quantile: 0.99,
          always_ram: true,
        },
      },
    });

    // Create payload indexes for common filter fields
    await qdrant.createPayloadIndex(name, {
      field_name: 'documentId',
      field_schema: 'keyword',
    });
    await qdrant.createPayloadIndex(name, {
      field_name: 'documentName',
      field_schema: 'keyword',
    });

    console.log(`[Qdrant] Created collection: ${name} (${vectorSize} dimensions)`);
  }

  async deleteCollection(name: string): Promise<void> {
    try {
      await getClient().deleteCollection(name);
      console.log(`[Qdrant] Deleted collection: ${name}`);
    } catch {
      // Collection may not exist
    }
  }

  async listCollections(): Promise<string[]> {
    const response = await getClient().getCollections();
    return response.collections.map(c => c.name);
  }

  async collectionExists(name: string): Promise<boolean> {
    const collections = await this.listCollections();
    return collections.includes(name);
  }

  async getCollectionCount(name: string): Promise<number> {
    try {
      const info = await getClient().getCollection(name);
      return info.points_count || 0;
    } catch {
      return 0;
    }
  }

  // ============ Document Operations ============

  async addDocuments(
    collectionName: string,
    ids: string[],
    embeddings: number[][],
    documents: string[],
    metadatas: ChunkMetadata[]
  ): Promise<void> {
    // Ensure collection exists
    await this.createCollection(collectionName);

    const qdrant = getClient();

    // Convert to Qdrant point format
    const points = ids.map((id, i) => ({
      id: stringToUuid(id),
      vector: embeddings[i],
      payload: {
        ...metadatas[i],
        text: documents[i],
        originalId: id, // Store original ID for retrieval
      },
    }));

    // Batch upsert (100 points at a time)
    const batchSize = 100;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      await qdrant.upsert(collectionName, {
        wait: true,
        points: batch,
      });
    }

    console.log(`[Qdrant] Added ${ids.length} documents to ${collectionName}`);
  }

  async deleteDocuments(collectionName: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    // Skip if collection doesn't exist (nothing to delete)
    if (!(await this.collectionExists(collectionName))) {
      return;
    }

    const qdrant = getClient();

    // Delete by original ID filter
    await qdrant.delete(collectionName, {
      wait: true,
      filter: {
        must: [
          {
            key: 'originalId',
            match: { any: ids },
          },
        ],
      },
    });

    console.log(`[Qdrant] Deleted ${ids.length} documents from ${collectionName}`);
  }

  async deleteDocumentsByFilter(
    collectionName: string,
    filter: Record<string, unknown>
  ): Promise<number> {
    // Skip if collection doesn't exist (nothing to delete)
    if (!(await this.collectionExists(collectionName))) {
      return 0;
    }

    const countBefore = await this.getCollectionCount(collectionName);

    await getClient().delete(collectionName, {
      wait: true,
      filter: convertFilter(filter),
    });

    const countAfter = await this.getCollectionCount(collectionName);
    return countBefore - countAfter;
  }

  async deleteDocumentsFromAllCollections(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const collections = await this.listCollections();

    for (const name of collections) {
      try {
        await this.deleteDocuments(name, ids);
      } catch {
        // Collection may have issues
      }
    }
  }

  // ============ Query Operations ============

  async query(
    collectionName: string,
    queryEmbedding: number[],
    nResults: number,
    filter?: Record<string, unknown>
  ): Promise<VectorQueryResult> {
    // Check if collection exists
    if (!(await this.collectionExists(collectionName))) {
      console.log(`[Qdrant] Collection ${collectionName} does not exist, returning empty results`);
      return { ids: [], documents: [], metadatas: [], scores: [] };
    }

    const qdrant = getClient();

    const searchParams: Parameters<typeof qdrant.search>[1] = {
      vector: queryEmbedding,
      limit: nResults,
      with_payload: true,
      score_threshold: 0.3, // Minimum similarity threshold
    };

    if (filter && Object.keys(filter).length > 0) {
      searchParams.filter = convertFilter(filter);
    }

    const results = await qdrant.search(collectionName, searchParams);

    console.log(`[Qdrant] Query to ${collectionName} returned ${results.length} results`);

    return {
      ids: results.map(r => (r.payload?.originalId as string) || String(r.id)),
      documents: results.map(r => (r.payload?.text as string) || ''),
      metadatas: results.map(r => {
        const payload = r.payload || {};
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { text, originalId, ...metadata } = payload as Record<string, unknown>;
        return metadata as unknown as ChunkMetadata;
      }),
      scores: results.map(r => r.score),
    };
  }

  async queryMultipleCollections(
    collectionNames: string[],
    queryEmbedding: number[],
    nResults: number,
    filter?: Record<string, unknown>
  ): Promise<VectorQueryResult> {
    // Query all collections in parallel
    const results = await Promise.all(
      collectionNames.map(name => this.query(name, queryEmbedding, nResults, filter))
    );

    // Merge and deduplicate
    const merged = new Map<string, {
      id: string;
      document: string;
      metadata: ChunkMetadata;
      score: number;
    }>();

    for (const result of results) {
      for (let i = 0; i < result.ids.length; i++) {
        const id = result.ids[i];
        const existing = merged.get(id);
        // Keep the highest score for duplicate IDs
        if (!existing || result.scores[i] > existing.score) {
          merged.set(id, {
            id,
            document: result.documents[i],
            metadata: result.metadatas[i],
            score: result.scores[i],
          });
        }
      }
    }

    // Sort by score (descending) and take top N
    const sorted = Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, nResults);

    return {
      ids: sorted.map(r => r.id),
      documents: sorted.map(r => r.document),
      metadatas: sorted.map(r => r.metadata),
      scores: sorted.map(r => r.score),
    };
  }
}

/**
 * Singleton instance
 */
export const qdrantStore = new QdrantVectorStore();

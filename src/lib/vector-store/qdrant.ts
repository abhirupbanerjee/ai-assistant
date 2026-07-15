/**
 * Qdrant Vector Store Implementation
 *
 * Implements VectorStoreClient interface for Qdrant vector database.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import * as crypto from 'crypto';
import type { VectorStoreClient, VectorQueryResult, CollectionNameHelpers } from './types';
import type { ChunkMetadata } from '@/types';
import { getEmbeddingSettings, getRagSettings } from '../db/compat/config';

// Collection naming conventions
const CATEGORY_PREFIX = 'category_';
const GLOBAL_COLLECTION = 'global_documents';
const LEGACY_COLLECTION = 'organizational_documents';

// Default vector size (used as fallback)
const DEFAULT_VECTOR_SIZE = 3072;

// RRF constant for hybrid search merging
const RRF_K = 60;

/**
 * Tokenize text and compute sparse vector representation for BM25-style search.
 * Qdrant handles IDF server-side when modifier: 'idf' is set on the sparse vector.
 * We only need to send term frequencies (TF).
 */
function tokenizeForSparseVector(text: string): { indices: number[]; values: number[] } {
  const lower = text.toLowerCase();
  // Extract alphanumeric tokens (includes numbers for section codes like 4.2.1)
  const tokens = lower.match(/\b[a-z0-9]+(?:\.[a-z0-9]+)*\b/g) || [];

  const freq = new Map<number, number>();
  for (const token of tokens) {
    // FNV-1a hash to stable integer index
    let hash = 0x811c9dc5;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    // Use positive 32-bit integer as index
    const idx = Math.abs(hash) % 2147483647;
    freq.set(idx, (freq.get(idx) || 0) + 1);
  }

  const indices: number[] = [];
  const values: number[] = [];
  for (const [idx, count] of freq) {
    indices.push(idx);
    values.push(count);
  }

  return { indices, values };
}

/**
 * Merge two ranked result lists using Reciprocal Rank Fusion (RRF).
 * k=60 is the standard constant.
 */
type SearchResultPoint = Awaited<ReturnType<QdrantClient['search']>>[number];

function mergeWithRRF(
  denseResults: SearchResultPoint[],
  sparseResults: SearchResultPoint[],
  k: number = RRF_K
): SearchResultPoint[] {
  const scores = new Map<string | number, number>();

  // Helper to accumulate RRF score by rank
  const addRanked = (results: SearchResultPoint[]) => {
    for (let rank = 0; rank < results.length; rank++) {
      const id = results[rank].id;
      const score = 1 / (k + rank + 1);
      scores.set(id, (scores.get(id) || 0) + score);
    }
  };

  addRanked(denseResults);
  addRanked(sparseResults);

  // Deduplicate and sort by combined RRF score
  const seen = new Set<string | number>();
  const merged: SearchResultPoint[] = [];

  for (const results of [denseResults, sparseResults]) {
    for (const r of results) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push({
          ...r,
          score: scores.get(r.id) || 0,
        });
      }
    }
  }

  merged.sort((a, b) => b.score - a.score);
  return merged;
}

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
      sparse_vectors: {
        text: {
          index: {
            on_disk: false,
          },
          modifier: 'idf',
        },
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

    // CRITICAL FIX: Validate embedding dimensions match collection schema
    // Silent dimension mismatch causes near-zero similarity scores with no error
    if (embeddings.length > 0) {
      const qdrant = getClient();
      const collectionInfo = await qdrant.getCollection(collectionName);
      const vectorConfig = collectionInfo.config.params.vectors;

      if (!vectorConfig || typeof vectorConfig !== 'object' || !('size' in vectorConfig)) {
        throw new Error(
          `Could not determine vector size for collection "${collectionName}". ` +
          `Collection may be misconfigured.`
        );
      }

      const expectedSize = vectorConfig.size;
      const actualSize = embeddings[0].length;

      if (actualSize !== expectedSize) {
        throw new Error(
          `Vector dimension mismatch for collection "${collectionName}": ` +
          `expected ${expectedSize} dimensions, got ${actualSize}. ` +
          `This indicates the embedding model has changed since collection creation. ` +
          `Delete and recreate the collection to fix this.`
        );
      }
    }

    const qdrant = getClient();

    // Check if hybrid search is enabled to decide whether to generate sparse vectors
    let hybridEnabled = false;
    try {
      const ragSettings = await getRagSettings();
      hybridEnabled = ragSettings.hybridSearchEnabled;
    } catch {
      // If settings can't be loaded, skip sparse vectors
    }

    // Convert to Qdrant point format
    const points = ids.map((id, i) => ({
      id: stringToUuid(id),
      vector: embeddings[i],
      ...(hybridEnabled
        ? { sparse_vectors: { text: tokenizeForSparseVector(documents[i]) } }
        : {}),
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

  async getDocumentChunksByDocId(
    collectionName: string,
    documentId: string
  ): Promise<{ id: string; vector: number[]; text: string; metadata: ChunkMetadata }[]> {
    if (!(await this.collectionExists(collectionName))) {
      return [];
    }

    const qdrant = getClient();
    const results: { id: string; vector: number[]; text: string; metadata: ChunkMetadata }[] = [];
    let offset: string | number | undefined = undefined;

    do {
      const response = await qdrant.scroll(collectionName, {
        filter: {
          must: [{ key: 'documentId', match: { value: documentId } }],
        },
        with_vector: true,
        with_payload: true,
        limit: 100,
        ...(offset !== undefined ? { offset } : {}),
      });

      for (const point of response.points) {
        const payload = point.payload || {};
        const { text, originalId, ...metadata } = payload as Record<string, unknown>;
        results.push({
          id: (originalId as string) || String(point.id),
          vector: point.vector as number[],
          text: (text as string) || '',
          metadata: metadata as unknown as ChunkMetadata,
        });
      }

      const next = response.next_page_offset;
      offset = (typeof next === 'string' || typeof next === 'number') ? next : undefined;
    } while (offset !== undefined);

    return results;
  }

  /**
   * Fetch all chunks for a document from a collection by documentName payload filter.
   * Used for full-document retrieval when a user references a KB document by name
   * (e.g., "summarise the Q3 report" where "Q3_Report.pdf" is in the knowledge base).
   * Returns chunks without vectors for efficiency (context injection, not re-embedding).
   * Chunks are sorted by chunkIndex then pageNumber to preserve document order.
   */
  async getDocumentChunksByDocName(
    collectionName: string,
    documentName: string
  ): Promise<{ id: string; text: string; metadata: ChunkMetadata }[]> {
    if (!(await this.collectionExists(collectionName))) {
      return [];
    }

    const qdrant = getClient();
    const results: { id: string; text: string; metadata: ChunkMetadata }[] = [];
    let offset: string | number | undefined = undefined;

    do {
      const response = await qdrant.scroll(collectionName, {
        filter: {
          must: [{ key: 'documentName', match: { value: documentName } }],
        },
        with_vector: false,
        with_payload: true,
        limit: 100,
        ...(offset !== undefined ? { offset } : {}),
      });

      for (const point of response.points) {
        const payload = point.payload || {};
        const { text, originalId, ...metadata } = payload as Record<string, unknown>;
        results.push({
          id: (originalId as string) || String(point.id),
          text: (text as string) || '',
          metadata: metadata as unknown as ChunkMetadata,
        });
      }

      const next = response.next_page_offset;
      offset = (typeof next === 'string' || typeof next === 'number') ? next : undefined;
    } while (offset !== undefined);

    // Sort by chunkIndex (falling back to pageNumber) to preserve document order
    results.sort((a, b) => {
      const aIdx = a.metadata.chunkIndex ?? 0;
      const bIdx = b.metadata.chunkIndex ?? 0;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return (a.metadata.pageNumber ?? 1) - (b.metadata.pageNumber ?? 1);
    });

    return results;
  }

  // ============ Query Operations ============

  async query(
    collectionName: string,
    queryEmbedding: number[],
    nResults: number,
    filter?: Record<string, unknown>,
    scoreThreshold?: number,
    hybridSearch?: boolean,
    queryText?: string
  ): Promise<VectorQueryResult> {
    // Check if collection exists — silently return empty results.
    // Missing collections are expected when no documents have been ingested
    // into global_documents or organizational_documents yet.
    if (!(await this.collectionExists(collectionName))) {
      return { ids: [], documents: [], metadatas: [], scores: [] };
    }

    const qdrant = getClient();

    // Use provided threshold or default to 0.3
    // Note: This is a pre-filter threshold. The RAG layer applies its own similarityThreshold
    // to ensure consistency between Qdrant's filtering and RAG's filtering.
    const threshold = scoreThreshold ?? 0.3;

    const searchParams: Parameters<typeof qdrant.search>[1] = {
      vector: queryEmbedding,
      limit: nResults,
      with_payload: true,
      score_threshold: threshold,
    };

    if (filter && Object.keys(filter).length > 0) {
      searchParams.filter = convertFilter(filter);
    }

    const denseResults = await qdrant.search(collectionName, searchParams);

    let mergedResults = denseResults;

    if (hybridSearch && queryText) {
      try {
        const sparseVec = tokenizeForSparseVector(queryText);
        // Build sparse search params with NamedSparseVector
        const sparseSearchParams = {
          vector: {
            name: 'text',
            vector: sparseVec,
          },
          limit: nResults,
          with_payload: true,
          score_threshold: 0,
        };

        if (filter && Object.keys(filter).length > 0) {
          (sparseSearchParams as Record<string, unknown>).filter = convertFilter(filter);
        }

        const sparseResults = await qdrant.search(collectionName, sparseSearchParams);

        mergedResults = mergeWithRRF(denseResults, sparseResults);
        console.log(`[Qdrant] Hybrid query to ${collectionName} returned ${denseResults.length} dense + ${sparseResults.length} sparse = ${mergedResults.length} merged results`);
      } catch (err) {
        // Collection may not have sparse vectors (old collection) — use dense only
        console.warn(`[Qdrant] Sparse search failed for ${collectionName}, falling back to dense only:`, err instanceof Error ? err.message : err);
      }
    }

    return {
      ids: mergedResults.map(r => (r.payload?.originalId as string) || String(r.id)),
      documents: mergedResults.map(r => (r.payload?.text as string) || ''),
      metadatas: mergedResults.map(r => {
        const payload = r.payload || {};
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { text, originalId, ...metadata } = payload as Record<string, unknown>;
        return metadata as unknown as ChunkMetadata;
      }),
      scores: mergedResults.map(r => r.score),
    };
  }

  async queryMultipleCollections(
    collectionNames: string[],
    queryEmbedding: number[],
    nResults: number,
    filter?: Record<string, unknown>,
    scoreThreshold?: number,
    hybridSearch?: boolean,
    queryText?: string
  ): Promise<VectorQueryResult> {
    // Query all collections in parallel
    const results = await Promise.all(
      collectionNames.map(name => this.query(name, queryEmbedding, nResults, filter, scoreThreshold, hybridSearch, queryText))
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

  /**
   * Backfill sparse vectors for all points in a collection that lack them.
   * Returns the count of points updated.
   *
   * Old collections or documents ingested before hybridSearchEnabled was turned on
   * will not have sparse vectors. This method scans all points and generates sparse
   * vectors from their text payloads, enabling hybrid (dense + sparse) search.
   */
  async backfillSparseVectors(collectionName: string): Promise<number> {
    if (!(await this.collectionExists(collectionName))) {
      console.log(`[Qdrant] Collection ${collectionName} does not exist, skipping sparse backfill`);
      return 0;
    }

    const qdrant = getClient();
    let updatedCount = 0;
    let offset: string | number | undefined = undefined;

    do {
      const response = await qdrant.scroll(collectionName, {
        with_vector: false,
        with_payload: true,
        limit: 100,
        ...(offset !== undefined ? { offset } : {}),
      });

      for (const point of response.points) {
        // Skip points that already have sparse vectors
        const vectorAny = point.vector as Record<string, unknown> | null;
        if (vectorAny && typeof vectorAny === 'object' && 'text' in vectorAny) {
          continue;
        }

        const payload = point.payload || {};
        const text = (payload.text as string) || '';
        if (!text) continue;

        const sparseVec = tokenizeForSparseVector(text);
        try {
          // Qdrant JS client types don't expose sparse_vectors in PointStruct,
          // but the REST API accepts it. Use type assertion to bypass TS check.
          await qdrant.upsert(collectionName, {
            wait: false,
            points: [{
              id: point.id,
              vector: point.vector || {},
              sparse_vectors: { text: sparseVec },
              payload: payload as Record<string, unknown>,
            } as any],
          });
          updatedCount++;
        } catch (err) {
          console.warn(`[Qdrant] Sparse backfill failed for point ${point.id} in ${collectionName}:`, err instanceof Error ? err.message : err);
        }
      }

      const next = response.next_page_offset;
      offset = (typeof next === 'string' || typeof next === 'number') ? next : undefined;
    } while (offset !== undefined);

    if (updatedCount > 0) {
      console.log(`[Qdrant] Backfilled sparse vectors for ${updatedCount} points in ${collectionName}`);
    }
    return updatedCount;
  }
}

/**
 * Singleton instance
 */
export const qdrantStore = new QdrantVectorStore();

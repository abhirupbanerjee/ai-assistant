/**
 * ChromaDB Client with Multi-Collection Support
 *
 * Each category maps to a separate ChromaDB collection.
 * Global documents are indexed into ALL category collections.
 */

import { ChromaClient, Metadata, IncludeEnum } from 'chromadb';
type Collection = Awaited<ReturnType<ChromaClient['getOrCreateCollection']>>;
import type { ChunkMetadata } from '@/types';

// Legacy collection name for backward compatibility
const LEGACY_COLLECTION_NAME = process.env.CHROMA_COLLECTION_NAME || 'organizational_documents';

// Global collection for documents that should be searchable from all categories
const GLOBAL_COLLECTION_NAME = 'global_documents';

// Category collection prefix
const CATEGORY_PREFIX = 'category_';

/**
 * Collection name helpers to centralize naming conventions
 */
export const collectionNames = {
  /** Get collection name for a category slug */
  forCategory: (slug: string): string => `${CATEGORY_PREFIX}${slug}`,
  /** Extract category slug from collection name */
  toSlug: (collectionName: string): string => collectionName.replace(CATEGORY_PREFIX, ''),
  /** Check if a collection name is a category collection */
  isCategory: (name: string): boolean => name.startsWith(CATEGORY_PREFIX),
  /** Global documents collection name */
  global: GLOBAL_COLLECTION_NAME,
  /** Legacy collection name */
  legacy: LEGACY_COLLECTION_NAME,
} as const;

let client: ChromaClient | null = null;
let connectionPromise: Promise<ChromaClient> | null = null;

// Cache for collections with size limit to prevent unbounded memory growth
const collectionCache: Map<string, Collection> = new Map();
const MAX_CACHED_COLLECTIONS = 50;

/**
 * Get or create the ChromaDB client
 */
export async function getChromaClient(): Promise<ChromaClient> {
  // Return existing client if already connected
  if (client) return client;

  // Return existing connection promise to prevent race conditions
  if (connectionPromise) return connectionPromise;

  // Create new connection promise
  connectionPromise = (async () => {
    const host = process.env.CHROMA_HOST || 'localhost';
    const port = process.env.CHROMA_PORT || '8000';
    const newClient = new ChromaClient({
      path: `http://${host}:${port}`,
    });

    // Verify connection with heartbeat
    try {
      await newClient.heartbeat();
    } catch (error) {
      connectionPromise = null;
      throw new Error(`ChromaDB connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    client = newClient;
    return newClient;
  })();

  return connectionPromise;
}

/**
 * Get or create a collection by name (category slug)
 */
export async function getCollectionByName(name: string): Promise<Collection> {
  const cached = collectionCache.get(name);
  if (cached) return cached;

  const chromaClient = await getChromaClient();
  const collection = await chromaClient.getOrCreateCollection({
    name,
    metadata: { 'hnsw:space': 'cosine' },
  });

  // Evict oldest entry if cache is full
  if (collectionCache.size >= MAX_CACHED_COLLECTIONS) {
    const firstKey = collectionCache.keys().next().value;
    if (firstKey) collectionCache.delete(firstKey);
  }

  collectionCache.set(name, collection);
  return collection;
}

/**
 * Get the legacy/default collection (for backward compatibility)
 */
export async function getCollection(): Promise<Collection> {
  return getCollectionByName(LEGACY_COLLECTION_NAME);
}

/**
 * Get the global documents collection
 */
export async function getGlobalCollection(): Promise<Collection> {
  return getCollectionByName(GLOBAL_COLLECTION_NAME);
}

/**
 * Create a collection for a new category
 */
export async function createCategoryCollection(categorySlug: string): Promise<Collection> {
  return getCollectionByName(collectionNames.forCategory(categorySlug));
}

/**
 * Delete a category collection
 */
export async function deleteCategoryCollection(categorySlug: string): Promise<void> {
  const name = collectionNames.forCategory(categorySlug);
  const chromaClient = await getChromaClient();

  try {
    await chromaClient.deleteCollection({ name });
    collectionCache.delete(name);
  } catch {
    // Collection may not exist, ignore error
  }
}

/**
 * List all category collections
 */
export async function listCategoryCollections(): Promise<string[]> {
  const chromaClient = await getChromaClient();
  const collections = await chromaClient.listCollections();
  const names = collections.map((c: { name: string } | string) =>
    typeof c === 'string' ? c : c.name
  );
  return names
    .filter(collectionNames.isCategory)
    .map(collectionNames.toSlug);
}

// ============ Document Operations ============

/**
 * Add documents to a specific collection
 */
export async function addDocumentsToCollection(
  collectionName: string,
  ids: string[],
  embeddings: number[][],
  documents: string[],
  metadatas: ChunkMetadata[]
): Promise<void> {
  const collection = await getCollectionByName(collectionName);
  await collection.add({
    ids,
    embeddings,
    documents,
    metadatas: metadatas as unknown as Metadata[],
  });
}

/**
 * Add documents to the legacy/default collection (backward compatibility)
 */
export async function addDocuments(
  ids: string[],
  embeddings: number[][],
  documents: string[],
  metadatas: ChunkMetadata[]
): Promise<void> {
  await addDocumentsToCollection(LEGACY_COLLECTION_NAME, ids, embeddings, documents, metadatas);
}

/**
 * Add documents to category collections
 * If isGlobal is true, also adds to global collection
 */
export async function addDocumentsToCategories(
  categorySlugs: string[],
  ids: string[],
  embeddings: number[][],
  documents: string[],
  metadatas: ChunkMetadata[],
  isGlobal: boolean = false
): Promise<void> {
  // Add to each category collection
  for (const slug of categorySlugs) {
    await addDocumentsToCollection(collectionNames.forCategory(slug), ids, embeddings, documents, metadatas);
  }

  // If global, also add to global collection
  if (isGlobal) {
    await addDocumentsToCollection(collectionNames.global, ids, embeddings, documents, metadatas);
  }
}

/**
 * Add global documents to ALL category collections
 */
export async function addGlobalDocuments(
  ids: string[],
  embeddings: number[][],
  documents: string[],
  metadatas: ChunkMetadata[]
): Promise<void> {
  // Add to global collection
  await addDocumentsToCollection(collectionNames.global, ids, embeddings, documents, metadatas);

  // Also add to all existing category collections
  const categorySlugs = await listCategoryCollections();
  for (const slug of categorySlugs) {
    await addDocumentsToCollection(collectionNames.forCategory(slug), ids, embeddings, documents, metadatas);
  }
}

// ============ Query Operations ============

/**
 * Query a specific collection
 */
export async function queryCollection(
  collectionName: string,
  queryEmbedding: number[],
  nResults: number = 5,
  whereFilter?: Record<string, unknown>
): Promise<{
  ids: string[];
  documents: string[];
  metadatas: ChunkMetadata[];
  distances: number[];
}> {
  try {
    const collection = await getCollectionByName(collectionName);

    // Check collection count before querying
    const count = await collection.count();
    console.log(`[ChromaDB] Collection ${collectionName} has ${count} documents`);

    if (count === 0) {
      console.log(`[ChromaDB] Collection ${collectionName} is empty, skipping query`);
      return { ids: [], documents: [], metadatas: [], distances: [] };
    }

    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults,
      where: whereFilter,
      include: [IncludeEnum.Documents, IncludeEnum.Metadatas, IncludeEnum.Distances],
    });

    return {
      ids: (results.ids[0] || []) as string[],
      documents: (results.documents?.[0] || []) as string[],
      metadatas: (results.metadatas?.[0] || []) as unknown as ChunkMetadata[],
      distances: (results.distances?.[0] || []) as number[],
    };
  } catch (error) {
    console.error(`[ChromaDB] queryCollection failed for ${collectionName}:`, error);
    throw error;
  }
}

/**
 * Query the legacy/default collection (backward compatibility)
 */
export async function queryDocuments(
  queryEmbedding: number[],
  nResults: number = 5,
  whereFilter?: Record<string, unknown>
): Promise<{
  ids: string[];
  documents: string[];
  metadatas: ChunkMetadata[];
  distances: number[];
}> {
  return queryCollection(LEGACY_COLLECTION_NAME, queryEmbedding, nResults, whereFilter);
}

/**
 * Query multiple category collections and merge results
 */
export async function queryCategories(
  categorySlugs: string[],
  queryEmbedding: number[],
  nResults: number = 5,
  whereFilter?: Record<string, unknown>
): Promise<{
  ids: string[];
  documents: string[];
  metadatas: ChunkMetadata[];
  distances: number[];
}> {
  // Query all specified categories + global collection
  const collectionsToQuery = [
    ...categorySlugs.map(collectionNames.forCategory),
    collectionNames.global,
  ];

  console.log('[ChromaDB] queryCategories called:', {
    collectionsToQuery,
    nResults,
    embeddingLength: queryEmbedding.length,
  });

  // Query each collection
  const allResults: {
    id: string;
    document: string;
    metadata: ChunkMetadata;
    distance: number;
  }[] = [];

  for (const collectionName of collectionsToQuery) {
    try {
      console.log(`[ChromaDB] Querying collection: ${collectionName}`);
      const results = await queryCollection(collectionName, queryEmbedding, nResults, whereFilter);
      console.log(`[ChromaDB] ${collectionName} returned ${results.ids.length} results`);

      for (let i = 0; i < results.ids.length; i++) {
        allResults.push({
          id: results.ids[i],
          document: results.documents[i],
          metadata: results.metadatas[i],
          distance: results.distances[i],
        });
      }
    } catch (error) {
      console.error(`[ChromaDB] Failed to query ${collectionName}:`, error);
      // Collection may not exist, skip it
    }
  }

  // Deduplicate by ID (keep lowest distance / highest score)
  const uniqueResults = new Map<string, typeof allResults[0]>();
  for (const result of allResults) {
    const existing = uniqueResults.get(result.id);
    if (!existing || result.distance < existing.distance) {
      uniqueResults.set(result.id, result);
    }
  }

  // Sort by distance (lower = more similar) and take top N
  const sortedResults = Array.from(uniqueResults.values())
    .sort((a, b) => a.distance - b.distance)
    .slice(0, nResults);

  return {
    ids: sortedResults.map(r => r.id),
    documents: sortedResults.map(r => r.document),
    metadatas: sortedResults.map(r => r.metadata),
    distances: sortedResults.map(r => r.distance),
  };
}

// ============ Delete Operations ============

/**
 * Delete documents from a specific collection
 */
export async function deleteDocumentsFromCollection(
  collectionName: string,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const collection = await getCollectionByName(collectionName);
  await collection.delete({ ids });
}

/**
 * Delete documents from the legacy/default collection (backward compatibility)
 */
export async function deleteDocuments(ids: string[]): Promise<void> {
  await deleteDocumentsFromCollection(LEGACY_COLLECTION_NAME, ids);
}

/**
 * Delete documents from all category collections (for global doc removal)
 */
export async function deleteDocumentsFromAllCollections(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  // Delete from global collection
  try {
    await deleteDocumentsFromCollection(collectionNames.global, ids);
  } catch {
    // May not exist
  }

  // Delete from all category collections
  const categorySlugs = await listCategoryCollections();
  for (const slug of categorySlugs) {
    try {
      await deleteDocumentsFromCollection(collectionNames.forCategory(slug), ids);
    } catch {
      // May not exist in this collection
    }
  }

  // Also delete from legacy collection
  try {
    await deleteDocumentsFromCollection(collectionNames.legacy, ids);
  } catch {
    // May not exist
  }
}

/**
 * Delete documents by filter from a collection
 */
export async function deleteDocumentsByFilter(
  whereFilter: Record<string, unknown>
): Promise<void> {
  const coll = await getCollection();
  await coll.delete({ where: whereFilter });
}

/**
 * Delete documents by filter from specific categories
 */
export async function deleteDocumentsByFilterFromCategories(
  categorySlugs: string[],
  whereFilter: Record<string, unknown>
): Promise<void> {
  for (const slug of categorySlugs) {
    try {
      const collection = await getCollectionByName(collectionNames.forCategory(slug));
      await collection.delete({ where: whereFilter });
    } catch {
      // Collection may not exist
    }
  }
}

// ============ Count Operations ============

/**
 * Get document count from legacy collection (backward compatibility)
 */
export async function getDocumentCount(): Promise<number> {
  const coll = await getCollection();
  return coll.count();
}

/**
 * Get document count from a specific collection
 */
export async function getCollectionCount(collectionName: string): Promise<number> {
  try {
    const collection = await getCollectionByName(collectionName);
    return await collection.count();
  } catch {
    return 0;
  }
}

/**
 * Get document count for a category
 */
export async function getCategoryDocumentCount(categorySlug: string): Promise<number> {
  return getCollectionCount(collectionNames.forCategory(categorySlug));
}

/**
 * Get total document count across all category collections
 */
export async function getTotalCategoryDocumentCount(): Promise<number> {
  const categorySlugs = await listCategoryCollections();
  let total = 0;
  for (const slug of categorySlugs) {
    total += await getCategoryDocumentCount(slug);
  }
  return total;
}

// ============ Utility Operations ============

/**
 * Clear the collection cache (useful after collection deletion)
 */
export function clearCollectionCache(): void {
  collectionCache.clear();
}

/**
 * Check if a category collection exists
 */
export async function categoryCollectionExists(categorySlug: string): Promise<boolean> {
  const collections = await listCategoryCollections();
  return collections.includes(categorySlug);
}

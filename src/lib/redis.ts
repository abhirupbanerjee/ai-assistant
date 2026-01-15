import { createClient, RedisClientType } from 'redis';
import crypto from 'crypto';

let client: RedisClientType | null = null;
let connectionPromise: Promise<RedisClientType> | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
  // Return existing client if already connected
  if (client) return client;

  // Return existing connection promise to prevent race conditions
  if (connectionPromise) return connectionPromise;

  // Create new connection promise
  connectionPromise = (async (): Promise<RedisClientType> => {
    const newClient: RedisClientType = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    newClient.on('error', (err) => {
      console.error('Redis error:', err);
    });

    await newClient.connect();
    client = newClient;
    return newClient;
  })();

  return connectionPromise;
}

export function hashQuery(query: string): string {
  return crypto
    .createHash('md5')
    .update(query.toLowerCase().trim())
    .digest('hex');
}

export async function cacheQuery(
  queryHash: string,
  response: string,
  ttlSeconds: number = 3600
): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.setEx(`query:${queryHash}`, ttlSeconds, response);
  } catch (error) {
    console.error('Failed to cache query:', error);
  }
}

export async function getCachedQuery(key: string): Promise<string | null> {
  try {
    const redis = await getRedisClient();
    // Support both prefixed keys (tavily:xxx) and unprefixed (xxx for backward compat with query:xxx)
    const fullKey = key.includes(':') ? key : `query:${key}`;
    return await redis.get(fullKey);
  } catch (error) {
    console.error('Failed to get cached query:', error);
    return null;
  }
}

export async function invalidateQueryCache(): Promise<void> {
  try {
    const redis = await getRedisClient();
    const keys = await redis.keys('query:*');
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch (error) {
    console.error('Failed to invalidate query cache:', error);
  }
}

export async function invalidateTavilyCache(): Promise<void> {
  try {
    const redis = await getRedisClient();
    const keys = await redis.keys('tavily:*');
    if (keys.length > 0) {
      await redis.del(keys);
      console.log(`Invalidated ${keys.length} Tavily cache entries`);
    }
  } catch (error) {
    console.error('Failed to invalidate Tavily cache:', error);
  }
}

/**
 * Invalidate cache entries for a specific category
 * Used when category prompt is updated to ensure fresh responses
 *
 * Cache keys for category queries follow pattern: query:{hash}
 * where hash is MD5 of "{message}:categories:{category-slugs}"
 *
 * Since we can't reverse the hash, we invalidate ALL query cache
 * when a category prompt changes. This is acceptable because:
 * - Category prompt updates are infrequent
 * - Cache will rebuild naturally with user queries
 */
export async function invalidateCategoryCache(categorySlug: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    // We need to invalidate all query cache since cache keys are hashed
    // and we can't identify which ones include this category
    const keys = await redis.keys('query:*');
    if (keys.length > 0) {
      await redis.del(keys);
      console.log(`Invalidated ${keys.length} query cache entries for category: ${categorySlug}`);
    }
  } catch (error) {
    console.error(`Failed to invalidate cache for category ${categorySlug}:`, error);
  }
}

export async function clearAllCache(): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.flushAll();
    console.log('Cleared all cache (RAG + Tavily)');
  } catch (error) {
    console.error('Failed to clear all cache:', error);
  }
}

// ============ User Document Embedding Cache ============

/**
 * Cached user document data structure
 */
export interface CachedUserDocData {
  chunks: Array<{
    id: string;
    text: string;
    embedding: number[];
    pageNumber: number;
  }>;
  totalChunks?: number; // Original chunk count before MAX_USER_DOC_CHUNKS limit
  createdAt: number;
}

/**
 * Cache user document embeddings for a thread
 * @param threadId - Thread ID
 * @param filename - Document filename
 * @param data - Chunks with embeddings
 * @param ttlSeconds - Cache TTL (default 24 hours)
 */
export async function cacheUserDocEmbeddings(
  threadId: string,
  filename: string,
  data: CachedUserDocData,
  ttlSeconds: number = 86400
): Promise<void> {
  try {
    const redis = await getRedisClient();
    const key = `user-doc:${threadId}:${hashQuery(filename)}`;
    await redis.setEx(key, ttlSeconds, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to cache user doc embeddings:', error);
  }
}

/**
 * Get cached user document embeddings
 * @param threadId - Thread ID
 * @param filename - Document filename
 * @returns Cached data or null if not found
 */
export async function getCachedUserDocEmbeddings(
  threadId: string,
  filename: string
): Promise<CachedUserDocData | null> {
  try {
    const redis = await getRedisClient();
    const key = `user-doc:${threadId}:${hashQuery(filename)}`;
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as CachedUserDocData;
    }
    return null;
  } catch (error) {
    console.error('Failed to get cached user doc embeddings:', error);
    return null;
  }
}

/**
 * Invalidate user document embedding cache for a thread
 * @param threadId - Thread ID
 * @param filename - Optional specific filename, or all if not provided
 */
export async function invalidateThreadEmbeddingCache(
  threadId: string,
  filename?: string
): Promise<void> {
  try {
    const redis = await getRedisClient();
    if (filename) {
      // Invalidate specific file
      const key = `user-doc:${threadId}:${hashQuery(filename)}`;
      await redis.del(key);
    } else {
      // Invalidate all files for thread
      const pattern = `user-doc:${threadId}:*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(keys);
      }
    }
  } catch (error) {
    console.error('Failed to invalidate thread embedding cache:', error);
  }
}

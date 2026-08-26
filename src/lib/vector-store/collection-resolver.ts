/**
 * Generation-aware collection name resolution (Phase 2).
 *
 * Maps logical collection names (`global`, `legacy`, `category:<slug>`) to the
 * active physical collection name using the `vector_index_generations` table
 * (Phase 1 compat module), falling back deterministically to the static default
 * names in `qdrantCollectionNames` when no active mapping exists (first
 * deployment or recovery) or when the DB is unreachable.
 *
 * The mapping is cached with a short TTL so cutover / rollback propagate to new
 * requests without a redeploy. Redis is used when available (matching the
 * conventions in src/lib/redis.ts); an in-memory cache is used as a fallback
 * when Redis is unavailable at runtime.
 */

import {
  getActiveMappings,
  getCandidateGenerations,
} from '../db/compat/vector-index-generations';
import { getRedisClient } from '../redis';
import { qdrantCollectionNames } from './qdrant';
import {
  LOGICAL_GLOBAL,
  LOGICAL_LEGACY,
  logicalNameForCategory,
  isCategoryName,
  categorySlugFromName,
} from './collection-names';
import type { ResolvedCollectionNames } from './types';
import type { CandidateTarget } from './dual-write';

/** Short TTL so generation cutover/rollback propagates quickly. */
const CACHE_TTL_MS = 30_000;
const CACHE_TTL_SECONDS = Math.ceil(CACHE_TTL_MS / 1000);
const REDIS_KEY = 'vector-index:active-mappings';

interface MappingsCache {
  /** logical_name → physical_name */
  mappings: Record<string, string>;
  cachedAt: number;
}

let inMemoryCache: MappingsCache | null = null;

async function readRedisCache(): Promise<MappingsCache | null> {
  try {
    const redis = await getRedisClient();
    const raw = await redis.get(REDIS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MappingsCache;
    if (typeof parsed?.cachedAt !== 'number' || typeof parsed?.mappings !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeRedisCache(cache: MappingsCache): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.setEx(REDIS_KEY, CACHE_TTL_SECONDS, JSON.stringify(cache));
  } catch {
    // Redis unavailable — in-memory cache still covers the process.
  }
}

/**
 * Load the active logical→physical mappings, with short-TTL caching.
 *
 * Lookup order: Redis → in-memory → DB. DB failures (missing `DATABASE_URL`,
 * connection errors) degrade to an empty mapping, which makes the resolver fall
 * back to the static defaults.
 */
export async function loadActiveMappings(): Promise<Record<string, string>> {
  const redisCache = await readRedisCache();
  if (redisCache && Date.now() - redisCache.cachedAt < CACHE_TTL_MS) {
    return redisCache.mappings;
  }

  if (inMemoryCache && Date.now() - inMemoryCache.cachedAt < CACHE_TTL_MS) {
    return inMemoryCache.mappings;
  }

  const mappings: Record<string, string> = {};
  try {
    const rows = await getActiveMappings();
    for (const row of rows) {
      mappings[row.logical_name] = row.physical_name;
    }
  } catch (err) {
    console.warn(
      '[CollectionResolver] Failed to load active vector-index mappings; using static defaults:',
      err instanceof Error ? err.message : err
    );
  }

  const cache: MappingsCache = { mappings, cachedAt: Date.now() };
  inMemoryCache = cache;
  await writeRedisCache(cache);

  return mappings;
}

/**
 * Resolve the active physical collection names for all logical collections.
 *
 * `global` / `legacy` / `forCategory(slug)` are resolved from the active
 * generation mapping when present, and fall back to the deterministic static
 * default names otherwise. `isCategory` / `toSlug` are generation-suffix aware.
 */
export async function resolveActiveCollectionNames(): Promise<ResolvedCollectionNames> {
  const mappings = await loadActiveMappings();
  const fallback = qdrantCollectionNames;

  return {
    global: mappings[LOGICAL_GLOBAL] ?? fallback.global,
    legacy: mappings[LOGICAL_LEGACY] ?? fallback.legacy,
    forCategory: (slug: string): string =>
      mappings[logicalNameForCategory(slug)] ?? fallback.forCategory(slug),
    isCategory: isCategoryName,
    toSlug: categorySlugFromName,
  };
}

/**
 * Load the in-progress candidate (building/validating) mappings keyed by
 * logical name. Used by ingest (Phase 4) to discover candidate physical
 * collections to mirror writes/deletes into during a rebuild.
 *
 * Unlike `loadActiveMappings`, this is intentionally uncached so a candidate
 * appearing or finishing is reflected on the next ingest operation. DB
 * failures degrade to an empty mapping (no dual-write), matching the active
 * mapping fallback behavior.
 */
export async function loadCandidateMappings(): Promise<Record<string, CandidateTarget>> {
  const mappings: Record<string, CandidateTarget> = {};
  try {
    const rows = await getCandidateGenerations();
    for (const row of rows) {
      mappings[row.logical_name] = {
        physicalName: row.physical_name,
        generation: row.generation,
      };
    }
  } catch (err) {
    console.warn(
      '[CollectionResolver] Failed to load candidate vector-index generations; dual-write skipped:',
      err instanceof Error ? err.message : err
    );
  }

  return mappings;
}

/**
 * Invalidate the mapping cache. Call after a generation cutover/rollback so all
 * processes pick up the new active mapping immediately.
 */
export async function invalidateCollectionMappingCache(): Promise<void> {
  inMemoryCache = null;
  try {
    const redis = await getRedisClient();
    await redis.del(REDIS_KEY);
  } catch {
    // Redis unavailable — in-memory cache has already been cleared.
  }
}

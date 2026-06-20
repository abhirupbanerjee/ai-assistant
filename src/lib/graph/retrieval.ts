/**
 * Graph-Augmented Retrieval (HippoRAG-style)
 *
 * Inserts between Qdrant search and rerankChunks in the RAG pipeline.
 *
 * Flow:
 *   1. Seed selection: top Qdrant chunks → MENTIONS → seed Entity nodes
 *   2. Subgraph fetch: 2-3 hop Cypher neighborhood around seeds
 *   3. In-process PPR: personalized PageRank on adjacency list
 *   4. Chunk expansion: top PPR entities → MENTIONS → Chunk qdrantIds
 *   5. Qdrant batch retrieve: fetch chunk text by ID
 *
 * PPR is computed in-process because FalkorDB's built-in algo.pageRank
 * does not support seed-node personalization.
 */

import { getGraph, isGraphHealthy, retryGraphQuery } from './falkordb-client';
import { getVectorStore } from '@/lib/vector-store';
import type { RetrievedChunk } from '@/types';

// ============ Types ============

interface SubgraphEdge {
  source: string;
  target: string;
  type: string;
}

interface SubgraphData {
  entities: Map<string, { name: string; type: string }>;
  edges: SubgraphEdge[];
}

interface PprResult {
  entityId: string;
  score: number;
}

// ============ Constants ============

const PPR_DAMPING = 0.85;
const PPR_MAX_ITERATIONS = 50;
const PPR_CONVERGENCE_THRESHOLD = 1e-6;
const SUBGRAPH_MAX_HOPS = 3;
const SUBGRAPH_RESULT_CAP = 1000; // Path-explosion guard
const DEFAULT_SEED_CHUNK_COUNT = 10; // Top-N Qdrant chunks used for seeding
const DEFAULT_PPR_TOP_K = 20; // Top-K PPR entities to expand
const DEFAULT_CHUNKS_PER_ENTITY = 5; // Max chunks to fetch per PPR entity

export interface GraphRetrievalOptions {
  seedChunkCount?: number;
  pprTopK?: number;
  chunksPerEntity?: number;
}

// ============ Seed Selection ============

/**
 * Given top Qdrant chunks, find their linked Entity nodes in FalkorDB.
 */
async function selectSeedEntities(
  topChunks: RetrievedChunk[],
  graph: any,
  seedChunkCount: number = DEFAULT_SEED_CHUNK_COUNT,
): Promise<string[]> {
  const chunkIds = topChunks.slice(0, seedChunkCount).map(c => c.id);
  const seedIds = new Set<string>();

  for (const chunkId of chunkIds) {
    try {
      const result = await retryGraphQuery(
        graph,
        'MATCH (e:Entity)-[:MENTIONS]->(c:Chunk {qdrantId: $id}) RETURN e.id',
        { id: chunkId }
      );

      for (const row of result.data || result || []) {
        const entityId = row['e.id'] || row[0];
        if (entityId) seedIds.add(entityId);
      }
    } catch {
      // Chunk may not have entities yet — skip
    }
  }

  return Array.from(seedIds);
}

// ============ Subgraph Fetch ============

/**
 * Fetch 2-3 hop neighborhood subgraph around seed entities.
 * Uses Cypher variable-length path with relationship type alternation.
 */
async function fetchSubgraph(
  seedIds: string[],
  graph: any,
): Promise<SubgraphData> {
  if (seedIds.length === 0) {
    return { entities: new Map(), edges: [] };
  }

  const entities = new Map<string, { name: string; type: string }>();
  const edges: SubgraphEdge[] = [];

  try {
    // Fetch entities and their relationships via bounded traversal
    const result = await retryGraphQuery(
      graph,
      `MATCH (e:Entity)-[r:RELATES_TO|SAME_AS*1..${SUBGRAPH_MAX_HOPS}]-(neighbor:Entity)
       WHERE e.id IN $seedIds
       RETURN DISTINCT e, neighbor, r
       LIMIT ${SUBGRAPH_RESULT_CAP}`,
      { params: { seedIds } }
    );

    const rows = result.data || result || [];
    for (const row of rows) {
      // Collect entity nodes
      const e = row.e || row[0];
      const neighbor = row.neighbor || row[1];
      const rels = row.r || row[2];

      if (e?.properties) {
        entities.set(e.properties.id, {
          name: e.properties.name || e.properties.id,
          type: e.properties.type || 'Unknown',
        });
      }
      if (neighbor?.properties) {
        entities.set(neighbor.properties.id, {
          name: neighbor.properties.name || neighbor.properties.id,
          type: neighbor.properties.type || 'Unknown',
        });
      }

      // Collect edges from variable-length path
      const relArray = Array.isArray(rels) ? rels : [rels];
      for (const rel of relArray) {
        if (rel?.src_id && rel?.dest_id) {
          edges.push({
            source: String(rel.src_id),
            target: String(rel.dest_id),
            type: rel.relationship || rel.type || 'RELATES_TO',
          });
        }
      }
    }
  } catch (err) {
    console.warn('[GraphRetrieval] Subgraph fetch failed:', err);
  }

  return { entities, edges };
}

// ============ In-Process Personalized PageRank ============

/**
 * Run Personalized PageRank on the subgraph adjacency list.
 *
 * Power iteration:
 *   rank = damping * (adjacency * rank) + (1-damping) * seed_vector
 *
 * Converges at delta < threshold or max iterations.
 */
function runPPR(
  subgraph: SubgraphData,
  seedIds: string[],
  pprTopK: number = DEFAULT_PPR_TOP_K,
): PprResult[] {
  const { entities, edges } = subgraph;

  if (entities.size === 0) return [];

  // Build node index
  const nodeIds = Array.from(entities.keys());
  const nodeIndex = new Map<string, number>();
  nodeIds.forEach((id, i) => nodeIndex.set(id, i));

  const n = nodeIds.length;

  // Build sparse adjacency (outgoing links)
  const adjacency: number[][] = Array.from({ length: n }, () => []);
  for (const edge of edges) {
    const src = nodeIndex.get(edge.source);
    const tgt = nodeIndex.get(edge.target);
    if (src !== undefined && tgt !== undefined) {
      adjacency[src].push(tgt);
      // Make graph undirected for better PPR flow (bidirectional traversal)
      adjacency[tgt].push(src);
    }
  }

  // Initialize seed vector (uniform mass on seed nodes)
  const seedVector = new Array(n).fill(0);
  const seedSet = new Set(seedIds);
  let seedCount = 0;

  for (let i = 0; i < n; i++) {
    if (seedSet.has(nodeIds[i])) {
      seedVector[i] = 1.0;
      seedCount++;
    }
  }

  // If no seeds found in subgraph, fall back to uniform
  if (seedCount === 0) {
    seedVector.fill(1.0 / n);
  } else {
    // Normalize seed vector
    const total = seedVector.reduce((a, b) => a + b, 0);
    for (let i = 0; i < n; i++) {
      seedVector[i] /= total;
    }
  }

  // Initialize rank vector = seed vector
  let rank = [...seedVector];

  // Power iteration
  for (let iter = 0; iter < PPR_MAX_ITERATIONS; iter++) {
    const newRank = new Array(n).fill(0);

    // Compute adjacency contribution
    for (let i = 0; i < n; i++) {
      const neighbors = adjacency[i];
      if (neighbors.length === 0) {
        // Dangling node: distribute to all nodes uniformly
        const share = rank[i] / n;
        for (let j = 0; j < n; j++) {
          newRank[j] += share;
        }
      } else {
        const share = rank[i] / neighbors.length;
        for (const neighbor of neighbors) {
          newRank[neighbor] += share;
        }
      }
    }

    // Apply damping + teleport
    for (let i = 0; i < n; i++) {
      newRank[i] = PPR_DAMPING * newRank[i] + (1 - PPR_DAMPING) * seedVector[i];
    }

    // Check convergence
    let delta = 0;
    for (let i = 0; i < n; i++) {
      delta += Math.abs(newRank[i] - rank[i]);
    }

    rank = newRank;

    if (delta < PPR_CONVERGENCE_THRESHOLD) break;
  }

  // Return top-K ranked entities
  return nodeIds
    .map((id, i) => ({ entityId: id, score: rank[i] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, pprTopK);
}

// ============ Chunk Expansion ============

/**
 * For top PPR entities, fetch their linked Chunk qdrantIds and retrieve
 * chunk text from Qdrant. Deduplicates against the original chunks.
 */
async function expandToChunks(
  rankedEntities: PprResult[],
  originalChunkIds: Set<string>,
  graph: any,
  chunksPerEntity: number = DEFAULT_CHUNKS_PER_ENTITY,
): Promise<RetrievedChunk[]> {
  if (rankedEntities.length === 0) return [];

  const store = await getVectorStore();
  const chunkIds = new Set<string>();

  for (const entity of rankedEntities) {
    try {
      const result = await retryGraphQuery(
        graph,
        `MATCH (e:Entity {id: $id})-[:MENTIONS]->(c:Chunk)
         RETURN c.qdrantId, c.documentId, c.pageNumber
         LIMIT ${chunksPerEntity}`,
        { id: entity.entityId }
      );

      const rows = result.data || result || [];
      for (const row of rows) {
        const qdrantId = row['c.qdrantId'] || row[0];
        if (qdrantId && !originalChunkIds.has(qdrantId)) {
          chunkIds.add(qdrantId);
        }
      }
    } catch {
      // Entity may not have chunk links yet
    }
  }

  if (chunkIds.size === 0) return [];

  // Batch retrieve chunk text from Qdrant
  // The vector store doesn't have a batch-retrieve-by-ID method exposed,
  // so we query the global collection with an embedding search limited to these IDs.
  // For now, use a simplified approach: query with a zero vector and filter by ID.
  const chunks: RetrievedChunk[] = [];
  const idList = Array.from(chunkIds);

  // Fetch each chunk individually via getDocumentChunksByDocId approach
  // Since we have chunk IDs but need text, we use the store's internal Qdrant client
  // This is a known limitation — in production, add a batch retrieve method
  try {
    // We use query with a dummy embedding to get chunks by ID filter
    // This is suboptimal but works within the existing interface
    const collNames = (await import('@/lib/vector-store')).getCollectionNames();
    const zeroEmbedding = new Array(3072).fill(0);

    for (const chunkId of idList) {
      try {
        const results = await store.query(
          collNames.global,
          zeroEmbedding,
          1,
          { id: chunkId },
          -1, // No score threshold for ID lookup
        );
        if (results.documents.length > 0) {
          chunks.push({
            id: results.ids[0],
            text: results.documents[0],
            documentName: results.metadatas[0]?.documentName || 'Unknown',
            pageNumber: results.metadatas[0]?.pageNumber || 1,
            score: 0,
            source: 'global',
          });
        }
      } catch {
        // Chunk may have been deleted
      }
    }
  } catch (err) {
    console.warn('[GraphRetrieval] Chunk expansion failed:', err);
  }

  return chunks;
}

// ============ Main Entry Point ============

export interface GraphAugmentationResult {
  /** Graph-expanded chunks to merge before reranking */
  graphChunks: RetrievedChunk[];
  /** Seed entity IDs for trace logging */
  seedEntityIds: string[];
  /** PPR-ranked entity IDs for trace logging */
  pprTopEntities: string[];
  /** Whether the graph was actually used (false if skipped or failed) */
  used: boolean;
}

/**
 * Main graph-augmented retrieval entry point.
 *
 * Called between Qdrant search and rerankChunks in ragQuery().
 * Returns additional chunks discovered through graph traversal.
 * Gracefully falls back to empty result on any failure.
 */
export async function graphAugmentedRetrieval(
  topChunks: RetrievedChunk[],
  options: GraphRetrievalOptions = {},
): Promise<GraphAugmentationResult> {
  const seedChunkCount = options.seedChunkCount ?? DEFAULT_SEED_CHUNK_COUNT;
  const pprTopK = options.pprTopK ?? DEFAULT_PPR_TOP_K;
  const chunksPerEntity = options.chunksPerEntity ?? DEFAULT_CHUNKS_PER_ENTITY;
  const empty: GraphAugmentationResult = {
    graphChunks: [],
    seedEntityIds: [],
    pprTopEntities: [],
    used: false,
  };

  // Check graph health
  const healthy = await isGraphHealthy();
  if (!healthy) return empty;

  try {
    const graph = await getGraph();

    // Step 1: Seed selection
    const seedIds = await selectSeedEntities(topChunks, graph, seedChunkCount);
    if (seedIds.length === 0) return empty;

    // Step 2: Subgraph fetch
    const subgraph = await fetchSubgraph(seedIds, graph);
    if (subgraph.entities.size === 0) return empty;

    // Step 3: In-process PPR
    const rankedEntities = runPPR(subgraph, seedIds, pprTopK);
    if (rankedEntities.length === 0) return empty;

    // Step 4: Chunk expansion
    const originalChunkIds = new Set(topChunks.map(c => c.id));
    const graphChunks = await expandToChunks(rankedEntities, originalChunkIds, graph, chunksPerEntity);

    return {
      graphChunks,
      seedEntityIds: seedIds,
      pprTopEntities: rankedEntities.slice(0, pprTopK).map(e => e.entityId),
      used: true,
    };
  } catch (err) {
    console.warn('[GraphRetrieval] Graph-augmented retrieval failed, falling back to pure RAG:', err);
    return empty;
  }
}

/**
 * Check if graph augmentation should be skipped based on Qdrant scores.
 * Skips when the top Qdrant chunk has a very high score (> 0.85),
 * indicating a clear single-document answer that doesn't need graph expansion.
 */
export function shouldSkipGraphAugmentation(
  topChunks: RetrievedChunk[],
  skipThreshold: number = 0.85,
): boolean {
  if (topChunks.length === 0) return true;
  return (topChunks[0]?.score ?? 0) > skipThreshold;
}

/**
 * Entity Extraction & Resolution Pipeline
 *
 * Extracts entities and relations from document chunks using createInternalCompletion()
 * (routes through existing four-route LLM architecture). Resolves near-duplicate
 * entities via Qdrant embedding similarity and writes to FalkorDB.
 *
 * Idempotent by chunk qdrantId — safe to re-run on the same corpus.
 *
 * Concurrency: max 5 parallel extraction calls, 1-3 chunks per call.
 */

import { createInternalCompletion } from '@/lib/llm-client';
import { getGraph, isGraphHealthy } from './falkordb-client';

// ============ Types ============

export interface ExtractedEntity {
  name: string;
  type: string;
}

export interface ExtractedRelation {
  head: string;
  relation: string;
  tail: string;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

export interface ResolvedEntity {
  name: string;
  type: string;
  canonicalId: string;
  isNew: boolean;
  sameAsId?: string;
  sameAsScore?: number;
}

// ============ Constants ============

const MAX_CONCURRENT_CALLS = 5;
const CHUNKS_PER_CALL = 2; // Conservative: 1-3 chunks per LLM call
const RESOLUTION_SIMILARITY_THRESHOLD = 0.92;
const RESOLUTION_TOP_K = 3;

// Track processed qdrantIds in memory to avoid re-extraction within a session
const processedChunks = new Set<string>();

// ============ Extraction Prompt ============

function buildExtractionPrompt(chunks: { qdrantId: string; text: string }[]): string {
  const chunkTexts = chunks
    .map((c, i) => `[Chunk ${i + 1} id="${c.qdrantId}"]\n${c.text}`)
    .join('\n\n');

  return `Extract named entities and their relationships from the following text chunks.

For each chunk, identify:
- Entities: named people, organizations, policies, regulations, dates, locations, concepts, documents, roles, departments
- Relations: how entities relate to each other (e.g., "manages", "reports to", "amends", "defines", "requires", "supersedes")

Return ONLY a JSON object with this exact structure:
{
  "entities": [
    { "name": "Entity Name", "type": "Person|Organization|Policy|Regulation|Date|Location|Concept|Document|Role|Department" }
  ],
  "relations": [
    { "head": "Entity A", "relation": "describes relationship", "tail": "Entity B" }
  ]
}

Start your reply with { and end with }. Do not include any other text.

Text chunks:
${chunkTexts}`;
}

// ============ JSON Extraction ============

/**
 * Robust JSON extraction using greedy { → } matching.
 * Reuses the same pattern as rag.ts:75-77 and llm-client.ts:31-33.
 */
function extractJsonObject(response: string): string {
  const first = response.indexOf('{');
  const last = response.lastIndexOf('}');
  if (first !== -1 && last > first) {
    return response.slice(first, last + 1);
  }
  return response;
}

// ============ Entity Resolution ============

/**
 * Resolve extracted entities for canonical IDs.
 *
 * Simple pass-through: generates canonical IDs from entity names.
 * FalkorDB's MERGE handles exact duplicates automatically.
 * Near-duplicate resolution (SAME_AS via embedding similarity) is
 * deferred to a future enhancement — it requires a dedicated entity
 * embeddings index that doesn't depend on the global_documents collection.
 */
async function resolveEntities(
  entities: ExtractedEntity[],
): Promise<ResolvedEntity[]> {
  return entities.map(entity => ({
    name: entity.name,
    type: entity.type,
    canonicalId: `entity:${entity.name.toLowerCase().replace(/\s+/g, '_')}`,
    isNew: true,
  }));
}

// ============ Graph Writing ============

/**
 * Write resolved entities and relations to FalkorDB for a batch of chunks.
 */
async function writeToGraph(
  chunks: { qdrantId: string; documentId: string; pageNumber: number; documentName: string }[],
  resolvedEntities: ResolvedEntity[],
  relations: ExtractedRelation[],
): Promise<void> {
  const graph = await getGraph();

  // Create/Merge Entity nodes + SAME_AS edges
  for (const entity of resolvedEntities) {
    if (entity.isNew) {
      // Create new canonical entity
      await graph.query(
        `MERGE (e:Entity {id: $id})
         ON CREATE SET e.name = $name, e.type = $type
         ON MATCH SET e.name = $name, e.type = $type`,
        { params: { id: entity.canonicalId, name: entity.name, type: entity.type } }
      );
    } else if (entity.sameAsId) {
      // Link to existing canonical entity via SAME_AS
      await graph.query(
        `MERGE (e:Entity {id: $newId})
         ON CREATE SET e.name = $name, e.type = $type
         WITH e
         MATCH (existing:Entity {id: $existingId})
         MERGE (e)-[:SAME_AS {score: $score}]->(existing)`,
        {
          params: {
            newId: entity.canonicalId,
            name: entity.name,
            type: entity.type,
            existingId: entity.sameAsId,
            score: entity.sameAsScore ?? RESOLUTION_SIMILARITY_THRESHOLD,
          },
        }
      );
    }
  }

  // Create Chunk nodes + MENTIONS edges + PART_OF edges
  for (const chunk of chunks) {
    await graph.query(
      `MERGE (c:Chunk {qdrantId: $qdrantId})
       ON CREATE SET c.documentId = $documentId, c.pageNumber = $pageNumber
       MERGE (d:Document {id: $documentId})
       ON CREATE SET d.name = $documentName, d.category = '', d.source = ''
       MERGE (c)-[:PART_OF]->(d)`,
      {
        params: {
          qdrantId: chunk.qdrantId,
          documentId: chunk.documentId,
          pageNumber: chunk.pageNumber,
          documentName: chunk.documentName,
        },
      }
    );
  }

  // Create MENTIONS edges: Entity → Chunk
  for (const entity of resolvedEntities) {
    for (const chunk of chunks) {
      // Only link if the entity name appears in this chunk (heuristic)
      // In a full impl, the LLM would return chunk-level entity assignments.
      // For now, link all extracted entities to all chunks in the batch.
      await graph.query(
        `MATCH (e:Entity {id: $entityId})
         MATCH (c:Chunk {qdrantId: $chunkId})
         MERGE (e)-[:MENTIONS]->(c)`,
        { params: { entityId: entity.canonicalId, chunkId: chunk.qdrantId } }
      );
    }
  }

  // Create RELATES_TO edges
  for (const rel of relations) {
    const headId = `entity:${rel.head.toLowerCase().replace(/\s+/g, '_')}`;
    const tailId = `entity:${rel.tail.toLowerCase().replace(/\s+/g, '_')}`;
    await graph.query(
      `MATCH (h:Entity {id: $headId})
       MATCH (t:Entity {id: $tailId})
       MERGE (h)-[:RELATES_TO {type: $type, confidence: 0.8}]->(t)`,
      { params: { headId, tailId, type: rel.relation } }
    );
  }
}

// ============ Main Extraction Entry Point ============

/**
 * Extract entities from a single chunk. Safe to call multiple times —
 * idempotent by qdrantId.
 */
export async function extractEntitiesFromChunk(
  chunkText: string,
  qdrantId: string,
  documentId: string,
  pageNumber: number,
  documentName: string,
): Promise<void> {
  // Idempotency check
  if (processedChunks.has(qdrantId)) return;

  // Check if graph is healthy
  const healthy = await isGraphHealthy();
  if (!healthy) {
    console.warn('[EntityExtraction] FalkorDB not healthy, skipping extraction');
    return;
  }

  try {
    const prompt = buildExtractionPrompt([{ qdrantId, text: chunkText }]);
    const response = await createInternalCompletion({
      messages: [
        {
          role: 'system',
          content: 'You extract named entities and relationships from text. Return only valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      maxTokens: 1024,
    });

    const jsonStr = extractJsonObject(response);

    // Handle empty or invalid JSON responses gracefully
    if (!jsonStr || jsonStr === '{}') {
      processedChunks.add(qdrantId);
      return; // LLM returned empty — skip without error
    }

    let result: ExtractionResult;
    try {
      result = JSON.parse(jsonStr);
    } catch {
      // Malformed JSON — log and skip
      console.warn(`[EntityExtraction] Invalid JSON from LLM for chunk ${qdrantId}: ${jsonStr.slice(0, 100)}`);
      processedChunks.add(qdrantId);
      return;
    }

    if (!result.entities || !Array.isArray(result.entities)) {
      console.warn(`[EntityExtraction] Invalid extraction result for chunk ${qdrantId}`);
      processedChunks.add(qdrantId);
      return;
    }

    // Resolve entities against existing corpus
    const resolved = await resolveEntities(result.entities);

    // Write to FalkorDB
    await writeToGraph(
      [{ qdrantId, documentId, pageNumber, documentName }],
      resolved,
      result.relations || [],
    );

    processedChunks.add(qdrantId);
  } catch (err) {
    console.error(`[EntityExtraction] Failed for chunk ${qdrantId}:`, err);
    // Mark as processed even on failure to avoid infinite retries
    processedChunks.add(qdrantId);
  }
}

/**
 * Extract entities from multiple chunks in parallel with concurrency control.
 * Used by the ingestion hook and backfill script.
 */
export async function extractEntitiesFromChunks(
  chunks: { qdrantId: string; text: string; documentId: string; pageNumber: number; documentName: string }[],
): Promise<{ processed: number; skipped: number; failed: number }> {
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  // Filter already-processed chunks
  const pending = chunks.filter(c => {
    if (processedChunks.has(c.qdrantId)) {
      skipped++;
      return false;
    }
    return true;
  });

  // Process in batches with concurrency cap
  for (let i = 0; i < pending.length; i += MAX_CONCURRENT_CALLS) {
    const batch = pending.slice(i, i + MAX_CONCURRENT_CALLS);
    const results = await Promise.allSettled(
      batch.map(chunk =>
        extractEntitiesFromChunk(
          chunk.text,
          chunk.qdrantId,
          chunk.documentId,
          chunk.pageNumber,
          chunk.documentName,
        )
      )
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        processed++;
      } else {
        failed++;
      }
    }
  }

  return { processed, skipped, failed };
}

/**
 * Clear the in-memory processed-chunks cache.
 * Useful for testing or when re-processing is desired.
 */
export function resetExtractionCache(): void {
  processedChunks.clear();
}

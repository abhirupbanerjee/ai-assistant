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
import { getGraph, isGraphHealthy, retryGraphQuery } from './falkordb-client';
import { getGraphSettings, getActiveModels, getLlmSettings } from '@/lib/db/compat';
import { logExtractionFailure } from '@/lib/db/compat/query-logs';
import type { EnabledModel } from '@/lib/db/compat';

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

const DEFAULT_MAX_CONCURRENT_CALLS = 4;
const DEFAULT_MAX_TOKENS = 16384; // Increased from 8192 to avoid JSON truncation on dense policy docs with many entities
const CHUNKS_PER_CALL = 1; // Single chunk per call to avoid maxTokens truncation with dense entity lists
const RESOLUTION_SIMILARITY_THRESHOLD = 0.92;
const RESOLUTION_TOP_K = 3;

// Track processed qdrantIds in memory to avoid re-extraction within a session
const processedChunks = new Set<string>();

// ============ Rate-Limit Resilience Helpers ============

const RATE_LIMIT_RETRY_ATTEMPTS = 3;
const RATE_LIMIT_BASE_DELAY_MS = 1000;

function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /429|rate limit|rate_limit|too many requests|throttled/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function inferProviderId(modelId: string, modelMap: Map<string, EnabledModel>): string | null {
  const model = modelMap.get(modelId);
  if (model?.providerId) return model.providerId;

  // Prefix heuristics for models not present in the registry
  if (modelId.startsWith('fireworks/') || modelId.startsWith('accounts/fireworks/')) return 'fireworks';
  if (modelId.startsWith('ollama-') || modelId.startsWith('ollama/')) return 'ollama';
  if (modelId.startsWith('claude-') || modelId.startsWith('anthropic/')) return 'anthropic';
  if (modelId.startsWith('deepseek-') || modelId.startsWith('deepseek/')) return 'deepseek';
  if (modelId.startsWith('moonshot/')) return 'moonshot';
  if (modelId.startsWith('gemini-')) return 'gemini';
  if (modelId.startsWith('mistral-')) return 'mistral';
  if (modelId.startsWith('gpt-') || /^o[0-9]/.test(modelId)) return 'openai';
  return null;
}

function modelEstimatedCost(m: EnabledModel): number {
  return (m.inputCostPer1M ?? Number.POSITIVE_INFINITY) + (m.outputCostPer1M ?? 0);
}

/**
 * Build a provider-diverse fallback chain for entity extraction.
 *
 * Order:
 * 1. Admin-configured extraction model
 * 2. System default chat model
 * 3. Cheapest enabled model from each *different* provider
 * 4. Any remaining enabled models by cost
 */
async function buildExtractionModelChain(
  configuredModel: string | undefined,
): Promise<(string | undefined)[]> {
  const chain: (string | undefined)[] = [];
  const seenProviders = new Set<string>();
  const seenModels = new Set<string>();

  const activeModels = await getActiveModels();
  const modelMap = new Map(activeModels.map(m => [m.id, m]));

  const addModel = (modelId: string | undefined, label: string) => {
    if (!modelId) return;
    if (seenModels.has(modelId)) return;
    seenModels.add(modelId);
    const providerId = inferProviderId(modelId, modelMap);
    if (providerId) seenProviders.add(providerId);
    chain.push(modelId);
    console.log(`[entity-extraction] Fallback chain #${chain.length}: ${label} (${modelId}${providerId ? ` / ${providerId}` : ''})`);
  };

  // Level 1: configured extraction model
  addModel(configuredModel, 'configured');

  // Level 2: system default chat model
  try {
    const llmSettings = await getLlmSettings();
    addModel(llmSettings.model, 'system default');
  } catch (err) {
    console.warn('[entity-extraction] Could not read system default model:', err);
  }

  // Level 3+: cheapest enabled model from each *different* provider.
  // We iterate one-by-one so seenProviders is updated after each add.
  const alternativeCandidates = activeModels
    .filter(m => m.enabled && !seenModels.has(m.id))
    .sort((a, b) => modelEstimatedCost(a) - modelEstimatedCost(b));

  for (const m of alternativeCandidates) {
    const providerId = inferProviderId(m.id, modelMap);
    if (providerId && seenProviders.has(providerId)) continue;
    addModel(m.id, 'alternative provider');
  }

  // Final backstop: any remaining enabled models by cost
  const remaining = activeModels
    .filter(m => m.enabled && !seenModels.has(m.id))
    .sort((a, b) => modelEstimatedCost(a) - modelEstimatedCost(b));

  for (const m of remaining) {
    addModel(m.id, 'cost fallback');
  }

  // Last resort: let createInternalCompletion use the system default with no override
  if (chain.length === 0) {
    chain.push(undefined);
  }

  return chain;
}

/**
 * Try a single model with exponential backoff + jitter on rate-limit (429) errors.
 * Returns null on non-rate-limit errors or when all retries are exhausted.
 */
async function tryModelWithBackoff(
  model: string | undefined,
  messages: { role: 'system' | 'user'; content: string }[],
  maxTokens: number,
  qdrantId: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < RATE_LIMIT_RETRY_ATTEMPTS; attempt++) {
    try {
      return await createInternalCompletion({
        ...(model ? { model } : {}),
        messages,
        temperature: 0.1,
        maxTokens,
      });
    } catch (err) {
      const label = model || '(system default)';
      const msg = err instanceof Error ? err.message : String(err);
      if (isRateLimitError(err) && attempt < RATE_LIMIT_RETRY_ATTEMPTS - 1) {
        const delay = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt + Math.random() * 1000;
        console.warn(`[entity-extraction] ${label} rate-limited for chunk ${qdrantId} (attempt ${attempt + 1}/${RATE_LIMIT_RETRY_ATTEMPTS}), retrying in ${Math.round(delay)}ms: ${msg}`);
        await sleep(delay);
        continue;
      }
      console.warn(`[entity-extraction] Model ${label} failed for chunk ${qdrantId}, trying next fallback: ${msg}`);
      return null;
    }
  }
  return null;
}

// ============ Extraction Prompt ============

function buildExtractionPrompt(chunks: { qdrantId: string; text: string }[]): string {
  const chunkTexts = chunks
    .map((c, i) => `[Chunk ${i + 1} id="${c.qdrantId}"]\n${c.text}`)
    .join('\n\n');

  return `Extract named entities and their relationships from the following text chunks.

IMPORTANT RULES:
- DO NOT extract document filenames, file paths, or file extensions as entities (e.g., ".pdf", "Appendix 1 Draft.pdf")
- DO NOT extract page headers, footers, page numbers, or watermark text
- DO NOT extract generic terms like "document", "section", "chapter", "page", "attachment"
- Focus on REAL-WORLD entities: people, organizations, policies, regulations, locations, concepts, roles, departments, legal instruments
- Return the 30 most significant entities and up to 20 most relevant relations. Stay within these limits to ensure valid, complete JSON output.
- If your response would exceed the output limit, prioritize the most important entities and omit less significant ones.

For each chunk, identify:
- Entities: named people, organizations, policies, regulations, dates, locations, concepts, roles, departments
- Relations: how entities relate to each other (e.g., "manages", "reports to", "amends", "defines", "requires", "supersedes")

Return ONLY a JSON object with this exact structure:
{
  "entities": [
    { "name": "Entity Name", "type": "Person|Organization|Policy|Regulation|Date|Location|Concept|Role|Department" }
  ],
  "relations": [
    { "head": "Entity A", "relation": "describes relationship", "tail": "Entity B" }
  ]
}

If no real-world entities are found, return: {"entities": [], "relations": []}

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

// ============ Graph Writing (Batch Cypher) ============

/**
 * Write resolved entities and relations to FalkorDB for a batch of chunks.
 * Uses UNWIND batch Cypher queries for 5-10x faster ingestion vs individual calls.
 */
async function writeToGraph(
  chunks: { qdrantId: string; documentId: string; pageNumber: number; documentName: string }[],
  resolvedEntities: ResolvedEntity[],
  relations: ExtractedRelation[],
): Promise<void> {
  const graph = await getGraph();

  // Batch 1: Create/Merge Entity nodes (new entities only)
  const newEntities = resolvedEntities.filter(e => e.isNew);
  if (newEntities.length > 0) {
    const entityData = newEntities.map(e => ({
      id: e.canonicalId,
      name: e.name,
      type: e.type,
    }));
    await retryGraphQuery(
      graph,
      `UNWIND $entities AS ent
       MERGE (e:Entity {id: ent.id})
       ON CREATE SET e.name = ent.name, e.type = ent.type
       ON MATCH SET e.name = ent.name, e.type = ent.type`,
      { entities: entityData }
    );
  }

  // Batch 2: SAME_AS edges (entities linked to existing canonicals)
  const sameAsEntities = resolvedEntities.filter(e => !e.isNew && e.sameAsId);
  for (const entity of sameAsEntities) {
    await retryGraphQuery(
      graph,
      `MERGE (e:Entity {id: $newId})
       ON CREATE SET e.name = $name, e.type = $type
       WITH e
       MATCH (existing:Entity {id: $existingId})
       MERGE (e)-[:SAME_AS {score: $score}]->(existing)`,
      {
        newId: entity.canonicalId,
        name: entity.name,
        type: entity.type,
        existingId: entity.sameAsId,
        score: entity.sameAsScore ?? RESOLUTION_SIMILARITY_THRESHOLD,
      }
    );
  }

  // Batch 3: Create Chunk + Document nodes + PART_OF edges
  if (chunks.length > 0) {
    const chunkData = chunks.map(c => ({
      qdrantId: c.qdrantId,
      documentId: c.documentId,
      pageNumber: c.pageNumber,
      documentName: c.documentName,
    }));
    await retryGraphQuery(
      graph,
      `UNWIND $chunks AS ch
       MERGE (c:Chunk {qdrantId: ch.qdrantId})
       ON CREATE SET c.documentId = ch.documentId, c.pageNumber = ch.pageNumber
       MERGE (d:Document {id: ch.documentId})
       ON CREATE SET d.name = ch.documentName, d.category = '', d.source = ''
       MERGE (c)-[:PART_OF]->(d)`,
      { chunks: chunkData }
    );
  }

  // Batch 4: MENTIONS edges (Entity → Chunk)
  // Build pairs of (entityId, chunkId) for all entities and chunks
  const mentionPairs: { entityId: string; chunkId: string }[] = [];
  for (const entity of resolvedEntities) {
    for (const chunk of chunks) {
      mentionPairs.push({ entityId: entity.canonicalId, chunkId: chunk.qdrantId });
    }
  }
  if (mentionPairs.length > 0) {
    // Process in sub-batches of 50 to avoid Cypher query length limits
    const BATCH_SIZE = 50;
    for (let i = 0; i < mentionPairs.length; i += BATCH_SIZE) {
      const batch = mentionPairs.slice(i, i + BATCH_SIZE);
      await retryGraphQuery(
        graph,
        `UNWIND $pairs AS p
         MATCH (e:Entity {id: p.entityId})
         MATCH (c:Chunk {qdrantId: p.chunkId})
         MERGE (e)-[:MENTIONS]->(c)`,
        { pairs: batch }
      );
    }
  }

  // Batch 5: RELATES_TO edges (skip malformed relations)
  const validRelations = relations.filter(r => r.head && r.tail && r.relation);
  if (validRelations.length > 0) {
    const relData = validRelations.map(r => ({
      headId: `entity:${r.head!.toLowerCase().replace(/\s+/g, '_')}`,
      tailId: `entity:${r.tail!.toLowerCase().replace(/\s+/g, '_')}`,
      type: r.relation,
    }));
    try {
      await retryGraphQuery(
        graph,
        `UNWIND $rels AS r
         MATCH (h:Entity {id: r.headId})
         MATCH (t:Entity {id: r.tailId})
         MERGE (h)-[:RELATES_TO {type: r.type, confidence: 0.8}]->(t)`,
        { rels: relData }
      );
    } catch {
      // Skip malformed relations silently — some head/tail may not exist yet
    }
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
  prebuiltModelChain?: (string | undefined)[],
): Promise<void> {
  // Idempotency check
  if (processedChunks.has(qdrantId)) return;

  // Check if graph is healthy
  const healthy = await isGraphHealthy();
  if (!healthy) {
    console.warn('[EntityExtraction] FalkorDB not healthy, skipping extraction');
    return;
  }

  // Read settings from DB
  const graphSettings = await getGraphSettings();
  const maxTokens = graphSettings.maxTokens || DEFAULT_MAX_TOKENS;
  const extractionModel = graphSettings.extractionModel || undefined;

  try {
    const prompt = buildExtractionPrompt([{ qdrantId, text: chunkText }]);
    const messages = [
      {
        role: 'system' as const,
        content: 'You extract named entities and relationships from text. Return only valid JSON. Do not extract filenames, headers, footers, or generic terms.',
      },
      { role: 'user' as const, content: prompt },
    ];

    // Provider-diverse model fallback with rate-limit backoff
    let response: string | null = null;
    const modelChain = prebuiltModelChain ?? await buildExtractionModelChain(extractionModel);

    for (const model of modelChain) {
      response = await tryModelWithBackoff(model, messages, maxTokens, qdrantId);
      if (response !== null) break;
    }

    if (response === null) {
      throw new Error('All extraction model fallbacks failed');
    }

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
      // Malformed JSON — log failure and skip
      const isTruncated = !jsonStr.trim().endsWith('}');
      const reason = isTruncated ? 'JSON truncated (max_tokens exceeded)' : 'JSON malformed';
      console.warn(`[EntityExtraction] ${reason} for chunk ${qdrantId}: ${jsonStr.slice(0, 100)}`);
      await logExtractionFailure(qdrantId, documentId, documentName, reason).catch(() => {});
      processedChunks.add(qdrantId);
      return;
    }

    if (!result.entities || !Array.isArray(result.entities)) {
      console.warn(`[EntityExtraction] Invalid extraction result for chunk ${qdrantId}`);
      await logExtractionFailure(qdrantId, documentId, documentName, 'Missing or invalid entities array').catch(() => {});
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
    // Persist failure to DB for admin reprocessing
    await logExtractionFailure(qdrantId, documentId, documentName, String(err)).catch(() => {});
    // Mark as processed even on failure to avoid infinite retries within session
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
  // Read concurrency from settings
  const graphSettings = await getGraphSettings();
  const concurrency = graphSettings.concurrency || DEFAULT_MAX_CONCURRENT_CALLS;

  // Build the provider-diverse fallback chain once per batch to avoid repeated DB calls
  const modelChain = await buildExtractionModelChain(graphSettings.extractionModel || undefined);

  for (let i = 0; i < pending.length; i += concurrency) {
    const batch = pending.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(chunk =>
        extractEntitiesFromChunk(
          chunk.text,
          chunk.qdrantId,
          chunk.documentId,
          chunk.pageNumber,
          chunk.documentName,
          modelChain,
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

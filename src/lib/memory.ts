/**
 * User Memory System
 *
 * Extracts and stores key facts about users per category context.
 * Memory persists across conversation threads and is injected into prompts.
 */

import { sql } from 'kysely';
import { getDb } from './db/kysely';
import { getMemorySettings } from './db/compat/config';
import { getLlmSettings } from './db/compat/config';
import { createInternalCompletion } from './llm-client';
import { createEmbedding } from './openai';
import { qdrantStore } from './vector-store/qdrant';
import type { ChunkMetadata } from '@/types';

// ============ Types ============

/**
 * A single memory fact with a timestamp for temporal filtering.
 * Backward compatible: old facts stored as plain strings are treated
 * as having no timestamp (always included).
 */
export interface FactEntry {
  text: string;
  timestamp?: string;  // ISO date string, undefined for legacy facts
}

export interface UserMemory {
  id: number;
  userId: number;
  categoryId: number | null;
  facts: FactEntry[];
  createdAt: string;
  updatedAt: string;
}

interface DbUserMemory {
  id: number;
  user_id: number;
  category_id: number | null;
  facts_json: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryStats {
  usersWithMemory: number;
  totalFacts: number;
  categoriesActive: number;
  extractionsToday: number;
}

// ============ Memory Extraction Prompt ============

const MEMORY_EXTRACTION_PROMPT = `You are a memory extraction assistant. Analyze the conversation and extract key facts about the user that would be helpful to remember for future conversations.

Focus on:
- User's role, department, or position
- Projects they're working on
- Preferences for response style or detail level
- Specific topics or areas they frequently ask about
- Important context about their work

Current stored facts (avoid duplicates):
{existingFacts}

Conversation to analyze:
{messages}

Return a JSON array of new facts to remember. Each fact should be a concise statement (1-2 sentences max).
Keep only the most relevant and actionable facts (max {maxFacts} total including existing).

IMPORTANT: Return ONLY a valid JSON array of strings, nothing else. Example:
["User is a compliance officer", "Prefers detailed responses with citations"]

If no new facts worth remembering, return an empty array: []`;

// ============ Vector Store ============

/** Qdrant collection name for user memory facts */
const USER_MEMORY_COLLECTION = 'user_memories';

// ============ Helper ============

/**
 * Parse facts_json with backward compatibility.
 * Old format: string[] (plain strings)
 * New format: FactEntry[] (objects with text + timestamp)
 */
function parseFacts(factsJson: string): FactEntry[] {
  const parsed = JSON.parse(factsJson);
  if (!Array.isArray(parsed)) return [];

  // Check if it's the old format (plain strings) or new format (FactEntry objects)
  if (parsed.length > 0 && typeof parsed[0] === 'string') {
    // Old format: convert to FactEntry[] with no timestamp
    return (parsed as string[]).map(text => ({ text }));
  }

  // New format: already FactEntry[]
  return parsed as FactEntry[];
}

/**
 * Extract just the text from FactEntry[] for operations that need plain strings.
 */
function factTexts(facts: FactEntry[]): string[] {
  return facts.map(f => f.text);
}

/**
 * Filter facts by max age, keeping facts within the specified number of days.
 * Facts without a timestamp (legacy) are always included.
 */
function filterFactsByAge(facts: FactEntry[], maxAgeDays: number): FactEntry[] {
  if (maxAgeDays <= 0) return facts; // 0 or negative means no filtering

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);

  return facts.filter(f => {
    if (!f.timestamp) return true; // Legacy facts always included
    return new Date(f.timestamp) >= cutoff;
  });
}

function toUserMemory(row: DbUserMemory): UserMemory {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    facts: parseFacts(row.facts_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============ Database Operations ============

/**
 * Get memory for a user in a specific category
 */
export async function getMemoryForUser(userId: number, categoryId: number | null = null): Promise<UserMemory | null> {
  const db = await getDb();
  let query = db
    .selectFrom('user_memories')
    .selectAll()
    .where('user_id', '=', userId);

  if (categoryId === null) {
    query = query.where('category_id', 'is', null);
  } else {
    query = query.where('category_id', '=', categoryId);
  }

  const row = await query.executeTakeFirst();
  if (!row) return null;

  return toUserMemory(row as unknown as DbUserMemory);
}

/**
 * Get all memories for a user (across all categories)
 */
export async function getAllMemoriesForUser(userId: number): Promise<UserMemory[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('user_memories')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('category_id')
    .execute();

  return rows.map((row) => toUserMemory(row as unknown as DbUserMemory));
}

/**
 * Update memory for a user in a specific category
 *
 * Accepts either string[] (plain facts) or FactEntry[] (facts with timestamps).
 * When string[] is provided, timestamps are added automatically for new facts
 * and preserved from existing facts where possible.
 */
export async function updateMemory(userId: number, categoryId: number | null, facts: string[] | FactEntry[]): Promise<UserMemory> {
  const db = await getDb();
  const existingMemory = await getMemoryForUser(userId, categoryId);

  // Normalize to FactEntry[] with timestamps for persistence
  const now = new Date().toISOString();
  const factEntries: FactEntry[] = facts.map(fact => {
    if (typeof fact === 'string') {
      // Preserve timestamp from existing fact if it already exists
      const existing = existingMemory?.facts.find(f => f.text === fact);
      return { text: fact, timestamp: existing?.timestamp ?? now };
    }
    return fact; // Already FactEntry
  });

  // Store as FactEntry[] (with timestamps) for temporal filtering support
  const factsJson = JSON.stringify(factEntries);

  if (existingMemory) {
    // Update existing memory
    let updateQuery = db
      .updateTable('user_memories')
      .set({
        facts_json: factsJson,
        updated_at: new Date().toISOString(),
      })
      .where('user_id', '=', userId);

    if (categoryId === null) {
      updateQuery = updateQuery.where('category_id', 'is', null);
    } else {
      updateQuery = updateQuery.where('category_id', '=', categoryId);
    }

    await updateQuery.execute();
  } else {
    // Insert new memory
    await db
      .insertInto('user_memories')
      .values({
        user_id: userId,
        category_id: categoryId,
        facts_json: factsJson,
      })
      .execute();
  }

  const result = (await getMemoryForUser(userId, categoryId))!;

  // Sync to vector store for semantic retrieval (non-blocking)
  // Pass plain strings for vector storage (text content only)
  const factTexts = factEntries.map(f => f.text);
  syncMemoryToVectorStore(userId, categoryId, factTexts).catch(() => {});

  return result;
}

/**
 * Sync user memory facts to vector store for semantic retrieval.
 *
 * Embeds each fact and stores it in the user_memories Qdrant collection.
 * Called automatically after updateMemory().
 */
export async function syncMemoryToVectorStore(userId: number, categoryId: number | null, facts: string[]): Promise<void> {
  if (facts.length === 0) return;

  try {
    // Check if Qdrant is healthy
    const healthy = await qdrantStore.healthCheck();
    if (!healthy) {
      console.warn('[Memory] Qdrant not available, skipping vector sync');
      return;
    }

    // Create embeddings for all facts
    const embeddings = await Promise.all(
      facts.map(fact => createEmbedding(fact))
    );

    // Build document IDs: user_<userId>_cat_<categoryId>_<index>
    const ids = facts.map((_, i) => `user_${userId}_cat_${categoryId ?? 'global'}_${i}`);

    // Build metadata for each fact
    // Use a partial metadata shape compatible with ChunkMetadata
    const metadatas: ChunkMetadata[] = facts.map((fact, i) => ({
      documentId: ids[i],
      documentName: `User Memory - User ${userId}`,
      pageNumber: 0,
      chunkIndex: i,
      source: 'user' as const,
      userId: String(userId),
      categoryId: categoryId !== null ? String(categoryId) : undefined,
    }));

    // Delete existing memory vectors for this user+category first
    const deleteFilter: Record<string, unknown> = { userId };
    if (categoryId !== null) {
      deleteFilter.categoryId = String(categoryId);
    }
    await qdrantStore.deleteDocumentsByFilter(USER_MEMORY_COLLECTION, deleteFilter);

    // Add new vectors
    await qdrantStore.addDocuments(USER_MEMORY_COLLECTION, ids, embeddings, facts, metadatas);

    console.log(`[Memory] Synced ${facts.length} facts to vector store for user ${userId}, category ${categoryId}`);
  } catch (error) {
    // Non-blocking: log warning but don't fail the memory update
    console.warn('[Memory] Failed to sync facts to vector store:', error);
  }
}

/**
 * Delete a single fact from a user's memory category.
 * Removes the fact from the stored array and updates the vector store.
 * Preserves timestamps on remaining facts.
 */
export async function deleteFact(
  userId: number,
  categoryId: number | null,
  factText: string
): Promise<UserMemory> {
  const memory = await getMemoryForUser(userId, categoryId);
  if (!memory) {
    throw new Error('Memory not found');
  }

  // Filter out the fact to delete (by text match)
  const filteredFacts = memory.facts.filter(f => f.text !== factText);

  // If nothing changed, the fact wasn't found
  if (filteredFacts.length === memory.facts.length) {
    throw new Error('Fact not found');
  }

  // Persist the updated fact list (preserving FactEntry format with timestamps)
  // updateMemory handles persistence + vector store sync
  return updateMemory(userId, categoryId, filteredFacts);
}

/**
 * Clear memory for a user in a specific category
 */
export async function clearMemory(userId: number, categoryId?: number | null): Promise<void> {

  const db = await getDb();

  if (categoryId === undefined) {
    // Clear all memories for user
    await db.deleteFrom('user_memories').where('user_id', '=', userId).execute();
  } else {
    // Clear specific category memory
    let deleteQuery = db
      .deleteFrom('user_memories')
      .where('user_id', '=', userId);

    if (categoryId === null) {
      deleteQuery = deleteQuery.where('category_id', 'is', null);
    } else {
      deleteQuery = deleteQuery.where('category_id', '=', categoryId);
    }

    await deleteQuery.execute();
  }

  // Also clean up Qdrant vectors (non-blocking)
  try {
    const healthy = await qdrantStore.healthCheck();
    if (healthy) {
      const deleteFilter: Record<string, unknown> = { userId };
      if (categoryId !== undefined && categoryId !== null) {
        deleteFilter.categoryId = String(categoryId);
      }
      await qdrantStore.deleteDocumentsByFilter(USER_MEMORY_COLLECTION, deleteFilter);
      console.log(`[Memory] Cleaned up Qdrant vectors for user ${userId}, category ${categoryId}`);
    }
  } catch (error) {
    console.warn('[Memory] Failed to clean up Qdrant vectors:', error);
  }
}

/**
 * Get memory statistics for admin dashboard
 */
export async function getMemoryStats(): Promise<MemoryStats> {
  const db = await getDb();

  const usersWithMemoryResult = await db
    .selectFrom('user_memories')
    .select(db.fn.count<number>('user_id').distinct().as('count'))
    .executeTakeFirst();
  const usersWithMemory = usersWithMemoryResult?.count ?? 0;

  const totalFactsRows = await db
    .selectFrom('user_memories')
    .select('facts_json')
    .execute();
  const totalFacts = totalFactsRows.reduce((sum, row) => {
    try {
      const facts = parseFacts(row.facts_json);
      return sum + facts.length;
    } catch {
      return sum;
    }
  }, 0);

  const categoriesActiveResult = await db
    .selectFrom('user_memories')
    .select(db.fn.count<number>('category_id').distinct().as('count'))
    .where('category_id', 'is not', null)
    .executeTakeFirst();
  const categoriesActive = categoriesActiveResult?.count ?? 0;

  // Count memories updated today
  const extractionsTodayResult = await db
    .selectFrom('user_memories')
    .select(db.fn.countAll<number>().as('count'))
    .where(sql`DATE(updated_at)`, '=', sql`DATE(NOW())`)
    .executeTakeFirst();
  const extractionsToday = extractionsTodayResult?.count ?? 0;

  return {
    usersWithMemory: Number(usersWithMemory),
    totalFacts,
    categoriesActive: Number(categoriesActive),
    extractionsToday: Number(extractionsToday),
  };
}

// ============ Memory Extraction ============

/**
 * Extract facts from a conversation using LLM
 */
export async function extractFacts(
  messages: Array<{ role: string; content: string }>,
  existingFacts: string[] = [],
  maxFacts: number = 20
): Promise<string[]> {
  const settings = await getMemorySettings();
  if (!settings.enabled) {
    return existingFacts;
  }

  // Check if we have enough messages to extract from
  if (messages.length < settings.extractionThreshold) {
    return existingFacts;
  }

  const llmSettings = await getLlmSettings();

  // Format messages for the prompt
  const formattedMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const prompt = MEMORY_EXTRACTION_PROMPT
    .replace('{existingFacts}', existingFacts.length > 0 ? JSON.stringify(existingFacts) : 'None')
    .replace('{messages}', formattedMessages)
    .replace('{maxFacts}', String(maxFacts));

  try {
    // Get memory settings for configurable max tokens
    const memorySettings = await getMemorySettings();

    const content = await createInternalCompletion({
      model: llmSettings.model,
      messages: [
        {
          role: 'system',
          content: 'You are a memory extraction assistant. Extract key facts from conversations and return them as a JSON array.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      maxTokens: memorySettings.extractionMaxTokens ?? 1000,
    }) || '[]';

    // Parse the response as JSON array
    try {
      // Try to extract JSON array from the response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        let jsonStr = jsonMatch[0];
        let newFacts: string[];
        try {
          newFacts = JSON.parse(jsonStr) as string[];
        } catch {
          // Attempt to repair truncated JSON: trim to last complete string entry
          const lastComplete = jsonStr.lastIndexOf('",');
          const lastSingle = jsonStr.lastIndexOf('"');
          const cutoff = lastComplete > 0 ? lastComplete + 1 : lastSingle > 0 ? lastSingle + 1 : -1;
          if (cutoff > 1) {
            jsonStr = jsonStr.slice(0, cutoff) + ']';
            newFacts = JSON.parse(jsonStr) as string[];
          } else {
            throw new Error('Cannot repair truncated JSON array');
          }
        }
        // Combine with existing facts, remove duplicates, limit to maxFacts
        const allFacts = [...new Set([...existingFacts, ...newFacts])];
        return allFacts.slice(0, maxFacts);
      }
    } catch (parseError) {
      console.error('[Memory] Failed to parse extracted facts:', parseError);
    }

    return existingFacts;
  } catch (error) {
    console.error('[Memory] Failed to extract facts:', error);
    return existingFacts;
  }
}

/**
 * Format memory facts for injection into system prompt.
 *
 * Accepts FactEntry[] and applies temporal filtering based on settings.
 * Falls back to plain string[] for backward compatibility.
 */
export function formatMemoryForPrompt(facts: string[] | FactEntry[]): string {
  // Normalize to string[] for display
  let displayFacts: string[];

  if (facts.length === 0) return '';

  if (typeof facts[0] === 'string') {
    displayFacts = facts as string[];
  } else {
    displayFacts = (facts as FactEntry[]).map(f => f.text);
  }

  if (displayFacts.length === 0) return '';

  return `
## User Context (Memory)
The following facts are known about this user from previous conversations:
${displayFacts.map((fact) => `- ${fact}`).join('\n')}

Use this context to provide more personalized and relevant responses.
`;
}

/**
 * Get memory context for a user (combines global and category-specific).
 *
 * When a query string is provided, uses semantic search against the vector store
 * to retrieve only the most relevant facts. Falls back to SQLite full-scan if
 * the vector store is unavailable.
 */
export async function getMemoryContext(
  userId: number,
  activeCategoryId: number | null = null,
  query?: string
): Promise<string> {
  const settings = await getMemorySettings();
  if (!settings.enabled) {
    return '';
  }

  // If a query is provided, try semantic retrieval from vector store
  if (query && query.trim()) {
    try {
      const healthy = await qdrantStore.healthCheck();
      if (healthy) {
        // Embed the query
        const queryEmbedding = await createEmbedding(query.trim());

        // Query the user_memories collection for relevant facts
        const result = await qdrantStore.query(
          USER_MEMORY_COLLECTION,
          queryEmbedding,
          settings.maxFactsPerQuery ?? 10,
          { userId }
        );

        if (result.documents.length > 0) {
          console.log(`[Memory] Semantic retrieval returned ${result.documents.length} relevant facts for user ${userId}`);

          // Apply category + age post-filtering
          // Qdrant does not support OR-filter natively, so we post-filter in JS
          const filteredDocs: string[] = [];
          for (let i = 0; i < result.documents.length; i++) {
            const metadata = result.metadatas[i] as unknown as Record<string, unknown> | undefined;

            // Category isolation: keep global facts (no categoryId) + active category facts
            if (activeCategoryId !== null) {
              const factCategoryId = metadata?.categoryId as string | undefined;
              if (factCategoryId !== undefined && factCategoryId !== String(activeCategoryId)) {
                continue; // Skip facts from other categories
              }
            }

            // Temporal filtering
            if (settings.factMaxAgeDays > 0) {
              const timestamp = metadata?.timestamp as string | undefined;
              if (timestamp) {
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - settings.factMaxAgeDays);
                if (new Date(timestamp) < cutoff) {
                  continue; // Skip expired facts
                }
              }
              // Legacy facts without timestamp always included
            }

            filteredDocs.push(result.documents[i]);
          }
          if (filteredDocs.length > 0) {
            return formatMemoryForPrompt(filteredDocs);
          }
          // If all results filtered out, fall through to SQLite fallback
          console.log(`[Memory] All ${result.documents.length} semantic results filtered out, falling back to SQLite`);
        }
      }
    } catch (error) {
      // Fall through to SQLite fallback
      console.warn('[Memory] Semantic retrieval failed, falling back to SQLite:', error);
    }
  }

  // Fallback: SQLite full-scan (original behavior)
  const allFacts: FactEntry[] = [];

  // Get global memory (category_id = null)
  const globalMemory = await getMemoryForUser(userId, null);
  if (globalMemory) {
    allFacts.push(...globalMemory.facts);
  }

  // Get category-specific memory (only the active category)
  if (activeCategoryId !== null) {
    const categoryMemory = await getMemoryForUser(userId, activeCategoryId);
    if (categoryMemory) {
      allFacts.push(...categoryMemory.facts);
    }
  }

  // Apply temporal filtering
  const filteredFacts = filterFactsByAge(allFacts, settings.factMaxAgeDays);

  // Remove duplicates by text
  const seen = new Set<string>();
  const uniqueFacts: FactEntry[] = [];
  for (const fact of filteredFacts) {
    if (!seen.has(fact.text)) {
      seen.add(fact.text);
      uniqueFacts.push(fact);
    }
  }

  return formatMemoryForPrompt(uniqueFacts);
}

/**
 * Process a conversation and update memory if needed
 *
 * Converts extracted string[] facts to FactEntry[] with timestamps
 * for temporal tracking before persisting.
 */
export async function processConversationForMemory(
  userId: number,
  categoryId: number | null,
  messages: Array<{ role: string; content: string }>
): Promise<void> {
  const settings = await getMemorySettings();
  if (!settings.enabled) {
    return;
  }

  // Get existing memory
  const existingMemory = await getMemoryForUser(userId, categoryId);
  const existingFacts = existingMemory?.facts || [];

  // Extract new facts (extractFacts works with string[])
  const existingTexts = factTexts(existingFacts);
  const newTexts = await extractFacts(
    messages,
    existingTexts,
    settings.maxFactsPerCategory
  );

  // Convert string[] to FactEntry[] with timestamps
  const now = new Date().toISOString();
  const newFactEntries: FactEntry[] = newTexts.map(text => {
    // Preserve timestamp from existing fact if it already exists
    const existing = existingFacts.find(f => f.text === text);
    return {
      text,
      timestamp: existing?.timestamp ?? now,
    };
  });

  // Update memory if facts changed (order-independent comparison by text only)
  const newTextSet = new Set(newTexts);
  const existingTextSet = new Set(factTexts(existingFacts));
  const factsChanged =
    newTextSet.size !== existingTextSet.size ||
    ![...newTextSet].every(t => existingTextSet.has(t));

  if (factsChanged) {
    await updateMemory(userId, categoryId, newTexts);
    console.log(`[Memory] Updated memory for user ${userId}, category ${categoryId}: ${newTexts.length} facts`);
  }
}

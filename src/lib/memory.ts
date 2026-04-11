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

// ============ Types ============

export interface UserMemory {
  id: number;
  userId: number;
  categoryId: number | null;
  facts: string[];
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

// ============ Helper ============

function toUserMemory(row: DbUserMemory): UserMemory {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    facts: JSON.parse(row.facts_json) as string[],
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
 */
export async function updateMemory(userId: number, categoryId: number | null, facts: string[]): Promise<UserMemory> {
  const db = await getDb();
  const existingMemory = await getMemoryForUser(userId, categoryId);

  if (existingMemory) {
    // Update existing memory
    let updateQuery = db
      .updateTable('user_memories')
      .set({
        facts_json: JSON.stringify(facts),
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
        facts_json: JSON.stringify(facts),
      })
      .execute();
  }

  return (await getMemoryForUser(userId, categoryId))!;
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
      const facts = JSON.parse(row.facts_json) as string[];
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
 * Format memory facts for injection into system prompt
 */
export function formatMemoryForPrompt(facts: string[]): string {
  if (facts.length === 0) return '';

  return `
## User Context (Memory)
The following facts are known about this user from previous conversations:
${facts.map((fact) => `- ${fact}`).join('\n')}

Use this context to provide more personalized and relevant responses.
`;
}

/**
 * Get memory context for a user (combines global and category-specific)
 */
export async function getMemoryContext(userId: number, categoryIds: number[] = []): Promise<string> {
  const settings = await getMemorySettings();
  if (!settings.enabled) {
    return '';
  }

  const allFacts: string[] = [];

  // Get global memory (category_id = null)
  const globalMemory = await getMemoryForUser(userId, null);
  if (globalMemory) {
    allFacts.push(...globalMemory.facts);
  }

  // Get category-specific memories
  for (const categoryId of categoryIds) {
    const categoryMemory = await getMemoryForUser(userId, categoryId);
    if (categoryMemory) {
      allFacts.push(...categoryMemory.facts);
    }
  }

  // Remove duplicates
  const uniqueFacts = [...new Set(allFacts)];

  return formatMemoryForPrompt(uniqueFacts);
}

/**
 * Process a conversation and update memory if needed
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

  // Extract new facts
  const newFacts = await extractFacts(
    messages,
    existingFacts,
    settings.maxFactsPerCategory
  );

  // Update memory if facts changed
  if (JSON.stringify(newFacts) !== JSON.stringify(existingFacts)) {
    await updateMemory(userId, categoryId, newFacts);
    console.log(`[Memory] Updated memory for user ${userId}, category ${categoryId}: ${newFacts.length} facts`);
  }
}

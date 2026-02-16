/**
 * User Memory System
 *
 * Extracts and stores key facts about users per category context.
 * Memory persists across conversation threads and is injected into prompts.
 */

import { execute, queryOne, queryAll } from './db';
import { getMemorySettings } from './db/config';
import { getLlmSettings } from './db/config';
import OpenAI from 'openai';
import { getApiKey } from '@/lib/provider-helpers';

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

// ============ Database Operations ============

/**
 * Get memory for a user in a specific category
 */
export function getMemoryForUser(userId: number, categoryId: number | null = null): UserMemory | null {
  const row = queryOne<DbUserMemory>(
    `SELECT * FROM user_memories WHERE user_id = ? AND ${categoryId === null ? 'category_id IS NULL' : 'category_id = ?'}`,
    categoryId === null ? [userId] : [userId, categoryId]
  );

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    facts: JSON.parse(row.facts_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get all memories for a user (across all categories)
 */
export function getAllMemoriesForUser(userId: number): UserMemory[] {
  const rows = queryAll<DbUserMemory>(
    'SELECT * FROM user_memories WHERE user_id = ? ORDER BY category_id',
    [userId]
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    facts: JSON.parse(row.facts_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Update memory for a user in a specific category
 */
export function updateMemory(userId: number, categoryId: number | null, facts: string[]): UserMemory {
  const existingMemory = getMemoryForUser(userId, categoryId);

  if (existingMemory) {
    // Update existing memory
    execute(
      `UPDATE user_memories SET facts_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND ${categoryId === null ? 'category_id IS NULL' : 'category_id = ?'}`,
      categoryId === null ? [JSON.stringify(facts), userId] : [JSON.stringify(facts), userId, categoryId]
    );
  } else {
    // Insert new memory
    execute(
      'INSERT INTO user_memories (user_id, category_id, facts_json) VALUES (?, ?, ?)',
      [userId, categoryId, JSON.stringify(facts)]
    );
  }

  return getMemoryForUser(userId, categoryId)!;
}

/**
 * Clear memory for a user in a specific category
 */
export function clearMemory(userId: number, categoryId?: number | null): void {
  if (categoryId === undefined) {
    // Clear all memories for user
    execute('DELETE FROM user_memories WHERE user_id = ?', [userId]);
  } else {
    // Clear specific category memory
    execute(
      `DELETE FROM user_memories WHERE user_id = ? AND ${categoryId === null ? 'category_id IS NULL' : 'category_id = ?'}`,
      categoryId === null ? [userId] : [userId, categoryId]
    );
  }
}

/**
 * Get memory statistics for admin dashboard
 */
export function getMemoryStats(): MemoryStats {
  const usersWithMemory = queryOne<{ count: number }>(
    'SELECT COUNT(DISTINCT user_id) as count FROM user_memories'
  )?.count || 0;

  const totalFactsResult = queryAll<{ facts_json: string }>(
    'SELECT facts_json FROM user_memories'
  );
  const totalFacts = totalFactsResult.reduce((sum, row) => {
    try {
      const facts = JSON.parse(row.facts_json) as string[];
      return sum + facts.length;
    } catch {
      return sum;
    }
  }, 0);

  const categoriesActive = queryOne<{ count: number }>(
    'SELECT COUNT(DISTINCT category_id) as count FROM user_memories WHERE category_id IS NOT NULL'
  )?.count || 0;

  // For extractions today, we'd need to track this separately
  // For now, count memories updated today
  const extractionsToday = queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM user_memories WHERE DATE(updated_at) = DATE('now')"
  )?.count || 0;

  return {
    usersWithMemory,
    totalFacts,
    categoriesActive,
    extractionsToday,
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
  const settings = getMemorySettings();
  if (!settings.enabled) {
    return existingFacts;
  }

  // Check if we have enough messages to extract from
  if (messages.length < settings.extractionThreshold) {
    return existingFacts;
  }

  const llmSettings = getLlmSettings();

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
    // When using LiteLLM proxy, use LITELLM_MASTER_KEY for authentication
    // Otherwise use centralized provider helper (DB-first, then env var fallback)
    const baseURL = process.env.OPENAI_BASE_URL || undefined;
    const apiKey = process.env.OPENAI_BASE_URL
      ? (process.env.LITELLM_MASTER_KEY || getApiKey('openai'))
      : getApiKey('openai');

    const client = new OpenAI({
      baseURL,
      apiKey: apiKey || '',
    });

    // Get memory settings for configurable max tokens
    const memorySettings = getMemorySettings();

    const response = await client.chat.completions.create({
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
      max_tokens: memorySettings.extractionMaxTokens ?? 1000,
    });

    const content = response.choices[0]?.message?.content?.trim() || '[]';

    // Parse the response as JSON array
    try {
      // Try to extract JSON array from the response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const newFacts = JSON.parse(jsonMatch[0]) as string[];
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
export function getMemoryContext(userId: number, categoryIds: number[] = []): string {
  const settings = getMemorySettings();
  if (!settings.enabled) {
    return '';
  }

  const allFacts: string[] = [];

  // Get global memory (category_id = null)
  const globalMemory = getMemoryForUser(userId, null);
  if (globalMemory) {
    allFacts.push(...globalMemory.facts);
  }

  // Get category-specific memories
  for (const categoryId of categoryIds) {
    const categoryMemory = getMemoryForUser(userId, categoryId);
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
  const settings = getMemorySettings();
  if (!settings.enabled) {
    return;
  }

  // Get existing memory
  const existingMemory = getMemoryForUser(userId, categoryId);
  const existingFacts = existingMemory?.facts || [];

  // Extract new facts
  const newFacts = await extractFacts(
    messages,
    existingFacts,
    settings.maxFactsPerCategory
  );

  // Update memory if facts changed
  if (JSON.stringify(newFacts) !== JSON.stringify(existingFacts)) {
    updateMemory(userId, categoryId, newFacts);
    console.log(`[Memory] Updated memory for user ${userId}, category ${categoryId}: ${newFacts.length} facts`);
  }
}

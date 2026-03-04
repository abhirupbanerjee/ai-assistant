/**
 * Category Prompts Database Operations - Async Compatibility Layer
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb } from '../kysely';

// Re-export types and constants from sync module
export type { StarterPrompt, CategoryPrompt, CategoryPromptRow } from '../category-prompts';
export {
  MAX_COMBINED_PROMPT_LENGTH,
  MAX_STARTER_PROMPTS,
  MAX_STARTER_LABEL_LENGTH,
  MAX_STARTER_PROMPT_LENGTH,
} from '../utils';

import type { StarterPrompt, CategoryPrompt } from '../category-prompts';

// Forbidden phrases for prompt validation
const FORBIDDEN_PHRASES = [
  'ignore previous',
  'disregard',
  'system:',
  'assistant:',
  'ignore above',
  'forget all',
  'new instructions',
  'override',
];

/**
 * Validate prompt addendum content (async — reads config from DB)
 */
export async function validatePromptAddendum(content: string): Promise<string[]> {
  const errors: string[] = [];

  if (!content || content.trim().length === 0) {
    errors.push('Prompt addendum cannot be empty');
    return errors;
  }

  const lowerContent = content.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (lowerContent.includes(phrase.toLowerCase())) {
      errors.push(`Prompt contains forbidden phrase: "${phrase}"`);
    }
  }

  const charInfo = await getPromptCharacterInfo();
  if (content.length > charInfo.availableForCategory) {
    errors.push(
      `Prompt exceeds character limit. ` +
      `Available: ${charInfo.availableForCategory}, Provided: ${content.length}`
    );
  }

  return errors;
}

/**
 * Validate starter prompts array (async — reads config from DB)
 */
export async function validateStarterPrompts(starters: StarterPrompt[]): Promise<string[]> {
  const errors: string[] = [];
  const maxStarters = await getMaxStarterPrompts();
  const maxLabelLength = await getMaxStarterLabelLength();
  const maxPromptLength = await getMaxStarterPromptLength();

  if (starters.length > maxStarters) {
    errors.push(`Maximum ${maxStarters} starter prompts allowed`);
  }

  starters.forEach((starter, index) => {
    if (!starter.label || starter.label.trim().length === 0) {
      errors.push(`Starter ${index + 1}: Label is required`);
    } else if (starter.label.length > maxLabelLength) {
      errors.push(`Starter ${index + 1}: Label exceeds ${maxLabelLength} characters`);
    }
    if (!starter.prompt || starter.prompt.trim().length === 0) {
      errors.push(`Starter ${index + 1}: Prompt is required`);
    } else if (starter.prompt.length > maxPromptLength) {
      errors.push(`Starter ${index + 1}: Prompt exceeds ${maxPromptLength} characters`);
    }
  });

  return errors;
}

// ============ Helper Functions ============

interface DbCategoryPromptRow {
  category_id: number;
  prompt_addendum: string;
  starter_prompts: string | null;
  welcome_title: string | null;
  welcome_message: string | null;
  updated_at: string;
  updated_by: string;
}

function parseStarterPrompts(json: string | null): StarterPrompt[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as StarterPrompt[];
    return parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function mapDbToCategoryPrompt(row: DbCategoryPromptRow): CategoryPrompt {
  return {
    categoryId: row.category_id,
    promptAddendum: row.prompt_addendum,
    starterPrompts: parseStarterPrompts(row.starter_prompts),
    welcomeTitle: row.welcome_title,
    welcomeMessage: row.welcome_message,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

// ============ Dynamic Limit Getters (async, using Kysely via compat/config) ============

import { getTokenLimitsSettings, getSystemPrompt } from './config';

/**
 * Get the maximum combined prompt length (global + category) in characters
 * Dynamically calculated from token limits (~4 chars per token)
 */
export async function getMaxCombinedPromptLength(): Promise<number> {
  const settings = await getTokenLimitsSettings();
  return (settings.systemPromptMaxTokens + settings.categoryPromptMaxTokens) * 4;
}

/**
 * Get maximum number of starter prompts per category
 */
export async function getMaxStarterPrompts(): Promise<number> {
  const settings = await getTokenLimitsSettings();
  return settings.maxStartersPerCategory;
}

/**
 * Get maximum starter label length in characters
 */
export async function getMaxStarterLabelLength(): Promise<number> {
  const settings = await getTokenLimitsSettings();
  return settings.starterLabelMaxChars;
}

/**
 * Get maximum starter prompt length in characters
 */
export async function getMaxStarterPromptLength(): Promise<number> {
  const settings = await getTokenLimitsSettings();
  return settings.starterPromptMaxChars;
}

/**
 * Get resolved system prompt for a category
 * Combines global system prompt with category-specific addendum
 */
export async function getResolvedSystemPrompt(categoryId?: number): Promise<string> {
  const globalPrompt = await getSystemPrompt();

  if (!categoryId) {
    return globalPrompt;
  }

  const categoryPrompt = await getCategoryPrompt(categoryId);

  if (!categoryPrompt || !categoryPrompt.promptAddendum) {
    return globalPrompt;
  }

  return `${globalPrompt}\n\n--- Category-Specific Guidelines ---\n\n${categoryPrompt.promptAddendum}`;
}

/**
 * Get available character limit for category addendum
 * Calculated as: max combined prompt length - global prompt length
 */
export async function getAvailableCharLimit(): Promise<number> {
  const globalPrompt = await getSystemPrompt();
  const maxCombined = await getMaxCombinedPromptLength();
  const available = maxCombined - globalPrompt.length;
  return Math.max(0, available);
}

/**
 * Get character counts for UI display
 */
export async function getPromptCharacterInfo(categoryId?: number): Promise<{
  globalLength: number;
  categoryLength: number;
  combinedLength: number;
  availableForCategory: number;
  maxCombined: number;
}> {
  const globalPrompt = await getSystemPrompt();
  const globalLength = globalPrompt.length;
  const maxCombined = await getMaxCombinedPromptLength();

  let categoryLength = 0;
  if (categoryId) {
    const categoryPrompt = await getCategoryPrompt(categoryId);
    categoryLength = categoryPrompt?.promptAddendum?.length || 0;
  }

  const separatorLength = categoryLength > 0 ? '\n\n--- Category-Specific Guidelines ---\n\n'.length : 0;
  const combinedLength = globalLength + separatorLength + categoryLength;
  const availableForCategory = maxCombined - globalLength - separatorLength;

  return {
    globalLength,
    categoryLength,
    combinedLength,
    availableForCategory: Math.max(0, availableForCategory),
    maxCombined,
  };
}

// ============ Read Operations ============

/**
 * Get category prompt addendum by category ID
 */
export async function getCategoryPrompt(categoryId: number): Promise<CategoryPrompt | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('category_prompts')
    .select([
      'category_id',
      'prompt_addendum',
      'starter_prompts',
      'welcome_title',
      'welcome_message',
      'updated_at',
      'updated_by',
    ])
    .where('category_id', '=', categoryId)
    .executeTakeFirst();

  return row ? mapDbToCategoryPrompt(row as unknown as DbCategoryPromptRow) : undefined;
}

/**
 * Get all category prompts
 */
export async function getAllCategoryPrompts(): Promise<CategoryPrompt[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('category_prompts')
    .select([
      'category_id',
      'prompt_addendum',
      'starter_prompts',
      'welcome_title',
      'welcome_message',
      'updated_at',
      'updated_by',
    ])
    .orderBy('category_id')
    .execute();

  return rows.map((row) => mapDbToCategoryPrompt(row as unknown as DbCategoryPromptRow));
}

// ============ Write Operations ============

/**
 * Set or update category prompt addendum
 */
export async function setCategoryPrompt(
  categoryId: number,
  promptAddendum: string,
  updatedBy: string
): Promise<CategoryPrompt> {
  // Validate category exists
  const { getCategoryById } = await import('./categories');
  const category = await getCategoryById(categoryId);
  if (!category) {
    throw new Error(`Category with ID ${categoryId} does not exist`);
  }

  // Validate character limit
  const charInfo = await getPromptCharacterInfo();
  if (promptAddendum.length > charInfo.availableForCategory) {
    throw new Error(
      `Prompt addendum exceeds available character limit. ` +
      `Available: ${charInfo.availableForCategory}, Provided: ${promptAddendum.length}`
    );
  }

  const db = await getDb();

  // Upsert the category prompt
  await db
    .insertInto('category_prompts')
    .values({
      category_id: categoryId,
      prompt_addendum: promptAddendum,
      updated_by: updatedBy,
    })
    .onConflict((oc) =>
      oc.column('category_id').doUpdateSet({
        prompt_addendum: promptAddendum,
        updated_by: updatedBy,
      })
    )
    .execute();

  return (await getCategoryPrompt(categoryId))!;
}

/**
 * Delete category prompt (reset to using global prompt only)
 */
export async function deleteCategoryPrompt(categoryId: number): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('category_prompts')
    .where('category_id', '=', categoryId)
    .executeTakeFirst();

  return (result.numDeletedRows ?? 0) > 0;
}

/**
 * Set starter prompts for a category
 */
export async function setCategoryStarterPrompts(
  categoryId: number,
  starters: StarterPrompt[] | null,
  updatedBy: string
): Promise<void> {
  // Validate category exists
  const { getCategoryById } = await import('./categories');
  const category = await getCategoryById(categoryId);
  if (!category) {
    throw new Error(`Category with ID ${categoryId} does not exist`);
  }

  // Validate starters
  if (starters && starters.length > 0) {
    const errors = await validateStarterPrompts(starters);
    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(', ')}`);
    }
  }

  const startersJson = starters && starters.length > 0 ? JSON.stringify(starters) : null;
  const db = await getDb();

  // Check if row exists
  const existing = await db
    .selectFrom('category_prompts')
    .select('category_id')
    .where('category_id', '=', categoryId)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable('category_prompts')
      .set({
        starter_prompts: startersJson,
        updated_by: updatedBy,
      })
      .where('category_id', '=', categoryId)
      .execute();
  } else {
    await db
      .insertInto('category_prompts')
      .values({
        category_id: categoryId,
        prompt_addendum: '',
        starter_prompts: startersJson,
        updated_by: updatedBy,
      })
      .execute();
  }
}

/**
 * Set welcome messages for a category
 */
export async function setCategoryWelcome(
  categoryId: number,
  welcomeTitle: string | null,
  welcomeMessage: string | null,
  updatedBy: string
): Promise<void> {
  // Validate category exists
  const { getCategoryById } = await import('./categories');
  const category = await getCategoryById(categoryId);
  if (!category) {
    throw new Error(`Category with ID ${categoryId} does not exist`);
  }

  // Validate lengths
  if (welcomeTitle && welcomeTitle.length > 50) {
    throw new Error('Welcome title exceeds 50 characters');
  }
  if (welcomeMessage && welcomeMessage.length > 200) {
    throw new Error('Welcome message exceeds 200 characters');
  }

  const db = await getDb();

  // Check if row exists
  const existing = await db
    .selectFrom('category_prompts')
    .select('category_id')
    .where('category_id', '=', categoryId)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable('category_prompts')
      .set({
        welcome_title: welcomeTitle,
        welcome_message: welcomeMessage,
        updated_by: updatedBy,
      })
      .where('category_id', '=', categoryId)
      .execute();
  } else {
    await db
      .insertInto('category_prompts')
      .values({
        category_id: categoryId,
        prompt_addendum: '',
        welcome_title: welcomeTitle,
        welcome_message: welcomeMessage,
        updated_by: updatedBy,
      })
      .execute();
  }
}

// ============ Bulk Operations ============

/**
 * Get category prompts for multiple categories
 */
export async function getCategoryPromptsForCategories(categoryIds: number[]): Promise<Map<number, CategoryPrompt>> {
  if (categoryIds.length === 0) return new Map();

  const db = await getDb();
  const rows = await db
    .selectFrom('category_prompts')
    .select([
      'category_id',
      'prompt_addendum',
      'starter_prompts',
      'welcome_title',
      'welcome_message',
      'updated_at',
      'updated_by',
    ])
    .where('category_id', 'in', categoryIds)
    .execute();

  const result = new Map<number, CategoryPrompt>();
  for (const row of rows) {
    const mapped = mapDbToCategoryPrompt(row as unknown as DbCategoryPromptRow);
    result.set(mapped.categoryId, mapped);
  }

  return result;
}

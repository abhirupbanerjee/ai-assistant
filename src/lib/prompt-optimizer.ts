/**
 * Prompt Optimizer
 *
 * Uses LLM to analyze and optimize category prompt addendums
 * by removing redundancies with the global system prompt.
 */

import OpenAI from 'openai';
import { getLlmSettings } from './db/config';
import { getApiKey } from '@/lib/provider-helpers';

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    // When using LiteLLM proxy, use LITELLM_MASTER_KEY for authentication
    // Otherwise use centralized provider helper (DB-first, then env var fallback)
    const apiKey = process.env.OPENAI_BASE_URL
      ? (process.env.LITELLM_MASTER_KEY || getApiKey('openai'))
      : getApiKey('openai');

    openaiClient = new OpenAI({
      apiKey: apiKey || '',
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  }
  return openaiClient;
}

export interface OptimizationResult {
  original: string;
  optimized: string;
  changes: string[];
  tokensUsed: number;
}

const OPTIMIZATION_PROMPT = `You are a prompt engineering assistant. Your task is to optimize a category-specific prompt addendum by removing redundancies with the global system prompt.

GLOBAL SYSTEM PROMPT (read-only, for context):
---
{globalPrompt}
---

CATEGORY ADDENDUM TO OPTIMIZE:
---
{categoryAddendum}
---

INSTRUCTIONS:
1. Remove any instructions from the category addendum that are already covered in the global prompt
2. Eliminate redundant or repetitive phrasing
3. Streamline language while preserving all unique intent
4. Keep the addendum focused on category-specific guidance only
5. Do NOT add new instructions - only remove redundancies
6. Preserve the original formatting style (markdown, bullets, etc.)

Return ONLY a valid JSON object with this exact structure:
{
  "optimized": "the optimized category addendum text",
  "changes": ["list of changes made, e.g. 'Removed redundant greeting instruction'"]
}

If no optimization is needed, return the original text unchanged with an empty changes array.
IMPORTANT: Return only the JSON object, no markdown code blocks or other formatting.`;

/**
 * Optimize a category prompt addendum by removing redundancies with global prompt
 */
export async function optimizeCategoryPrompt(
  globalPrompt: string,
  categoryAddendum: string
): Promise<OptimizationResult> {
  // If empty addendum, nothing to optimize
  if (!categoryAddendum || categoryAddendum.trim() === '') {
    return {
      original: categoryAddendum,
      optimized: categoryAddendum,
      changes: [],
      tokensUsed: 0,
    };
  }

  const llmSettings = getLlmSettings();
  const openai = getOpenAI();

  const prompt = OPTIMIZATION_PROMPT
    .replace('{globalPrompt}', globalPrompt)
    .replace('{categoryAddendum}', categoryAddendum);

  const response = await openai.chat.completions.create({
    model: llmSettings.model,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    max_tokens: llmSettings.promptOptimizationMaxTokens ?? 2000,
    temperature: 0.3, // Lower temperature for more consistent outputs
  });

  const content = response.choices[0].message.content || '';
  const tokensUsed = response.usage?.total_tokens || 0;

  // Parse the JSON response
  try {
    // Try to extract JSON from the response (handle markdown code blocks)
    let jsonStr = content.trim();

    // Remove markdown code block if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);

    return {
      original: categoryAddendum,
      optimized: parsed.optimized || categoryAddendum,
      changes: Array.isArray(parsed.changes) ? parsed.changes : [],
      tokensUsed,
    };
  } catch {
    // If parsing fails, return original with error indication
    console.error('Failed to parse optimization response:', content);
    return {
      original: categoryAddendum,
      optimized: categoryAddendum,
      changes: ['Error: Could not parse optimization result'],
      tokensUsed,
    };
  }
}

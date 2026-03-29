/**
 * Hardened JSON Parser for Agent Responses
 *
 * - Schema validation using JSON Schema with Ajv
 * - Automatic repair attempts with LLM
 * - Never returns invalid data (fail-safe)
 */

import Ajv from 'ajv';
import type { ModelSpec, ParseResult, PlannerResponse, CheckerResponse } from '@/types/agent';

const ajv = new Ajv({ allErrors: true, coerceTypes: true });

// ============ JSON Schemas ============

export const PLANNER_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['title', 'tasks'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    tasks: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        required: ['id', 'type', 'target', 'description'],
        properties: {
          id: { type: 'integer', minimum: 1 },
          type: {
            type: 'string',
            enum: [
              'analyze', 'search', 'compare', 'generate', 'summarize', 'extract', 'validate',
              'synthesize',
              'document', 'image', 'chart', 'spreadsheet', 'presentation', 'podcast', 'diagram',
            ],
          },
          target: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          expected_output: { type: 'string' },
          priority: { type: 'integer', minimum: 1, maximum: 10, default: 1 },
          dependencies: { type: 'array', items: { type: 'integer' }, default: [] },
          execution_hint: { type: 'string', enum: ['parallel', 'sequential', 'wave_barrier'] },
          skill_ids: { type: 'array', items: { type: 'integer', minimum: 1 }, default: [] },
          tool_name: { type: 'string' },
        },
      },
    },
    context: { type: 'object', default: {} },
  },
};

export const CHECKER_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['confidence'],
  properties: {
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    notes: { type: 'string', default: '' },
  },
};

// ============ Main Parser ============

/**
 * Parse and validate JSON with schema
 *
 * @param content - Raw content to parse
 * @param schema - JSON schema for validation
 * @param options - Optional repair settings
 * @returns Parsed data or error
 */
export async function parseAndValidateJSON<T>(
  content: string,
  schema: object,
  options: {
    maxRetries?: number;
    repairModel?: ModelSpec;
    context?: string;
  } = {}
): Promise<ParseResult<T>> {
  const { maxRetries = 1, repairModel, context = '' } = options;

  let currentContent = content;
  let lastError = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Step 1: Extract JSON from content
    const extracted = extractJSON(currentContent);

    if (!extracted.found) {
      lastError = 'No JSON found in response';
      if (attempt < maxRetries && repairModel) {
        currentContent = await repairWithLLM(currentContent, lastError, repairModel, context);
        continue;
      }
      return { success: false, error: lastError, rawContent: content };
    }

    // Step 2: Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(extracted.json);
    } catch (e) {
      lastError = `JSON parse error: ${e instanceof Error ? e.message : String(e)}`;
      if (attempt < maxRetries && repairModel) {
        currentContent = await repairWithLLM(currentContent, lastError, repairModel, context);
        continue;
      }
      return { success: false, error: lastError, rawContent: content };
    }

    // Step 3: Validate against schema
    const validate = ajv.compile(schema);
    if (!validate(parsed)) {
      const errors = validate.errors?.map(e => `${e.instancePath} ${e.message}`).join('; ') || 'Unknown';
      lastError = `Schema validation failed: ${errors}`;
      if (attempt < maxRetries && repairModel) {
        currentContent = await repairWithLLM(
          currentContent,
          lastError,
          repairModel,
          context,
          JSON.stringify(schema, null, 2)
        );
        continue;
      }
      return {
        success: false,
        error: lastError,
        rawContent: content,
        validationErrors: validate.errors?.map(e => `${e.instancePath} ${e.message}`),
      };
    }

    // Success!
    return { success: true, data: parsed as T };
  }

  return { success: false, error: lastError || 'Unknown error', rawContent: content };
}

/**
 * Extract JSON from various formats (code blocks, raw JSON, etc.)
 */
export function extractJSON(content: string): { found: boolean; json: string } {
  // Try to extract from code block first
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    return { found: true, json: codeBlockMatch[1].trim() };
  }

  // Try to find JSON object/array directly
  const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return { found: true, json: jsonMatch[1] };
  }

  return { found: false, json: '' };
}

/**
 * Attempt to repair invalid JSON using LLM
 */
async function repairWithLLM(
  content: string,
  error: string,
  model: ModelSpec,
  context: string,
  schema?: string
): Promise<string> {
  // Lazy import to avoid circular dependencies
  const { generateWithModel } = await import('./llm-router');

  const prompt = `Fix this JSON response.

Error: ${error}

Original Response:
${content}

${schema ? `Expected Schema:\n${schema}\n` : ''}
${context ? `Context: ${context}\n` : ''}

Output ONLY valid corrected JSON matching the schema.`;

  try {
    const response = await generateWithModel(model, prompt, {
      systemPrompt: 'You are a JSON repair assistant. Output only valid JSON, no explanations.',
      temperature: 0.1,
    });
    return response.content;
  } catch (repairError) {
    // If repair fails, return original content
    console.error('[JSONParser] Repair failed:', repairError);
    return content;
  }
}

// ============ Convenience Functions ============

/**
 * Parse planner response with schema validation
 */
export async function parsePlannerResponse(
  content: string,
  repairModel?: ModelSpec
): Promise<ParseResult<PlannerResponse>> {
  return parseAndValidateJSON<PlannerResponse>(content, PLANNER_RESPONSE_SCHEMA, {
    maxRetries: repairModel ? 1 : 0,
    repairModel,
    context: 'Planner response for task breakdown',
  });
}

/**
 * Parse checker response with schema validation
 */
export async function parseCheckerResponse(
  content: string,
  repairModel?: ModelSpec
): Promise<ParseResult<CheckerResponse>> {
  return parseAndValidateJSON<CheckerResponse>(content, CHECKER_RESPONSE_SCHEMA, {
    maxRetries: repairModel ? 1 : 0,
    repairModel,
    context: 'Checker response for quality evaluation',
  });
}

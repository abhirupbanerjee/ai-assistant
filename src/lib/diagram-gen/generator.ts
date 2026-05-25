/**
 * Mermaid Diagram Generator
 *
 * Calls LLM to generate valid Mermaid syntax based on user description.
 * Uses the system default LLM configuration (not hardcoded).
 */

import OpenAI from 'openai';
import { getLlmSettings } from '@/lib/db/compat/config';
import { getApiKey } from '@/lib/provider-helpers';
import { getTemperatureForModel } from '@/lib/llm-thinking';
import { getToolConfig } from '@/lib/db/compat/tool-config';
import { buildGenerationPrompt, getDiagramSystemPrompt, DIAGRAM_TEMPLATES } from './templates';
import { validateMermaidSyntax, sanitizeMermaidCode } from './validator';
import type {
  MermaidDiagramType,
  FlowDirection,
  DiagramGenConfig,
  DiagramGenerationResult,
} from '@/types/diagram-gen';

// ===== Configuration =====

export const DIAGRAM_GEN_DEFAULTS: DiagramGenConfig = {
  temperature: 0.3, // Lower temperature for more deterministic output
  maxTokens: 1500, // Enough for complex diagrams
  validateSyntax: true,
  maxRetries: 3, // 4 total attempts
  debugMode: false,
};

/**
 * Get diagram generation configuration
 */
export async function getDiagramGenConfig(): Promise<DiagramGenConfig> {
  const config = await getToolConfig('diagram_gen');

  if (config?.config) {
    const stored = config.config as Partial<DiagramGenConfig>;
    return {
      ...DIAGRAM_GEN_DEFAULTS,
      ...stored,
    };
  }

  return DIAGRAM_GEN_DEFAULTS;
}

// ===== LLM Client =====

async function getOpenAIClient(): Promise<OpenAI> {
  // Read config fresh each call — avoids stale client after API key or base URL changes
  const apiKey = process.env.OPENAI_BASE_URL
    ? process.env.LITELLM_MASTER_KEY || await getApiKey('openai')
    : await getApiKey('openai');

  if (!apiKey && !process.env.OPENAI_BASE_URL) {
    throw new Error('OpenAI API key or LiteLLM proxy required for diagram generation');
  }

  return new OpenAI({
    apiKey: apiKey || 'dummy-key-for-litellm',
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
}

// ===== Retry Guidance =====

/**
 * Build retry-specific prompt guidance based on attempt number.
 * Progressive strategy: later attempts request simpler, more conservative output.
 */
function buildRetryGuidance(attempt: number, lastError: string): string {
  const base = `\n\nPrevious attempt failed with: ${lastError}`;

  if (attempt === 1) {
    return base + '\nFix the specific error above and try again. Keep the same structure.';
  }
  if (attempt === 2) {
    return (
      base +
      '\nSimplify the diagram — reduce to 8 or fewer nodes/elements. ' +
      'Remove optional labels, notes, and complex nesting. Fix the error above.'
    );
  }
  // attempt >= 3: last resort — use the example exactly
  return (
    base +
    '\nUse the minimal example format shown above as a template. ' +
    'Produce the simplest possible valid diagram for the request. ' +
    'Do not add extra nodes, labels, or styling.'
  );
}

// ===== Generation Function =====

/**
 * Generate Mermaid diagram code using LLM
 */
export async function generateMermaidDiagram(
  diagramType: MermaidDiagramType,
  description: string,
  direction?: FlowDirection,
  title?: string
): Promise<DiagramGenerationResult> {
  const config = await getDiagramGenConfig();

  // Get the default model from system LLM settings
  const llmSettings = await getLlmSettings();
  const model = llmSettings.model;

  const client = await getOpenAIClient();

  // Get effective system prompt (from config override or hardcoded default)
  const effectiveSystemPrompt = await getDiagramSystemPrompt(diagramType);

  // Build prompt using effective system prompt (direction is handled by admin override or {DIRECTION} placeholder)
  const { system, user } = buildGenerationPrompt(
    diagramType, description, direction, title, effectiveSystemPrompt
  );

  if (config.debugMode) {
    console.log('[DiagramGen] Model:', model);
    console.log('[DiagramGen] System prompt:', system);
    console.log('[DiagramGen] User prompt:', user);
  }

  let lastError: string | undefined;
  let retryCount = 0;

  // Retry loop with progressive simplification
  while (retryCount <= config.maxRetries) {
    try {
      const userContent =
        lastError
          ? user + buildRetryGuidance(retryCount, lastError)
          : user;

      const response = await client.chat.completions.create({
        model,
        temperature: getTemperatureForModel(model, config.temperature),
        max_tokens: config.maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      });

      const rawCode = response.choices[0]?.message?.content;

      if (!rawCode) {
        lastError = 'Empty response from LLM';
        retryCount++;
        continue;
      }

      // Sanitize the code
      const code = sanitizeMermaidCode(rawCode);

      if (config.debugMode) {
        console.log(`[DiagramGen] Attempt ${retryCount + 1} code:`, code);
      }

      // Validate if enabled
      if (config.validateSyntax) {
        const validation = validateMermaidSyntax(code, diagramType);

        if (!validation.valid) {
          lastError = validation.errors.join('; ');

          if (config.debugMode) {
            console.log('[DiagramGen] Validation failed:', validation.errors);
          }

          retryCount++;
          continue;
        }
      }

      // Success
      return {
        success: true,
        code,
        diagramType,
        retryCount,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      retryCount++;

      if (config.debugMode) {
        console.error('[DiagramGen] Generation error:', error);
      }
    }
  }

  // All retries exhausted
  return {
    success: false,
    retryCount,
    error: {
      code: 'GENERATION_FAILED',
      message: `Failed to generate valid ${diagramType} diagram after ${config.maxRetries + 1} attempts`,
      details: lastError,
    },
  };
}

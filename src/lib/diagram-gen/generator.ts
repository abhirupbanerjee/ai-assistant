/**
 * Mermaid Diagram Generator
 *
 * Calls LLM to generate valid Mermaid syntax based on user description.
 * Uses the system default LLM configuration (not hardcoded).
 */

import OpenAI from 'openai';
import { getLlmSettings } from '@/lib/db/compat/config';
import { getApiKey } from '@/lib/provider-helpers';
import { getToolConfig } from '@/lib/db/compat/tool-config';
import { buildGenerationPrompt, DIAGRAM_TEMPLATES } from './templates';
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
  maxRetries: 2,
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

let openaiClient: OpenAI | null = null;

async function getOpenAIClient(): Promise<OpenAI> {
  if (!openaiClient) {
    // When using LiteLLM proxy, use LITELLM_MASTER_KEY for authentication
    // Otherwise use centralized provider helper (DB-first, then env var fallback)
    const apiKey = process.env.OPENAI_BASE_URL
      ? process.env.LITELLM_MASTER_KEY || await getApiKey('openai')
      : await getApiKey('openai');

    if (!apiKey && !process.env.OPENAI_BASE_URL) {
      throw new Error('OpenAI API key or LiteLLM proxy required for diagram generation');
    }

    openaiClient = new OpenAI({
      apiKey: apiKey || 'dummy-key-for-litellm',
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  }
  return openaiClient;
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

  // Build specialized prompt for this diagram type
  const { system, user } = buildGenerationPrompt(diagramType, description, direction, title);

  if (config.debugMode) {
    console.log('[DiagramGen] Model:', model);
    console.log('[DiagramGen] System prompt:', system);
    console.log('[DiagramGen] User prompt:', user);
  }

  let lastError: string | undefined;
  let retryCount = 0;

  // Retry loop for validation failures
  while (retryCount <= config.maxRetries) {
    try {
      const response = await client.chat.completions.create({
        model,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content:
              user +
              (lastError ? `\n\nPrevious attempt failed: ${lastError}\nFix the issue and try again.` : ''),
          },
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
        console.log('[DiagramGen] Generated code:', code);
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

      // Success!
      return {
        success: true,
        code,
        diagramType,
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
    error: {
      code: 'GENERATION_FAILED',
      message: `Failed to generate valid ${diagramType} diagram after ${config.maxRetries + 1} attempts`,
      details: lastError,
    },
  };
}

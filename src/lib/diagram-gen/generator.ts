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
import { logger } from '@/lib/logger';
import { buildGenerationPrompt, getDiagramSystemPrompt, DIAGRAM_TEMPLATES } from './templates';
import { validateMermaidSyntax, sanitizeMermaidCode } from './validator';
import { MERMAID_INIT_CONFIG } from './mermaid-config';
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
  // Use direct OpenAI API (Route 2) — no LiteLLM proxy
  const apiKey = await getApiKey('openai');

  if (!apiKey) {
    throw new Error('OpenAI API key required for diagram generation');
  }

  return new OpenAI({
    apiKey,
    baseURL: 'https://api.openai.com/v1', // Direct, bypasses LiteLLM
  });
}

// ===== Server-Side Parse Validation =====

/**
 * Lazily-imported mermaid parse() for server-side syntax validation.
 *
 * Phase 2: the validator.ts regex checks catch structural issues, but only
 * the real mermaid parser catches syntax errors the regex misses (e.g. a
 * mis-placed `end`, a bad `align` directive order). We call parse() after
 * sanitize + validateMermaidSyntax so the repair loop gets the most
 * actionable error message possible.
 *
 * parse() is async in v11 and THROWS on invalid syntax (returns a
 * ParseResult on success). We never need the return value here — only the
 * throw/no-throw signal.
 */
let mermaidParseModule: typeof import('mermaid') | null = null;
async function getMermaidParse() {
  if (!mermaidParseModule) {
    const mod = await import('mermaid');
    // Initialize once with the shared config so parse uses the same rules
    // as the client + Playwright renderer.
    mod.default.initialize(MERMAID_INIT_CONFIG);
    mermaidParseModule = mod;
  }
  return mermaidParseModule;
}

/**
 * Validate mermaid code with the real parser. Returns null on success or
 * the error message on failure.
 */
async function parseValidate(code: string): Promise<string | null> {
  try {
    const mermaid = await getMermaidParse();
    await mermaid.default.parse(code);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Mermaid parse validation failed';
  }
}

// ===== Retry Guidance =====

/**
 * Build retry-specific prompt guidance.
 *
 * Phase 2 strategy: TARGETED repair, NOT progressive simplification. Every
 * attempt asks the LLM to fix the specific error and keep the same structure.
 * Progressive degradation (≤8 nodes → minimal example) was removed because it
 * discarded diagram intent on retries that could have succeeded with a one-line
 * fix. The last attempt (retryCount === maxRetries) is the only one that asks
 * for a simplified fallback, preserving a safety net without degrading early.
 */
function buildRetryGuidance(attempt: number, lastError: string, maxRetries: number): string {
  const base = `\n\nPrevious attempt failed with: ${lastError}`;

  // Final attempt: simplified safety net so we return SOMETHING valid.
  if (attempt >= maxRetries) {
    return (
      base +
      '\nThis is the final retry. If you cannot fix the specific error while keeping the structure, ' +
      'produce the simplest possible valid diagram for the request using the example format shown above. ' +
      'Do not add extra nodes, labels, or styling beyond what is strictly required.'
    );
  }

  // All non-final attempts: targeted fix, preserve structure.
  return (
    base +
    '\nFix the specific error above and try again. Keep the same structure and node count — ' +
    'do not simplify or remove nodes unless the error directly requires it.'
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

  // Retry loop — targeted repair (Phase 2). maxRetries stays at 3 (4 total
  // attempts). Reducing it would lower the >95% success-rate target.
  while (retryCount <= config.maxRetries) {
    try {
      const userContent =
        lastError
          ? user + buildRetryGuidance(retryCount, lastError, config.maxRetries)
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

      // Validate if enabled: regex/structural checks first, then the real
      // mermaid parser. The parse error is more actionable for the LLM repair
      // loop, so we prefer it when both fire.
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

        // Phase 2: real parser check — catches syntax errors the regex misses.
        const parseError = await parseValidate(code);
        if (parseError) {
          lastError = parseError;
          // Phase 7 telemetry — track parse failures (info level, production-default).
          logger.info('[DiagramGen] mermaid.parse() failed', {
            diagramType,
            attempt: retryCount + 1,
            error: parseError.substring(0, 200),
          });

          if (config.debugMode) {
            console.log('[DiagramGen] mermaid.parse() failed:', parseError);
          }

          retryCount++;
          continue;
        }
      }

      // Success
      if (retryCount > 0) {
        // Phase 7 telemetry — repair loop invocations that succeeded.
        logger.info('[DiagramGen] repaired after retries', { diagramType, retryCount });
      }
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
  // Phase 7 telemetry — generation failure after all attempts.
  logger.warn('[DiagramGen] generation failed after all retries', {
    diagramType,
    attempts: retryCount,
    lastError: lastError?.substring(0, 200),
  });
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

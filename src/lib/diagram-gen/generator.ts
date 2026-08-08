/**
 * Mermaid Diagram Generator
 *
 * Calls LLM to generate valid Mermaid syntax based on user description.
 * Uses the system default LLM configuration (not hardcoded).
 */

import { getLlmSettings } from '@/lib/db/compat/config';
import { createInternalCompletion } from '@/lib/llm-client';
import { getTemperatureForModel } from '@/lib/llm-thinking';
import { getToolConfig } from '@/lib/db/compat/tool-config';
import { logger } from '@/lib/logger';
import { buildGenerationPrompt, getDiagramSystemPrompt, DIAGRAM_TEMPLATES } from './templates';
import { validateMermaidSyntax, sanitizeMermaidCode } from './validator';
import { MERMAID_PARSE_CONFIG } from './mermaid-config';
import type {
  MermaidDiagramType,
  FlowDirection,
  DiagramGenConfig,
  DiagramGenerationResult,
} from '@/types/diagram-gen';

// ===== Configuration =====

export const DIAGRAM_GEN_DEFAULTS: DiagramGenConfig = {
  temperature: 0.3, // Lower temperature for more deterministic output
  // 2500 tokens accommodates complex multi-subgraph flowcharts (e.g. a 4-
  // subgraph architecture diagram with ~20 nodes). 1500 was too low and caused
  // truncation mid-subgraph, producing "Unbalanced subgraph/end" parse errors.
  // The retry loop escalates this further (×1.5 on truncation, ×2 on empty
  // responses) so thinking models still have reasoning headroom.
  maxTokens: 2500,
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
// diagram_gen routes through createInternalCompletion (the canonical
// internal-completion helper in llm-client.ts) instead of a hardcoded OpenAI
// direct client. This respects the system's configured provider/routing —
// Claude → Anthropic, Fireworks → Fireworks, Moonshot → Moonshot, etc. — so a
// non-OpenAI system default model no longer produces "400 invalid model ID"
// against api.openai.com.

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
    // Initialize once with the server-side parse config (securityLevel:
    // 'strict') so parse() does not invoke DOMPurify.sanitize(), which is
    // unavailable in the Node standalone server build and crashes parse()
    // with "DOMPurify.sanitize is not a function". Parse validation only
    // checks syntax — it does not render into the DOM — so 'strict' is
    // sufficient. The client + Playwright renderer keep 'loose' for HTML
    // labels where DOMPurify is available.
    mod.default.initialize(MERMAID_PARSE_CONFIG);
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
    const msg = err instanceof Error ? err.message : 'Mermaid parse validation failed';
    // Environment errors (DOMPurify, jsdom, etc.) are not syntax errors.
    // Skip parse validation rather than falsely rejecting valid code.
    // validateMermaidSyntax (regex) already ran before this and caught
    // structural errors; a false positive from a broken parse call is worse
    // than skipping it.
    //
    // mermaid v11 calls DOMPurify.addHook() during initialize() even with
    // securityLevel:'strict' (it only skips the .sanitize() call itself). In
    // the Node standalone build DOMPurify is a no-op stub without addHook, so
    // parse() crashes with "DOMPurify.addHook is not a function" — a false
    // syntax error that silently rejects valid diagrams. Match addHook too.
    if (/DOMPurify|sanitize is not a function|addHook|jsdom|is not defined/i.test(msg)) {
      logger.warn('[DiagramGen] parseValidate skipped — environment error', { error: msg.substring(0, 200) });
      return null;
    }
    return msg;
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

  // Get the default model from system LLM settings. createInternalCompletion
  // routes to the correct provider based on the model ID prefix.
  const llmSettings = await getLlmSettings();
  const model = llmSettings.model;

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
  // Retry-budget escalation: when the model returns an empty response (reasoning
  // exhausted the token budget), double the requested maxTokens for the next
  // attempt. getThinkingCompletionParams() scales the reasoning budget from the
  // requested max and caps it at the model's output ceiling, so this can't run
  // away — it just gives the model more room to think on the next try.
  let reasoningBudgetMultiplier = 1.0;

  // Retry loop — targeted repair (Phase 2). maxRetries stays at 3 (4 total
  // attempts). Reducing it would lower the >95% success-rate target.
  while (retryCount <= config.maxRetries) {
    try {
      const userContent =
        lastError
          ? user + buildRetryGuidance(retryCount, lastError, config.maxRetries)
          : user;

      const rawCode = await createInternalCompletion({
        model,
        temperature: getTemperatureForModel(model, config.temperature),
        maxTokens: Math.round(config.maxTokens * reasoningBudgetMultiplier),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      });

      if (!rawCode) {
        lastError = 'Empty response from LLM';
        // Likely reasoning exhaustion — escalate the budget for the next attempt.
        reasoningBudgetMultiplier *= 2;
        retryCount++;
        continue;
      }

      // Truncation guard: detect output cut off mid-diagram (most common when
      // the model hits maxTokens mid-subgraph). A truncated flowchart typically
      // has balanced [...] but an unbalanced subgraph/end count — the validator
      // catches it, but we also detect it here to escalate the token budget
      // immediately so the next attempt has room to finish the diagram.
      const looksTruncated = /output appears truncated|unbalanced subgraph\/end/i.test(rawCode);
      if (looksTruncated) {
        reasoningBudgetMultiplier *= 1.5;
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

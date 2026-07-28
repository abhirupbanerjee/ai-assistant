import type { OpenAI } from 'openai';
import { tavilyWebSearch, tavilyWebExtract, tavilyWebCrawl, tavilyWebMap } from './tools/tavily';
import { documentGenerationTool } from './tools/docgen';
import { dataSourceTool } from './tools/data-source';
import { aggregateDataTool } from './tools/aggregate-data';
import { functionApiTool, getDynamicFunctionDefinitions, isFunctionAPIFunction } from './tools/function-api';
import { youtubeToolDefinition } from './tools/youtube';
import { chartGenTool } from './tools/chart-gen';

import { imageGenTool } from './tools/image-gen';
import { translationTool } from './tools/translation';
import { shareThreadTool } from './tools/share-thread';
import { sendEmailTool } from './tools/send-email';
import { diagramGenTool } from './tools/diagram-gen';
import { complianceCheckerTool } from './tools/compliance-checker';
import { xlsxGenTool } from './tools/xlsx-gen';
import { pptxGenTool } from './tools/pptx-gen';
import { podcastGenTool } from './tools/podcast-gen';
import { websiteAnalysisTool } from './tools/pagespeed';
import { codeAnalysisTool } from './tools/sonarcloud';
import { loadTestingTool } from './tools/loadtest';
import { fileToHtmlTool } from './tools/file-to-html';
import { htmlGenTool, getHtmlGenDescriptionWithDate } from './tools/html-gen';
import { siteGenTool } from './tools/site-gen';
import { kbSummaryTool } from './tools/kb-summary';
import { kbSearchTool } from './tools/kb-search';
import { kbReadTool } from './tools/kb-read';
import { handoffToCategoryTool } from './tools/handoff-category';
import { isToolEnabled as isToolEnabledDb, migrateTavilySettingsIfNeeded, ensureToolConfigsExist, getDescriptionOverride } from './db/compat/tool-config';
import { toolsLogger as logger } from './logger';
import { isAgentTool, executeAgentTool, getAgentToolDefinitions } from './agent-registry/agent-tools';
import { isMcpEnabled } from './mcp/config';
import { isMcpTool, executeMcpTool, getMcpToolDefinitions, refreshMcpTools } from './mcp/mcp-tools';

// ============ Types ============

/**
 * Tool category determines how the tool is invoked
 * - autonomous: LLM-triggered via OpenAI function calling (e.g., web_search)
 * - processor: Post-response output processor (e.g., data_viz, doc_gen)
 */
export type ToolCategory = 'autonomous' | 'processor';

/**
 * Validation result for tool configuration
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Coerce a config value to a finite number and check it falls within [min, max].
 * Accepts numbers or numeric strings (e.g. "15" from legacy SQLite storage).
 * Returns false for NaN, Infinity, null, undefined, empty string, or out-of-range values.
 */
export function numInRange(value: unknown, min: number, max: number): boolean {
  if (value === null || value === undefined || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}

/**
 * Coerce a config value to a finite number, or return undefined if not coercible.
 */
export function coerceNum(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Options for tool execution
 */
export interface ToolExecutionOptions {
  /** Function name for dynamic tools (e.g., function_api) */
  functionName?: string;
  /** Config override from skill-level tool_config_override (merged with global config) */
  configOverride?: Record<string, unknown>;
}

/**
 * Extended tool interface for the unified Tools system
 * Each tool has a definition, execution logic, validation, and configuration
 */
export interface ToolDefinition {
  /** Unique tool identifier (e.g., 'web_search') */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Description of what the tool does */
  description: string;
  /** Tool category - how it's invoked */
  category: ToolCategory;
  /** OpenAI function definition (only for autonomous tools with static definitions) */
  definition?: OpenAI.Chat.ChatCompletionFunctionTool;
  /** Execute the tool with arguments. Options include functionName for dynamic tools and configOverride for skill-level config. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (args: any, options?: ToolExecutionOptions) => Promise<string>;
  /** Validate tool configuration */
  validateConfig: (config: Record<string, unknown>) => ValidationResult;
  /** Default configuration values */
  defaultConfig: Record<string, unknown>;
  /** JSON Schema for configuration (for admin UI generation) */
  configSchema: Record<string, unknown>;
  /** Whether this tool is safe to invoke automatically in subagent mode without HITL approval */
  subagentSafe?: boolean;
  /** Model capability requirements for auto-selection when this tool is matched */
  modelRequirements?: ModelRequirements;
  /** Optional group name for admin UI grouping (e.g., 'tavily' groups web_search, web_extract, web_crawl, web_map) */
  group?: string;
}

/**
 * Model capability requirements that tools declare for auto-selection.
 * When tool routing matches a prompt to a tool, these requirements
 * are applied as hard filters and weight boosts in selectBestModel().
 */
export interface ModelRequirements {
  /** Hard filter: model MUST support tool/function calling */
  requiresToolCalling?: boolean;
  /** Hard filter: model MUST support vision (for tools that process images) */
  requiresVision?: boolean;
  /** Hard filter: minimum context window in tokens */
  minimumContextTokens?: number;
  /** Weight boost: increase contextFit weight (for tools with large outputs) */
  prefersLargeContext?: boolean;
  /** Weight boost: increase reasoning weight (for tools needing instruction following) */
  prefersInstructionFollowing?: boolean;
  /** Weight boost: increase code_quality weight (for code-generation tools) */
  prefersCodeQuality?: boolean;
}

/**
 * Legacy tool interface for backward compatibility
 * @deprecated Use ToolDefinition instead
 */
export interface LegacyToolDefinition {
  definition: OpenAI.Chat.ChatCompletionFunctionTool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (args: any) => Promise<string>;
}

// ============ Tool Registry ============

/**
 * Hybrid tools that function both as autonomous tools (LLM can call them)
 * AND as processors (system auto-applies based on settings).
 * Example: Translation can be explicitly requested OR auto-applied for non-English responses.
 */
export const HYBRID_TOOLS = new Set(['translation']);

/**
 * Tool registry - maps tool names to their definitions
 * Import tool implementations from separate files for modularity
 */
export const AVAILABLE_TOOLS: Record<string, ToolDefinition> = {
  // ── Search & Research ──
  web_search: { ...tavilyWebSearch, group: 'tavily', subagentSafe: true,
    modelRequirements: { requiresToolCalling: true, prefersLargeContext: true } },
  web_extract: { ...tavilyWebExtract, group: 'tavily', subagentSafe: true,
    modelRequirements: { requiresToolCalling: true, prefersLargeContext: true } },
  web_crawl: { ...tavilyWebCrawl, group: 'tavily', subagentSafe: true,
    modelRequirements: { requiresToolCalling: true, prefersLargeContext: true } },
  web_map: { ...tavilyWebMap, group: 'tavily', subagentSafe: true,
    modelRequirements: { requiresToolCalling: true } },
  website_analysis: { ...websiteAnalysisTool, subagentSafe: true,
    modelRequirements: { requiresToolCalling: true, prefersLargeContext: true } },
  load_testing: { ...loadTestingTool, subagentSafe: true,
    modelRequirements: { requiresToolCalling: true } },
  youtube: { ...youtubeToolDefinition,
    modelRequirements: { requiresToolCalling: true } },

  // ── Generative (documents, images, media) ──
  doc_gen: { ...documentGenerationTool, subagentSafe: false,
    modelRequirements: { requiresToolCalling: true, prefersLargeContext: true, prefersInstructionFollowing: true } },
  pptx_gen: { ...pptxGenTool, subagentSafe: false,
    modelRequirements: { requiresToolCalling: true, prefersLargeContext: true, prefersInstructionFollowing: true } },
  html_gen: { ...htmlGenTool, subagentSafe: false,
    modelRequirements: { requiresToolCalling: true, prefersLargeContext: true, prefersCodeQuality: true } },
  site_gen: { ...siteGenTool, subagentSafe: false,
    modelRequirements: { requiresToolCalling: true, prefersLargeContext: true, prefersCodeQuality: true } },
  file_to_html: { ...fileToHtmlTool, subagentSafe: false,
    modelRequirements: { requiresToolCalling: true, prefersLargeContext: true } },
  image_gen: { ...imageGenTool, subagentSafe: false,
    modelRequirements: { requiresToolCalling: true } },
  podcast_gen: { ...podcastGenTool, subagentSafe: false,
    modelRequirements: { requiresToolCalling: true } },
  diagram_gen: { ...diagramGenTool, subagentSafe: true,
    modelRequirements: { requiresToolCalling: true, prefersCodeQuality: true } },

  // ── Data & Code ──
  chart_gen: { ...chartGenTool, subagentSafe: true,
    modelRequirements: { requiresToolCalling: true } },
  xlsx_gen: { ...xlsxGenTool, subagentSafe: false,
    modelRequirements: { requiresToolCalling: true, prefersCodeQuality: true } },
  data_source: { ...dataSourceTool, subagentSafe: false,
    modelRequirements: { requiresToolCalling: true } },
  aggregate_data: { ...aggregateDataTool, subagentSafe: false,
    modelRequirements: { requiresToolCalling: true } },
  code_analysis: { ...codeAnalysisTool, subagentSafe: true,
    modelRequirements: { requiresToolCalling: true, prefersCodeQuality: true, minimumContextTokens: 32000 } },
  function_api: { ...functionApiTool, subagentSafe: false,
    modelRequirements: { requiresToolCalling: true } },

  // ── Utility (lightweight or processor tools — no special model requirements) ──
  translation: { ...translationTool, subagentSafe: true },
  share_thread: shareThreadTool,
  send_email: sendEmailTool,
  compliance_checker: complianceCheckerTool,

  // ── Knowledge Base ──
  kb_summary: { ...kbSummaryTool, subagentSafe: true,
    modelRequirements: { requiresToolCalling: true } },
  kb_search: { ...kbSearchTool, subagentSafe: true,
    modelRequirements: { requiresToolCalling: true, prefersLargeContext: true } },
  kb_read: { ...kbReadTool, subagentSafe: true,
    modelRequirements: { requiresToolCalling: true, prefersLargeContext: true } },

  // ── Agent System (Phase 2.2) — single-agent routing ──
  // LLM-driven category handoff. The executor resolves the target category
  // and returns a handoff-request envelope; the stream route performs the
  // actual transferThreadCategory + emits the handoff SSE event + ends the
  // turn. See plans/phase_2_2_implementation_plan.md §1 decision (c).
  handoff_to_category: { ...handoffToCategoryTool, subagentSafe: true,
    modelRequirements: { requiresToolCalling: true } },
};

/**
 * Meta-tool injected when preflight clarification is enabled.
 * NOT in AVAILABLE_TOOLS — not DB-managed, not exposed to regular tool routing.
 * Injected by generateResponseWithTools when enableClarification=true.
 */
export const REQUEST_CLARIFICATION_TOOL: OpenAI.Chat.ChatCompletionFunctionTool = {
  type: 'function',
  function: {
    name: 'request_clarification',
    description: 'Ask the user a clarification question before generating your response. ONLY call this if the request is genuinely ambiguous after reviewing all documents, conversation history, and available context. Do NOT call this if the documents or prior conversation already address the topic.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The clarification question to ask the user' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '2-4 specific, mutually exclusive answer options',
        },
        allowFreeText: {
          type: 'boolean',
          description: 'Set to true to also allow a free-text answer in addition to the options',
        },
      },
      required: ['question', 'options'],
    },
  },
};

// ============ Initialization ============

let toolsInitialized = false;

/**
 * Initialize the tools system
 * - Migrates legacy Tavily settings to tool_configs table
 * - Ensures all registered tools have configurations
 */
export async function initializeTools(): Promise<void> {
  if (toolsInitialized) return;

  try {
    // Migrate existing Tavily settings if needed
    await migrateTavilySettingsIfNeeded();

    // Ensure all registered tools have configs
    await ensureToolConfigsExist();

    // Discover MCP tools from enabled servers when MCP is enabled
    if (isMcpEnabled()) {
      try {
        await refreshMcpTools();
      } catch (error) {
        logger.error('Failed to discover MCP tools during initialization', { error: String(error) });
      }
    }

    toolsInitialized = true;
    logger.info('Tools system initialized');
  } catch (error) {
    logger.error('Failed to initialize tools system', error);
  }
}

// ============ Tool Access ============

/**
 * Check if a tool is enabled
 * Uses database configuration
 */
export async function isToolEnabled(name: string): Promise<boolean> {
  await initializeTools();
  return await isToolEnabledDb(name);
}

/**
 * Get all tool definitions for OpenAI API
 * Only returns definitions for enabled autonomous tools
 * Applies admin-configured description overrides when available
 * @param categoryIds - Optional category IDs to include dynamic function definitions
 */
export async function getToolDefinitions(categoryIds?: number[]): Promise<OpenAI.Chat.ChatCompletionFunctionTool[]> {
  await initializeTools();

  const tools: OpenAI.Chat.ChatCompletionFunctionTool[] = [];

  // Add static tool definitions
  for (const tool of Object.values(AVAILABLE_TOOLS)) {
    if (tool.category !== 'autonomous' || !(await isToolEnabled(tool.name))) continue;

    // Skip function_api here - its definitions are added dynamically below
    if (tool.name === 'function_api') continue;

    if (tool.definition) {
      // Check for admin-configured description override
      const descriptionOverride = await getDescriptionOverride(tool.name);

      // For html_gen: inject today's date into the description so the LLM
      // always knows the current date when generating gantt/project_plan content.
      const baseDescription = tool.name === 'html_gen'
        ? getHtmlGenDescriptionWithDate()
        : tool.definition.function.description;

      if (descriptionOverride) {
        // Admin override takes precedence; still append date note for html_gen
        const finalDescription = tool.name === 'html_gen'
          ? descriptionOverride + `\n\nToday's date is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${new Date().toISOString().slice(0, 10)}).`
          : descriptionOverride;
        const overriddenTool: OpenAI.Chat.ChatCompletionFunctionTool = {
          ...tool.definition,
          function: {
            ...tool.definition.function,
            description: finalDescription,
          },
        };
        tools.push(overriddenTool);
        logger.debug('Applied description override', { tool: tool.name });
      } else if (baseDescription !== tool.definition.function.description) {
        // Date-injected description (html_gen)
        tools.push({
          ...tool.definition,
          function: { ...tool.definition.function, description: baseDescription },
        });
      } else {
        tools.push(tool.definition);
      }
    }
  }

  // Add dynamic function definitions from Function APIs
  if (categoryIds && categoryIds.length > 0 && (await isToolEnabled('function_api'))) {
    const functionDefinitions = await getDynamicFunctionDefinitions(categoryIds);
    tools.push(...functionDefinitions);
  }

  // Add agent-as-tool definitions (Phase 2.1). When categoryIds are provided,
  // scope agents to the first category (matching the swarm pool rule: global
  // templates + category-scoped agents). When omitted, expose all enabled
  // agents. These dispatch through executeTool via the isAgentTool branch.
  const agentCategoryId = categoryIds && categoryIds.length > 0 ? categoryIds[0] : undefined;
  const agentToolDefinitions = await getAgentToolDefinitions(agentCategoryId);
  tools.push(...agentToolDefinitions);

  // Add MCP tool definitions when MCP is enabled
  if (isMcpEnabled()) {
    try {
      const mcpToolDefinitions = await getMcpToolDefinitions();
      tools.push(...mcpToolDefinitions);
    } catch (error) {
      logger.error('Failed to load MCP tool definitions', { error: String(error) });
    }
  }

  return tools;
}

/**
 * Get all enabled autonomous tool definitions (alias for getToolDefinitions)
 * @param categoryIds - Optional category IDs to include dynamic function definitions
 */
export async function getEnabledAutonomousTools(categoryIds?: number[]): Promise<OpenAI.Chat.ChatCompletionFunctionTool[]> {
  return getToolDefinitions(categoryIds);
}

/**
 * Get all processor tools (for post-response processing)
 */
export async function getProcessorTools(): Promise<ToolDefinition[]> {
  await initializeTools();
  const results: ToolDefinition[] = [];
  for (const tool of Object.values(AVAILABLE_TOOLS)) {
    if (tool.category === 'processor' && (await isToolEnabled(tool.name))) {
      results.push(tool);
    }
  }
  return results;
}

/**
 * Get a tool by name
 */
export function getTool(name: string): ToolDefinition | undefined {
  return AVAILABLE_TOOLS[name];
}

/**
 * Get all registered tools (for admin panel)
 */
export function getAllTools(): ToolDefinition[] {
  return Object.values(AVAILABLE_TOOLS);
}

// ============ Tool Execution ============

/**
 * Execute a tool by name with arguments
 *
 * Handles both standard registered tools and dynamic function API tools.
 * Returns JSON-formatted results or error objects. Never throws exceptions.
 *
 * @param name - Tool name (e.g., 'web_search') or dynamic function name from function_api
 * @param args - JSON string of tool arguments matching the tool's parameter schema
 * @param configOverride - Optional config override from skill-level tool_config_override
 * @returns JSON string result - either success data or error object with errorCode
 *
 * @example
 * ```typescript
 * // Execute web search
 * const result = await executeTool('web_search', JSON.stringify({
 *   query: 'latest news',
 *   max_results: 5
 * }));
 *
 * // Execute with skill-level config override (e.g., domain filtering)
 * const result = await executeTool('web_search', JSON.stringify({
 *   query: 'latest news'
 * }), { includeDomains: ['example.com'] });
 *
 * // Parse result
 * const data = JSON.parse(result);
 * if (data.error) {
 *   console.error(data.errorCode, data.error);
 * } else {
 *   console.log(data.results);
 * }
 * ```
 */

/**
 * Attempt to repair truncated JSON from streaming issues.
 * Handles unclosed strings, arrays, and objects caused by premature stream termination.
 */
function attemptJsonRepair(s: string): string | null {
  let result = s.trim();
  if (!result) return null;
  // Close unclosed strings
  if ((result.match(/"/g) || []).length % 2 !== 0) result += '"';
  // Close arrays then objects
  const arrDiff = (result.match(/\[/g) || []).length - (result.match(/\]/g) || []).length;
  const objDiff = (result.match(/\{/g) || []).length - (result.match(/\}/g) || []).length;
  result += ']'.repeat(Math.max(0, arrDiff));
  result += '}'.repeat(Math.max(0, objDiff));
  try { JSON.parse(result); return result; } catch { return null; }
}

export async function executeTool(
  name: string,
  args: string,
  configOverride?: Record<string, unknown>
): Promise<string> {
  await initializeTools();

  // Agent-as-tool dispatch (Phase 2.1): names prefixed with `agent__` route
  // to the registry agent invoker, not the static tool registry. This must
  // run before the AVAILABLE_TOOLS lookup so agent tool calls never fall
  // through to the "Unknown tool" branch.
  if (isAgentTool(name)) {
    try {
      return await executeAgentTool(name, args);
    } catch (error) {
      logger.error(`Agent tool execution error [${name}]`, error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: 'EXECUTION_ERROR',
      });
    }
  }

  // MCP tool dispatch: names prefixed with `mcp_` route to the MCP client.
  // This runs before the standard tool lookup and after the agent-as-tool
  // check so MCP tool calls never fall through to built-in or function_api.
  if (isMcpTool(name)) {
    return await executeMcpTool(name, args);
  }

  // Check standard tools first
  let tool = AVAILABLE_TOOLS[name];

  // If not found, check if it's a dynamic function from function_api
  if (!tool && await isFunctionAPIFunction(name)) {
    tool = AVAILABLE_TOOLS['function_api'];

    // Check if function_api tool is enabled
    if (!(await isToolEnabled('function_api'))) {
      return JSON.stringify({
        success: false,
        error: `Function APIs are currently disabled`,
        errorCode: 'TOOL_DISABLED',
      });
    }

    try {
      let parsedArgs;
      try {
        parsedArgs = JSON.parse(args);
      } catch (parseError) {
        // Try JSON repair first (handles truncated arguments from streaming issues)
        const repaired = attemptJsonRepair(args);
        if (repaired) {
          logger.warn(`JSON repair succeeded for function [${name}]`, { originalLen: args.length });
          parsedArgs = JSON.parse(repaired);
        } else {
          // Repair failed — provide detailed error to help LLM fix it
          const syntaxError = parseError as SyntaxError;
          const positionMatch = syntaxError.message?.match(/position (\d+)/i);
          const position = positionMatch ? parseInt(positionMatch[1], 10) : undefined;

          let errorContext = '';
          if (position !== undefined) {
            const contextStart = Math.max(0, position - 50);
            const contextEnd = Math.min(args.length, position + 50);
            errorContext = args.substring(contextStart, contextEnd);
          }

          logger.error(`Function API JSON parse error [${name}]`, {
            error: String(syntaxError.message ?? syntaxError),
            position,
            context: errorContext || args.substring(0, 100),
          });

          return JSON.stringify({
            success: false,
            error: `Invalid JSON in function arguments: ${syntaxError.message}`,
            errorCode: 'INVALID_JSON_ARGUMENTS',
            details: {
              position: position ?? 'unknown',
              context: errorContext || args.substring(0, 100),
              hint: 'Check for unescaped quotes, missing commas, or special characters in string values.',
            },
          });
        }
      }
      // Pass the function name to the function_api tool
      return await tool.execute(parsedArgs, { functionName: name, configOverride });
    } catch (error) {
      logger.error(`Function API execution error [${name}]`, error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: 'EXECUTION_ERROR',
      });
    }
  }

  if (!tool) {
    return JSON.stringify({
      success: false,
      error: `Unknown tool: ${name}`,
      errorCode: 'UNKNOWN_TOOL',
    });
  }

  // Check if tool is enabled
  if (!(await isToolEnabled(name))) {
    return JSON.stringify({
      success: false,
      error: `Tool '${name}' is currently disabled`,
      errorCode: 'TOOL_DISABLED',
    });
  }

  try {
    let parsedArgs;
    try {
      parsedArgs = JSON.parse(args);
    } catch (parseError) {
      // Try JSON repair first (handles truncated arguments from streaming issues)
      const repaired = attemptJsonRepair(args);
      if (repaired) {
        logger.warn(`JSON repair succeeded for tool [${name}]`, { originalLen: args.length });
        parsedArgs = JSON.parse(repaired);
      } else {
        // Repair failed — provide detailed error to help LLM fix it
        const syntaxError = parseError as SyntaxError;
        const positionMatch = syntaxError.message?.match(/position (\d+)/i);
        const position = positionMatch ? parseInt(positionMatch[1], 10) : undefined;

        let errorContext = '';
        if (position !== undefined) {
          const contextStart = Math.max(0, position - 50);
          const contextEnd = Math.min(args.length, position + 50);
          errorContext = args.substring(contextStart, contextEnd);
        }

        logger.error(`Tool JSON parse error [${name}]`, {
          error: String(syntaxError.message ?? syntaxError),
          position,
          context: errorContext || args.substring(0, 100),
        });

        return JSON.stringify({
          success: false,
          error: `Invalid JSON in tool arguments: ${syntaxError.message}`,
          errorCode: 'INVALID_JSON_ARGUMENTS',
          details: {
            position: position ?? 'unknown',
            context: errorContext || args.substring(0, 100),
            hint: 'Check for unescaped quotes, missing commas, or special characters in string values. Ensure all strings are properly JSON-escaped.',
          },
        });
      }
    }
    return await tool.execute(parsedArgs, { configOverride });
  } catch (error) {
    logger.error(`Tool execution error [${name}]`, error);
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: 'EXECUTION_ERROR',
    });
  }
}

// ============ Utility Functions ============

/**
 * Get tool metadata for display
 */
export async function getToolMetadata(name: string): Promise<{
  name: string;
  displayName: string;
  description: string;
  category: ToolCategory;
  enabled: boolean;
} | undefined> {
  const tool = AVAILABLE_TOOLS[name];
  if (!tool) return undefined;

  return {
    name: tool.name,
    displayName: tool.displayName,
    description: tool.description,
    category: tool.category,
    enabled: await isToolEnabled(name),
  };
}

/**
 * Validate a tool's configuration
 */
export function validateToolConfig(
  name: string,
  config: Record<string, unknown>
): ValidationResult {
  const tool = AVAILABLE_TOOLS[name];
  if (!tool) {
    return { valid: false, errors: [`Unknown tool: ${name}`] };
  }
  return tool.validateConfig(config);
}

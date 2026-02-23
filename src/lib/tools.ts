import type { OpenAI } from 'openai';
import { tavilyWebSearch } from './tools/tavily';
import { documentGenerationTool } from './tools/docgen';
import { dataSourceTool } from './tools/data-source';
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
import { isToolEnabled as isToolEnabledDb, migrateTavilySettingsIfNeeded, ensureToolConfigsExist, getDescriptionOverride } from './db/tool-config';
import { toolsLogger as logger } from './logger';

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
  definition?: OpenAI.Chat.ChatCompletionTool;
  /** Execute the tool with arguments. Options include functionName for dynamic tools and configOverride for skill-level config. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (args: any, options?: ToolExecutionOptions) => Promise<string>;
  /** Validate tool configuration */
  validateConfig: (config: Record<string, unknown>) => ValidationResult;
  /** Default configuration values */
  defaultConfig: Record<string, unknown>;
  /** JSON Schema for configuration (for admin UI generation) */
  configSchema: Record<string, unknown>;
}

/**
 * Legacy tool interface for backward compatibility
 * @deprecated Use ToolDefinition instead
 */
export interface LegacyToolDefinition {
  definition: OpenAI.Chat.ChatCompletionTool;
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
  web_search: tavilyWebSearch,
  doc_gen: documentGenerationTool,
  data_source: dataSourceTool,
  function_api: functionApiTool,
  youtube: youtubeToolDefinition,
  chart_gen: chartGenTool,

  image_gen: imageGenTool,
  translation: translationTool,
  share_thread: shareThreadTool,
  send_email: sendEmailTool,
  diagram_gen: diagramGenTool,
  compliance_checker: complianceCheckerTool,
  xlsx_gen: xlsxGenTool,
  pptx_gen: pptxGenTool,
  podcast_gen: podcastGenTool,
};

// ============ Initialization ============

let toolsInitialized = false;

/**
 * Initialize the tools system
 * - Migrates legacy Tavily settings to tool_configs table
 * - Ensures all registered tools have configurations
 */
export function initializeTools(): void {
  if (toolsInitialized) return;

  try {
    // Migrate existing Tavily settings if needed
    migrateTavilySettingsIfNeeded();

    // Ensure all registered tools have configs
    ensureToolConfigsExist();

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
export function isToolEnabled(name: string): boolean {
  initializeTools();
  return isToolEnabledDb(name);
}

/**
 * Get all tool definitions for OpenAI API
 * Only returns definitions for enabled autonomous tools
 * Applies admin-configured description overrides when available
 * @param categoryIds - Optional category IDs to include dynamic function definitions
 */
export function getToolDefinitions(categoryIds?: number[]): OpenAI.Chat.ChatCompletionTool[] {
  initializeTools();

  const tools: OpenAI.Chat.ChatCompletionTool[] = [];

  // Add static tool definitions
  for (const tool of Object.values(AVAILABLE_TOOLS)) {
    if (tool.category !== 'autonomous' || !isToolEnabled(tool.name)) continue;

    // Skip function_api here - its definitions are added dynamically below
    if (tool.name === 'function_api') continue;

    if (tool.definition) {
      // Check for admin-configured description override
      const descriptionOverride = getDescriptionOverride(tool.name);

      if (descriptionOverride) {
        // Create a copy with the overridden description
        const overriddenTool: OpenAI.Chat.ChatCompletionTool = {
          ...tool.definition,
          function: {
            ...tool.definition.function,
            description: descriptionOverride,
          },
        };
        tools.push(overriddenTool);
        logger.debug('Applied description override', { tool: tool.name });
      } else {
        tools.push(tool.definition);
      }
    }
  }

  // Add dynamic function definitions from Function APIs
  if (categoryIds && categoryIds.length > 0 && isToolEnabled('function_api')) {
    const functionDefinitions = getDynamicFunctionDefinitions(categoryIds);
    tools.push(...functionDefinitions);
  }

  return tools;
}

/**
 * Get all enabled autonomous tool definitions (alias for getToolDefinitions)
 * @param categoryIds - Optional category IDs to include dynamic function definitions
 */
export function getEnabledAutonomousTools(categoryIds?: number[]): OpenAI.Chat.ChatCompletionTool[] {
  return getToolDefinitions(categoryIds);
}

/**
 * Get all processor tools (for post-response processing)
 */
export function getProcessorTools(): ToolDefinition[] {
  initializeTools();
  return Object.values(AVAILABLE_TOOLS)
    .filter(tool => tool.category === 'processor' && isToolEnabled(tool.name));
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
export async function executeTool(
  name: string,
  args: string,
  configOverride?: Record<string, unknown>
): Promise<string> {
  initializeTools();

  // Check standard tools first
  let tool = AVAILABLE_TOOLS[name];

  // If not found, check if it's a dynamic function from function_api
  if (!tool && isFunctionAPIFunction(name)) {
    tool = AVAILABLE_TOOLS['function_api'];

    // Check if function_api tool is enabled
    if (!isToolEnabled('function_api')) {
      return JSON.stringify({
        success: false,
        error: `Function APIs are currently disabled`,
        errorCode: 'TOOL_DISABLED',
      });
    }

    try {
      const parsedArgs = JSON.parse(args);
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
  if (!isToolEnabled(name)) {
    return JSON.stringify({
      success: false,
      error: `Tool '${name}' is currently disabled`,
      errorCode: 'TOOL_DISABLED',
    });
  }

  try {
    const parsedArgs = JSON.parse(args);
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
export function getToolMetadata(name: string): {
  name: string;
  displayName: string;
  description: string;
  category: ToolCategory;
  enabled: boolean;
} | undefined {
  const tool = AVAILABLE_TOOLS[name];
  if (!tool) return undefined;

  return {
    name: tool.name,
    displayName: tool.displayName,
    description: tool.description,
    category: tool.category,
    enabled: isToolEnabled(name),
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

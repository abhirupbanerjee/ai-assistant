/**
 * Function API Tool
 *
 * Dynamic tool that generates OpenAI function definitions from admin-configured
 * Function API schemas. Supports multiple function definitions per API configuration.
 */

import type OpenAI from 'openai';
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';
import type { FunctionAPIConfig, FunctionExecutionResult } from '../../types/function-api';
import {
  getToolDefinitionsForCategories,
  findConfigForFunction,
  getFunctionAPIConfigsForCategories,
} from '../db/compat';
import { hashQuery, getCachedQuery, cacheQuery } from '../redis';
import { getRequestContext } from '../request-context';

// ===== Configuration =====

/**
 * Function API tool configuration schema (minimal - config is per-API)
 */
const functionApiConfigSchema = {
  type: 'object',
  properties: {
    globalEnabled: {
      type: 'boolean',
      title: 'Global Enable',
      description: 'Master switch for all Function APIs',
      default: true,
    },
  },
};

// ===== Helpers =====

/**
 * Substitute path parameters (e.g. {owner}) and add remaining args as query params.
 * Returns { resolvedPath, remainingParams } so callers can use remainingParams as body too.
 */
function resolvePathParams(
  path: string,
  params: Record<string, unknown>
): { resolvedPath: string; remainingParams: Record<string, unknown> } {
  let resolvedPath = path;
  const remainingParams: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (resolvedPath.includes(`{${key}}`)) {
      resolvedPath = resolvedPath.replace(`{${key}}`, encodeURIComponent(String(value ?? '')));
    } else {
      remainingParams[key] = value;
    }
  }

  return { resolvedPath, remainingParams };
}

/**
 * Build request URL with path param substitution and query parameters
 */
function buildRequestUrl(
  baseUrl: string,
  path: string,
  params: Record<string, unknown>
): string {
  const { resolvedPath, remainingParams } = resolvePathParams(path, params);
  const url = new URL(resolvedPath, baseUrl);

  for (const [key, value] of Object.entries(remainingParams)) {
    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
      } else if (typeof value === 'object') {
        // Skip objects for query params
        continue;
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

/**
 * Build authentication headers for a Function API config
 */
function buildAuthHeaders(config: FunctionAPIConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  // Add default headers
  if (config.defaultHeaders) {
    Object.assign(headers, config.defaultHeaders);
  }

  // Add authentication
  if (config.authCredentials) {
    const credentials = config.authCredentials;

    switch (config.authType) {
      case 'api_key':
        headers[config.authHeader || 'X-API-Key'] = credentials;
        break;

      case 'bearer':
        headers['Authorization'] = `Bearer ${credentials}`;
        break;

      case 'basic':
        // For basic auth, credentials should be username:password
        const encoded = Buffer.from(credentials).toString('base64');
        headers['Authorization'] = `Basic ${encoded}`;
        break;

      case 'none':
      default:
        // No auth
        break;
    }
  }

  return headers;
}

/**
 * Format API response for LLM consumption
 */
function formatResponseForLLM(
  result: FunctionExecutionResult
): string {
  if (!result.success) {
    return JSON.stringify({
      success: false,
      error: result.error,
    });
  }

  return JSON.stringify({
    success: true,
    data: result.data,
    metadata: result.metadata,
  }, null, 2);
}

// ===== Tool Implementation =====

/**
 * Execute a function from a Function API
 */
async function executeFunction(
  args: Record<string, unknown>,
  functionName: string
): Promise<string> {
  const startTime = Date.now();

  // Get category IDs from request context
  const context = getRequestContext();
  const categoryIds = context.categoryIds && context.categoryIds.length > 0 ? context.categoryIds : [];

  // Find the config that contains this function
  const match = await findConfigForFunction(functionName, categoryIds);

  if (!match) {
    return formatResponseForLLM({
      success: false,
      error: {
        code: 'FUNCTION_NOT_FOUND',
        message: `Function '${functionName}' not found or not accessible`,
      },
    });
  }

  const { config, endpoint } = match;

  // Check cache first
  const cacheKey = `function_api:${config.id}:${functionName}:${hashQuery(JSON.stringify(args))}`;
  try {
    const cached = await getCachedQuery(cacheKey);
    if (cached) {
      const cachedResult = JSON.parse(cached) as FunctionExecutionResult;
      return formatResponseForLLM({
        ...cachedResult,
        metadata: {
          ...cachedResult.metadata!,
          cached: true,
          executionTimeMs: Date.now() - startTime,
        },
      });
    }
  } catch {
    // Cache miss or error, continue to fetch
  }

  try {
    // Build request URL
    let url: string;
    let bodyArgs = args;
    if (endpoint.method === 'GET') {
      url = buildRequestUrl(config.baseUrl, endpoint.path, args);
    } else {
      const { resolvedPath, remainingParams } = resolvePathParams(endpoint.path, args);
      url = new URL(resolvedPath, config.baseUrl).toString();
      bodyArgs = remainingParams;
    }

    // Build headers
    const headers = buildAuthHeaders(config);

    // Build request options
    const requestOptions: RequestInit = {
      method: endpoint.method,
      headers,
      signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
    };

    // Add body for POST/PUT requests (excluding path params already substituted)
    if (['POST', 'PUT'].includes(endpoint.method) && Object.keys(bodyArgs).length > 0) {
      requestOptions.body = JSON.stringify(bodyArgs);
    }

    // Make the request
    const response = await fetch(url, requestOptions);

    // Check response status
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return formatResponseForLLM({
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: `API returned ${response.status}: ${response.statusText}`,
          details: errorText.substring(0, 500),
        },
      });
    }

    // Parse response
    const data = await response.json();

    const result: FunctionExecutionResult = {
      success: true,
      data,
      metadata: {
        source: config.name,
        functionName,
        executionTimeMs: Date.now() - startTime,
        cached: false,
      },
    };

    // Cache the result
    try {
      await cacheQuery(cacheKey, JSON.stringify(result), config.cacheTTLSeconds);
    } catch {
      // Cache write failure is not critical
    }

    return formatResponseForLLM(result);
  } catch (error) {
    // Handle timeout
    if (error instanceof Error && error.name === 'TimeoutError') {
      return formatResponseForLLM({
        success: false,
        error: {
          code: 'TIMEOUT',
          message: `Request timed out after ${config.timeoutSeconds} seconds`,
        },
      });
    }

    // Handle other errors
    return formatResponseForLLM({
      success: false,
      error: {
        code: 'REQUEST_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error calling API',
      },
    });
  }
}

// ===== Tool Definition =====

/**
 * Function API tool - dynamic tool with multiple function definitions
 */
export const functionApiTool: ToolDefinition = {
  name: 'function_api',
  displayName: 'Function Calling APIs',
  description: 'Structured API access with explicit OpenAI-format function schemas. Configure multiple APIs with custom function definitions.',
  category: 'autonomous',

  // No static definition - definitions are loaded dynamically
  definition: undefined,

  // Main execute function - called with function name from tool registry
  execute: async (args: Record<string, unknown>, options?: ToolExecutionOptions): Promise<string> => {
    const functionName = options?.functionName;
    if (!functionName) {
      return JSON.stringify({
        success: false,
        error: {
          code: 'MISSING_FUNCTION_NAME',
          message: 'Function name is required',
        },
      });
    }

    return executeFunction(args, functionName);
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validateConfig: (_config: Record<string, unknown>): ValidationResult => {
    // Minimal validation - actual validation is per-API
    return { valid: true, errors: [] };
  },

  defaultConfig: {
    globalEnabled: true,
  },

  configSchema: functionApiConfigSchema,
};

// ===== Public Functions for Tool Registry =====

/**
 * Get dynamic function definitions for specific categories
 * Called by the tool registry to inject function definitions
 */
export async function getDynamicFunctionDefinitions(
  categoryIds: number[]
): Promise<OpenAI.Chat.ChatCompletionFunctionTool[]> {
  return getToolDefinitionsForCategories(categoryIds);
}

/**
 * Check if a function name belongs to a Function API
 */
export async function isFunctionAPIFunction(functionName: string): Promise<boolean> {
  const match = await findConfigForFunction(functionName);
  return match !== undefined;
}

/**
 * Get available Function API descriptions for system prompt
 */
export async function getFunctionAPIDescriptions(categoryIds: number[]): Promise<string> {
  const configs = await getFunctionAPIConfigsForCategories(categoryIds);
  if (configs.length === 0) return '';

  const descriptions = ['## Available Function APIs'];

  for (const config of configs) {
    descriptions.push(`\n### ${config.name}`);
    if (config.description) {
      descriptions.push(config.description);
    }

    const functionNames = config.toolsSchema.map(t => t.function.name);
    descriptions.push(`Functions: ${functionNames.join(', ')}`);
  }

  return descriptions.join('\n');
}

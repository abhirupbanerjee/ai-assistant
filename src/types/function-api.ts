/**
 * Function API Type Definitions
 *
 * Types for OpenAI-format function calling API configurations,
 * supporting structured tool definitions with explicit function schemas.
 */

import type OpenAI from 'openai';

// ===== Endpoint Mapping Types =====

/**
 * Maps a function name to its HTTP endpoint
 */
export interface EndpointMapping {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path relative to base URL (e.g., "/feedback") */
  path: string;
}

// ===== Authentication Types =====

/**
 * Authentication type for Function API
 */
export type FunctionAPIAuthType = 'api_key' | 'bearer' | 'basic' | 'none';

// ===== Status Types =====

/**
 * Status of the Function API configuration
 */
export type FunctionAPIStatus = 'active' | 'inactive' | 'error' | 'untested';

// ===== Main Configuration Type =====

/**
 * Function API Configuration
 * Stores OpenAI-format function definitions with API connection details
 */
export interface FunctionAPIConfig {
  /** Unique identifier */
  id: string;
  /** Display name (e.g., "GEA Analytics API") */
  name: string;
  /** Description of what this API provides */
  description: string;

  // API Connection
  /** Base URL for the API (e.g., "https://gea.abhirup.app/api/external") */
  baseUrl: string;
  /** Authentication type */
  authType: FunctionAPIAuthType;
  /** Header name for API key or bearer token (e.g., "X-API-Key") */
  authHeader?: string;
  /** Encrypted API key, bearer token, or basic auth credentials */
  authCredentials?: string;
  /** Additional default headers */
  defaultHeaders?: Record<string, string>;

  // Function Definitions (OpenAI format)
  /** Array of OpenAI function tool definitions */
  toolsSchema: OpenAI.Chat.ChatCompletionFunctionTool[];

  // Endpoint Mappings
  /** Maps function names to HTTP endpoints */
  endpointMappings: Record<string, EndpointMapping>;

  // Settings
  /** Request timeout in seconds */
  timeoutSeconds: number;
  /** Cache TTL in seconds */
  cacheTTLSeconds: number;
  /** Whether this API is enabled */
  isEnabled: boolean;
  /** Current status */
  status: FunctionAPIStatus;

  // Category Access
  /** Category IDs that have access to this API */
  categoryIds: number[];

  // Audit
  /** Who created this configuration */
  createdBy: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Last test timestamp */
  lastTested?: string;
  /** Last error message */
  lastError?: string;
}

// ===== Database Row Types =====

/**
 * Database row for function_api_configs table
 */
export interface DbFunctionAPIConfig {
  id: string;
  name: string;
  description: string | null;
  base_url: string;
  auth_type: string;
  auth_header: string | null;
  auth_credentials: string | null;
  default_headers: string | null;
  tools_schema: string;
  endpoint_mappings: string;
  timeout_seconds: number;
  cache_ttl_seconds: number;
  is_enabled: number;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_tested: string | null;
  last_error: string | null;
}

/**
 * Database row for function_api_categories table
 */
export interface DbFunctionAPICategory {
  api_id: string;
  category_id: number;
  created_at: string;
}

// ===== API Request/Response Types =====

/**
 * Request body for creating a Function API config
 */
export interface CreateFunctionAPIRequest {
  name: string;
  description?: string;
  baseUrl: string;
  authType: FunctionAPIAuthType;
  authHeader?: string;
  authCredentials?: string;
  defaultHeaders?: Record<string, string>;
  toolsSchema: OpenAI.Chat.ChatCompletionFunctionTool[];
  endpointMappings: Record<string, EndpointMapping>;
  timeoutSeconds?: number;
  cacheTTLSeconds?: number;
  isEnabled?: boolean;
  categoryIds: number[];
}

/**
 * Request body for updating a Function API config
 */
export interface UpdateFunctionAPIRequest {
  name?: string;
  description?: string;
  baseUrl?: string;
  authType?: FunctionAPIAuthType;
  authHeader?: string;
  authCredentials?: string;
  defaultHeaders?: Record<string, string>;
  toolsSchema?: OpenAI.Chat.ChatCompletionFunctionTool[];
  endpointMappings?: Record<string, EndpointMapping>;
  timeoutSeconds?: number;
  cacheTTLSeconds?: number;
  isEnabled?: boolean;
  status?: FunctionAPIStatus;
  categoryIds?: number[];
  lastError?: string;
}

/**
 * Test result for a Function API
 */
export interface FunctionAPITestResult {
  success: boolean;
  message: string;
  functionsTested?: string[];
  latencyMs?: number;
  sampleResponse?: unknown;
}

// ===== Execution Types =====

/**
 * Result of executing a function from a Function API
 */
export interface FunctionExecutionResult {
  success: boolean;
  data?: unknown;
  metadata?: {
    source: string;
    functionName: string;
    executionTimeMs: number;
    cached: boolean;
  };
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

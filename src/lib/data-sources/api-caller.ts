/**
 * Data API Caller
 *
 * Handles calling external APIs with authentication, caching, and error handling.
 */

import { safeDecrypt } from '../encryption';
import { hashQuery, getCachedQuery, cacheQuery } from '../redis';
import { getToolConfig } from '../db/compat/tool-config';
import type {
  DataAPIConfig,
  DataAPIParameter,
  DataQueryResponse,
} from '../../types/data-sources';

// ===== Configuration =====

/**
 * Get data source tool configuration
 */
async function getDataSourceConfig(): Promise<{ cacheTTLSeconds: number; timeout: number }> {
  const config = await getToolConfig('data_source');
  if (config?.config) {
    return {
      cacheTTLSeconds: (config.config as Record<string, number>).cacheTTLSeconds || 3600,
      timeout: (config.config as Record<string, number>).timeout || 30,
    };
  }
  return { cacheTTLSeconds: 3600, timeout: 30 };
}

// ===== API Calling =====

/**
 * Call an external data API
 */
export async function callDataAPI(
  config: DataAPIConfig,
  params: Record<string, unknown> = {}
): Promise<DataQueryResponse> {
  const startTime = Date.now();
  const toolConfig = await getDataSourceConfig();

  // Generate cache key
  const cacheKey = `data_api:${config.id}:${hashQuery(JSON.stringify(params))}`;

  // Check cache first
  try {
    const cached = await getCachedQuery(cacheKey);
    if (cached) {
      const cachedResponse = JSON.parse(cached) as DataQueryResponse;
      return {
        ...cachedResponse,
        metadata: {
          ...cachedResponse.metadata,
          cached: true,
          executionTimeMs: Date.now() - startTime,
        },
      };
    }
  } catch {
    // Cache miss or error, continue to fetch
  }

  try {
    // Build request URL
    const url = buildRequestUrl(config, params);

    // Build headers
    const headers = buildHeaders(config);

    // Build request options
    const requestOptions: RequestInit = {
      method: config.method,
      headers,
      signal: AbortSignal.timeout(toolConfig.timeout * 1000),
    };

    // Add body for POST requests
    if (config.method === 'POST') {
      const bodyParams = extractBodyParams(config.parameters, params);
      if (Object.keys(bodyParams).length > 0) {
        requestOptions.body = JSON.stringify(bodyParams);
      }
    }

    // Make the request
    const response = await fetch(url, requestOptions);

    // Check response status
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return {
        success: false,
        data: null,
        metadata: {
          source: config.name,
          sourceType: 'api',
          fetchedAt: new Date().toISOString(),
          cached: false,
          recordCount: 0,
          fields: [],
          executionTimeMs: Date.now() - startTime,
        },
        error: {
          code: `HTTP_${response.status}`,
          message: `API returned ${response.status}: ${response.statusText}`,
          details: errorText.substring(0, 500),
        },
      };
    }

    // Parse response
    let rawData: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (config.responseFormat === 'csv' || contentType.includes('text/csv')) {
      // Handle CSV response
      const csvText = await response.text();
      rawData = parseCSVResponse(csvText);
    } else {
      // Handle JSON response
      rawData = await response.json();
    }

    // Extract data using jsonPath
    const extractedData = extractDataByPath(rawData, config.responseStructure.jsonPath);

    // Ensure data is an array
    const data = Array.isArray(extractedData)
      ? extractedData
      : extractedData !== null && extractedData !== undefined
        ? [extractedData]
        : [];

    // Get total records if path is specified
    let totalRecords: number | undefined;
    if (config.responseStructure.totalCountPath) {
      const total = extractDataByPath(rawData, config.responseStructure.totalCountPath);
      if (typeof total === 'number') {
        totalRecords = total;
      }
    }

    // Build response
    const result: DataQueryResponse = {
      success: true,
      data: data as Record<string, unknown>[],
      metadata: {
        source: config.name,
        sourceType: 'api',
        fetchedAt: new Date().toISOString(),
        cached: false,
        recordCount: data.length,
        totalRecords,
        fields: config.responseStructure.fields.map(f => f.name),
        executionTimeMs: Date.now() - startTime,
      },
    };

    // Cache the result
    try {
      await cacheQuery(cacheKey, JSON.stringify(result), toolConfig.cacheTTLSeconds);
    } catch {
      // Cache write failure is not critical
    }

    return result;
  } catch (error) {
    // Handle timeout
    if (error instanceof Error && error.name === 'TimeoutError') {
      return {
        success: false,
        data: null,
        metadata: {
          source: config.name,
          sourceType: 'api',
          fetchedAt: new Date().toISOString(),
          cached: false,
          recordCount: 0,
          fields: [],
          executionTimeMs: Date.now() - startTime,
        },
        error: {
          code: 'TIMEOUT',
          message: `Request timed out after ${toolConfig.timeout} seconds`,
        },
      };
    }

    // Handle other errors
    return {
      success: false,
      data: null,
      metadata: {
        source: config.name,
        sourceType: 'api',
        fetchedAt: new Date().toISOString(),
        cached: false,
        recordCount: 0,
        fields: [],
        executionTimeMs: Date.now() - startTime,
      },
      error: {
        code: 'REQUEST_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error calling API',
      },
    };
  }
}

/**
 * Build the request URL with query parameters
 */
function buildRequestUrl(
  config: DataAPIConfig,
  params: Record<string, unknown>
): string {
  const url = new URL(config.endpoint);

  // Add query parameters
  const queryParams = extractQueryParams(config.parameters, params);
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== null && value !== undefined) {
      if (Array.isArray(value)) {
        // Handle array parameters
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  // Handle path parameters
  let urlString = url.toString();
  const pathParams = extractPathParams(config.parameters, params);
  for (const [key, value] of Object.entries(pathParams)) {
    urlString = urlString.replace(`{${key}}`, encodeURIComponent(String(value)));
  }

  return urlString;
}

/**
 * Extract query parameters from params
 */
function extractQueryParams(
  paramDefs: DataAPIParameter[],
  params: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const def of paramDefs) {
    if (def.in !== 'query') continue;

    const value = params[def.name];
    if (value !== undefined) {
      result[def.name] = value;
    } else if (def.default !== undefined) {
      result[def.name] = def.default;
    }
  }

  return result;
}

/**
 * Extract path parameters from params
 */
function extractPathParams(
  paramDefs: DataAPIParameter[],
  params: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const def of paramDefs) {
    if (def.in !== 'path') continue;

    const value = params[def.name];
    if (value !== undefined) {
      result[def.name] = value;
    }
  }

  return result;
}

/**
 * Extract body parameters from params
 */
function extractBodyParams(
  paramDefs: DataAPIParameter[],
  params: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const def of paramDefs) {
    if (def.in !== 'body') continue;

    const value = params[def.name];
    if (value !== undefined) {
      result[def.name] = value;
    } else if (def.default !== undefined) {
      result[def.name] = def.default;
    }
  }

  return result;
}

/**
 * Build request headers with authentication
 */
function buildHeaders(config: DataAPIConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  // Add Content-Type for POST
  if (config.method === 'POST') {
    headers['Content-Type'] = 'application/json';
  }

  // Add authentication
  if (config.authentication.type !== 'none' && config.authentication.credentials) {
    const creds = config.authentication.credentials;

    switch (config.authentication.type) {
      case 'bearer':
        if (creds.token) {
          const token = safeDecrypt(creds.token) || creds.token;
          headers['Authorization'] = `Bearer ${token}`;
        }
        break;

      case 'api_key':
        if (creds.apiKey) {
          const key = safeDecrypt(creds.apiKey) || creds.apiKey;
          const headerName = creds.apiKeyHeader || 'X-API-Key';

          if (creds.apiKeyLocation === 'query') {
            // API key in query will be added in buildRequestUrl
            // This is handled specially
          } else {
            headers[headerName] = key;
          }
        }
        break;

      case 'basic':
        if (creds.username) {
          const password = creds.password ? (safeDecrypt(creds.password) || creds.password) : '';
          const encoded = Buffer.from(`${creds.username}:${password}`).toString('base64');
          headers['Authorization'] = `Basic ${encoded}`;
        }
        break;
    }
  }

  // Add custom headers
  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      headers[key] = value;
    }
  }

  // Add header parameters
  if (config.authentication.type === 'api_key' &&
      config.authentication.credentials?.apiKeyLocation === 'header' &&
      config.authentication.credentials.apiKey) {
    // Already handled above
  }

  return headers;
}

/**
 * Extract data from response using JSON path
 */
function extractDataByPath(data: unknown, jsonPath: string): unknown {
  if (jsonPath === '$' || jsonPath === '' || !jsonPath) {
    return data;
  }

  // Remove leading $ if present
  let path = jsonPath;
  if (path.startsWith('$.')) {
    path = path.substring(2);
  } else if (path.startsWith('$')) {
    path = path.substring(1);
  }

  // Split by dots, handling array notation
  const parts = path.split(/\.|\[(\d+)\]/).filter(p => p !== '' && p !== undefined);

  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return null;
    }

    if (typeof current === 'object') {
      // Handle numeric index
      const index = parseInt(part, 10);
      if (!isNaN(index) && Array.isArray(current)) {
        current = current[index];
      } else {
        current = (current as Record<string, unknown>)[part];
      }
    } else {
      return null;
    }
  }

  return current;
}

/**
 * Parse CSV response text into array of objects
 */
function parseCSVResponse(csvText: string): Record<string, unknown>[] {
  const lines = csvText.trim().split('\n');
  if (lines.length === 0) return [];

  // Parse header
  const headers = parseCSVLine(lines[0]);
  if (headers.length === 0) return [];

  // Parse data rows
  const data: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, unknown> = {};

    for (let j = 0; j < headers.length; j++) {
      const value = values[j] || '';
      // Try to parse as number
      const num = parseFloat(value);
      row[headers[j]] = !isNaN(num) && value.trim() !== '' ? num : value;
    }

    data.push(row);
  }

  return data;
}

/**
 * Parse a single CSV line
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Test an API connection
 */
export async function testAPIConnection(
  config: DataAPIConfig
): Promise<{ success: boolean; message: string; sampleData?: Record<string, unknown>[] }> {
  // Build minimal test params using defaults
  const testParams: Record<string, unknown> = {};
  for (const param of config.parameters) {
    if (param.required) {
      if (param.example !== undefined) {
        testParams[param.name] = param.example;
      } else if (param.default !== undefined) {
        testParams[param.name] = param.default;
      } else {
        return {
          success: false,
          message: `Missing required parameter: ${param.name}. Please provide an example value.`,
        };
      }
    }
  }

  const response = await callDataAPI(config, testParams);

  if (!response.success) {
    return {
      success: false,
      message: response.error?.message || 'Unknown error',
    };
  }

  return {
    success: true,
    message: `Successfully retrieved ${response.metadata.recordCount} records`,
    sampleData: response.data?.slice(0, 3) as Record<string, unknown>[],
  };
}

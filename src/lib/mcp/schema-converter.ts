/**
 * MCP JSON Schema → OpenAI Function Parameters Converter
 *
 * Converts MCP tool inputSchema (JSON Schema) into the OpenAI function
 * parameters shape. Supports the common subset used by LLM tool calling and
 * strips or warns about unsupported features.
 */

import type { OpenAI } from 'openai';
import { toolsLogger as logger } from '@/lib/logger';

export interface SchemaConversionResult {
  parameters: OpenAI.Chat.ChatCompletionFunctionTool['function']['parameters'];
  warnings: string[];
}

const SUPPORTED_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Convert an MCP inputSchema to OpenAI function parameters.
 */
export function convertMcpSchemaToOpenAI(inputSchema: unknown): SchemaConversionResult {
  const warnings: string[] = [];

  if (!isRecord(inputSchema)) {
    warnings.push('Input schema is not an object; defaulting to empty object schema');
    return {
      parameters: { type: 'object', properties: {}, required: [] },
      warnings,
    };
  }

  const converted = convertSchemaNode(inputSchema, warnings, '$');

  // OpenAI expects function parameters to be an object with type 'object'.
  if (!isRecord(converted) || converted.type !== 'object') {
    warnings.push('Root schema is not an object; wrapping in object schema');
    return {
      parameters: {
        type: 'object',
        properties: converted && isRecord(converted) ? { value: converted } : {},
        required: [],
      },
      warnings,
    };
  }

  return {
    parameters: converted as OpenAI.Chat.ChatCompletionFunctionTool['function']['parameters'],
    warnings,
  };
}

function convertSchemaNode(
  node: unknown,
  warnings: string[],
  path: string
): unknown {
  if (!isRecord(node)) {
    return node;
  }

  const output: Record<string, unknown> = {};

  // Copy type if supported; otherwise default to string and warn.
  if (typeof node.type === 'string') {
    if (SUPPORTED_TYPES.has(node.type)) {
      output.type = node.type;
    } else {
      warnings.push(`Unsupported type "${node.type}" at ${path}; defaulting to string`);
      output.type = 'string';
    }
  } else if (node.type !== undefined) {
    warnings.push(`Non-string type at ${path}; defaulting to string`);
    output.type = 'string';
  }

  // Copy description.
  if (typeof node.description === 'string') {
    output.description = node.description;
  }

  // Copy enum.
  if (Array.isArray(node.enum)) {
    output.enum = node.enum;
  }

  // Convert properties recursively.
  if (isRecord(node.properties)) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.properties)) {
      properties[key] = convertSchemaNode(value, warnings, `${path}.${key}`);
    }
    output.properties = properties;
  }

  // Copy required array if it is an array of strings.
  if (Array.isArray(node.required)) {
    output.required = node.required.filter((r): r is string => typeof r === 'string');
  }

  // Convert items for arrays.
  if (node.items !== undefined) {
    if (Array.isArray(node.items)) {
      output.items = node.items.map((item, idx) => convertSchemaNode(item, warnings, `${path}[${idx}]`));
    } else {
      output.items = convertSchemaNode(node.items, warnings, `${path}[]`);
    }
  }

  // Warn and strip unsupported JSON Schema features.
  const unsupportedKeys = [
    '$ref',
    'oneOf',
    'anyOf',
    'allOf',
    'additionalProperties',
    'patternProperties',
    'if',
    'then',
    'else',
    'not',
    'definitions',
    '$defs',
    'discriminator',
  ];
  for (const key of unsupportedKeys) {
    if (key in node) {
      warnings.push(`Unsupported JSON Schema feature "${key}" at ${path}; stripping`);
    }
  }

  // Preserve a few additional safe fields.
  if (typeof node.default !== 'undefined') {
    output.default = node.default;
  }
  if (typeof node.format === 'string') {
    output.format = node.format;
  }
  if (typeof node.pattern === 'string') {
    output.pattern = node.pattern;
  }
  if (typeof node.minLength === 'number') {
    output.minLength = node.minLength;
  }
  if (typeof node.maxLength === 'number') {
    output.maxLength = node.maxLength;
  }
  if (typeof node.minimum === 'number') {
    output.minimum = node.minimum;
  }
  if (typeof node.maximum === 'number') {
    output.maximum = node.maximum;
  }

  // If the node has no explicit type but has properties, infer object.
  if (!output.type && output.properties) {
    output.type = 'object';
  }

  return output;
}

/**
 * Estimate the JSON byte size of a converted schema.
 */
export function estimateSchemaSize(schema: Record<string, unknown>): number {
  try {
    return new Blob([JSON.stringify(schema)]).size;
  } catch {
    return JSON.stringify(schema).length;
  }
}

/**
 * Log warnings produced during schema conversion.
 */
export function logSchemaWarnings(toolName: string, warnings: string[]): void {
  if (warnings.length === 0) return;
  logger.warn(`MCP schema conversion warnings for ${toolName}`, { warnings });
}

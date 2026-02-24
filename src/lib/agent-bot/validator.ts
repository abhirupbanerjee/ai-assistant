/**
 * Agent Bot Input Validator
 *
 * Validates input against version's input schema:
 * - Parameter validation using JSON Schema (ajv)
 * - File validation (count, size, MIME types)
 * - Output type validation
 */

import Ajv, { ErrorObject } from 'ajv';
import type {
  InputSchema,
  InputParameter,
  InputFileConfig,
  OutputConfig,
  OutputType,
} from '@/types/agent-bot';

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

export interface FileValidationInput {
  filename: string;
  size: number;
  mimeType: string;
}

// ============================================================================
// JSON Schema Converter
// ============================================================================

/**
 * Convert InputParameter to JSON Schema property
 */
function parameterToJsonSchema(param: InputParameter): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: param.type,
  };

  if (param.description) {
    schema.description = param.description;
  }

  // String constraints
  if (param.type === 'string') {
    if (param.maxLength !== undefined) schema.maxLength = param.maxLength;
    if (param.minLength !== undefined) schema.minLength = param.minLength;
    if (param.pattern) schema.pattern = param.pattern;
    if (param.enum && param.enum.length > 0) schema.enum = param.enum;
  }

  // Number constraints
  if (param.type === 'number') {
    if (param.minimum !== undefined) schema.minimum = param.minimum;
    if (param.maximum !== undefined) schema.maximum = param.maximum;
  }

  // Array constraints
  if (param.type === 'array') {
    if (param.items) {
      schema.items = parameterToJsonSchema({
        ...param.items,
        name: 'item',
        required: false,
      } as InputParameter);
    }
    if (param.maxItems !== undefined) schema.maxItems = param.maxItems;
    if (param.minItems !== undefined) schema.minItems = param.minItems;
  }

  // Object constraints
  if (param.type === 'object' && param.properties) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [propName, propDef] of Object.entries(param.properties)) {
      properties[propName] = parameterToJsonSchema({
        ...propDef,
        name: propName,
        required: propDef.required ?? false,
      } as InputParameter);

      if (propDef.required) {
        required.push(propName);
      }
    }

    schema.properties = properties;
    if (required.length > 0) {
      schema.required = required;
    }
    schema.additionalProperties = false;
  }

  // Default value
  if (param.default !== undefined) {
    schema.default = param.default;
  }

  return schema;
}

/**
 * Convert InputSchema to JSON Schema
 */
export function inputSchemaToJsonSchema(inputSchema: InputSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of inputSchema.parameters) {
    properties[param.name] = parameterToJsonSchema(param);
    if (param.required) {
      required.push(param.name);
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: false,
  };
}

// ============================================================================
// Input Validator
// ============================================================================

// Create AJV instance
const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  coerceTypes: false,
  useDefaults: true,
});

/**
 * Format AJV errors into human-readable messages
 */
function formatAjvErrors(errors: ErrorObject[] | null | undefined): ValidationError[] {
  if (!errors || errors.length === 0) {
    return [];
  }

  return errors.map((err) => {
    const field = err.instancePath
      ? err.instancePath.slice(1).replace(/\//g, '.')
      : err.params?.missingProperty || 'input';

    let message: string;

    switch (err.keyword) {
      case 'required':
        message = `Missing required field: ${err.params?.missingProperty}`;
        break;
      case 'type':
        message = `Expected ${err.params?.type}, got ${typeof err.data}`;
        break;
      case 'enum':
        message = `Must be one of: ${(err.params?.allowedValues as string[])?.join(', ')}`;
        break;
      case 'maxLength':
        message = `Must be at most ${err.params?.limit} characters`;
        break;
      case 'minLength':
        message = `Must be at least ${err.params?.limit} characters`;
        break;
      case 'maximum':
        message = `Must be at most ${err.params?.limit}`;
        break;
      case 'minimum':
        message = `Must be at least ${err.params?.limit}`;
        break;
      case 'maxItems':
        message = `Array must have at most ${err.params?.limit} items`;
        break;
      case 'minItems':
        message = `Array must have at least ${err.params?.limit} items`;
        break;
      case 'pattern':
        message = `Must match pattern: ${err.params?.pattern}`;
        break;
      case 'additionalProperties':
        message = `Unknown property: ${err.params?.additionalProperty}`;
        break;
      case 'format':
        message = `Invalid format, expected ${err.params?.format}`;
        break;
      default:
        message = err.message || 'Validation failed';
    }

    return {
      field,
      message,
      value: err.data,
    };
  });
}

/**
 * Validate input parameters against schema
 */
export function validateInput(
  input: Record<string, unknown>,
  inputSchema: InputSchema
): ValidationResult {
  const jsonSchema = inputSchemaToJsonSchema(inputSchema);

  // Compile and validate
  const validate = ajv.compile(jsonSchema);
  const valid = validate(input);

  if (valid) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: formatAjvErrors(validate.errors),
  };
}

/**
 * Apply default values to input based on schema
 */
export function applyDefaults(
  input: Record<string, unknown>,
  inputSchema: InputSchema
): Record<string, unknown> {
  const result = { ...input };

  for (const param of inputSchema.parameters) {
    if (result[param.name] === undefined && param.default !== undefined) {
      result[param.name] = param.default;
    }
  }

  return result;
}

// ============================================================================
// File Validator
// ============================================================================

/**
 * Validate uploaded files against file config
 */
export function validateFiles(
  files: FileValidationInput[],
  fileConfig: InputFileConfig
): ValidationResult {
  const errors: ValidationError[] = [];

  // Check if files are enabled
  if (!fileConfig.enabled && files.length > 0) {
    return {
      valid: false,
      errors: [{ field: 'files', message: 'File uploads are not enabled for this agent bot' }],
    };
  }

  // Check if files are required
  if (fileConfig.required && files.length === 0) {
    return {
      valid: false,
      errors: [{ field: 'files', message: 'At least one file is required' }],
    };
  }

  // Check file count
  if (files.length > fileConfig.maxFiles) {
    errors.push({
      field: 'files',
      message: `Maximum ${fileConfig.maxFiles} files allowed, got ${files.length}`,
    });
  }

  // Check each file
  const maxSizeBytes = fileConfig.maxSizePerFileMB * 1024 * 1024;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // Check size
    if (file.size > maxSizeBytes) {
      errors.push({
        field: `files[${i}]`,
        message: `File "${file.filename}" exceeds maximum size of ${fileConfig.maxSizePerFileMB}MB`,
        value: file.filename,
      });
    }

    // Check MIME type
    if (fileConfig.allowedTypes.length > 0) {
      const isAllowed = fileConfig.allowedTypes.some((allowed) => {
        // Support wildcards like "image/*"
        if (allowed.endsWith('/*')) {
          const prefix = allowed.slice(0, -1);
          return file.mimeType.startsWith(prefix);
        }
        return file.mimeType === allowed;
      });

      if (!isAllowed) {
        errors.push({
          field: `files[${i}]`,
          message: `File "${file.filename}" has unsupported type "${file.mimeType}". Allowed: ${fileConfig.allowedTypes.join(', ')}`,
          value: file.mimeType,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Output Type Validator
// ============================================================================

/**
 * Validate requested output type against version config
 */
export function validateOutputType(
  requestedType: OutputType | undefined,
  outputConfig: OutputConfig
): ValidationResult {
  // Use default if not specified
  const type = requestedType || outputConfig.defaultType;

  if (!outputConfig.enabledTypes.includes(type)) {
    return {
      valid: false,
      errors: [
        {
          field: 'outputType',
          message: `Output type "${type}" is not enabled. Available: ${outputConfig.enabledTypes.join(', ')}`,
          value: type,
        },
      ],
    };
  }

  return { valid: true, errors: [] };
}

/**
 * Get effective output type (requested or default)
 */
export function getEffectiveOutputType(
  requestedType: OutputType | undefined,
  outputConfig: OutputConfig
): OutputType {
  if (requestedType && outputConfig.enabledTypes.includes(requestedType)) {
    return requestedType;
  }
  return outputConfig.defaultType;
}

// ============================================================================
// Complete Request Validator
// ============================================================================

export interface RequestValidationInput {
  input: Record<string, unknown>;
  files?: FileValidationInput[];
  outputType?: OutputType;
}

export interface RequestValidationConfig {
  inputSchema: InputSchema;
  outputConfig: OutputConfig;
}

/**
 * Validate complete invoke request
 */
export function validateRequest(
  request: RequestValidationInput,
  config: RequestValidationConfig
): ValidationResult {
  const allErrors: ValidationError[] = [];

  // Validate input parameters
  const inputResult = validateInput(request.input, config.inputSchema);
  if (!inputResult.valid) {
    allErrors.push(...inputResult.errors);
  }

  // Validate files if provided
  if (request.files && request.files.length > 0) {
    const fileResult = validateFiles(request.files, config.inputSchema.files);
    if (!fileResult.valid) {
      allErrors.push(...fileResult.errors);
    }
  } else if (config.inputSchema.files.required) {
    allErrors.push({
      field: 'files',
      message: 'At least one file is required',
    });
  }

  // Validate output type
  const outputResult = validateOutputType(request.outputType, config.outputConfig);
  if (!outputResult.valid) {
    allErrors.push(...outputResult.errors);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * Format validation errors as a single string
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => (e.field ? `${e.field}: ${e.message}` : e.message))
    .join('; ');
}

/**
 * XLSX Generation Tool
 *
 * Generates Excel spreadsheets (.xlsx) with data, formulas, and formatting.
 * Uses ExcelJS library for spreadsheet generation.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition, ValidationResult } from '../tools';
import type { XlsxGenToolArgs, XlsxGenConfig, XlsxGenResponse } from '@/types/xlsx-gen';
import { getRequestContext } from '../request-context';
import { getToolConfig } from '../db/compat/tool-config';
import { generateXlsx } from '../xlsxgen/xlsx-builder';
import { getOutputDirectory, generateDocumentFilename } from '../docgen/branding';
import { addThreadOutput, addWorkspaceOutput, getThreadContext } from '../db/compat/threads';
import { checkPayloadSize, checkMemoryForXlsx } from '../memory-utils';

// ============ Constants ============

/** Maximum rows per sheet */
const MAX_ROWS = 1000;

/** Maximum columns per sheet */
const MAX_COLUMNS = 25;

/** Maximum payload size in MB */
const MAX_PAYLOAD_MB = 5;

// ============ Default Configuration ============

export const XLSX_GEN_DEFAULTS: XlsxGenConfig = {
  maxSheets: 10,
  maxRowsPerSheet: MAX_ROWS,
  maxColumnsPerSheet: MAX_COLUMNS,
  defaultHeaderStyle: 'highlighted',
  branding: {
    enabled: false,
    organizationName: '',
    primaryColor: '#1E3A5F',
  },
};

// ============ Config Schema ============

const xlsxGenConfigSchema = {
  type: 'object',
  properties: {
    maxSheets: {
      type: 'number',
      title: 'Max Sheets',
      description: 'Maximum sheets per workbook',
      minimum: 1,
      maximum: 20,
      default: 10,
    },
    maxRowsPerSheet: {
      type: 'number',
      title: 'Max Rows Per Sheet',
      description: 'Maximum rows per sheet',
      minimum: 100,
      maximum: 1000,
      default: 1000,
    },
    maxColumnsPerSheet: {
      type: 'number',
      title: 'Max Columns Per Sheet',
      description: 'Maximum columns per sheet',
      minimum: 5,
      maximum: 25,
      default: 25,
    },
    defaultHeaderStyle: {
      type: 'string',
      title: 'Default Header Style',
      enum: ['bold', 'highlighted', 'bordered'],
      default: 'highlighted',
    },
    branding: {
      type: 'object',
      title: 'Branding',
      properties: {
        enabled: { type: 'boolean', default: false },
        organizationName: { type: 'string', default: '' },
        primaryColor: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$', default: '#1E3A5F' },
      },
    },
  },
};

// ============ Validation ============

function validateXlsxGenConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (config.maxSheets !== undefined) {
    const max = config.maxSheets as number;
    if (typeof max !== 'number' || max < 1 || max > 20) {
      errors.push('maxSheets must be between 1 and 20');
    }
  }

  if (config.maxRowsPerSheet !== undefined) {
    const max = config.maxRowsPerSheet as number;
    if (typeof max !== 'number' || max < 100 || max > MAX_ROWS) {
      errors.push(`maxRowsPerSheet must be between 100 and ${MAX_ROWS}`);
    }
  }

  if (config.maxColumnsPerSheet !== undefined) {
    const max = config.maxColumnsPerSheet as number;
    if (typeof max !== 'number' || max < 5 || max > MAX_COLUMNS) {
      errors.push(`maxColumnsPerSheet must be between 5 and ${MAX_COLUMNS}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============ Helper Functions ============

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ============ Tool Definition ============

export const xlsxGenTool: ToolDefinition = {
  name: 'xlsx_gen',
  displayName: 'Spreadsheet Generator',
  description: 'Generate Excel spreadsheets (.xlsx) with data, formulas, and formatting',
  category: 'autonomous',

  definition: {
    type: 'function' as const,
    function: {
      name: 'xlsx_gen',
      description: `Generate an Excel spreadsheet (.xlsx) with data, formulas, and formatting.

LIMITS - DO NOT EXCEED:
- Maximum 1,000 rows total across all sheets
- Maximum 25 columns per sheet

If user requests exceed limits, inform them and offer alternatives.

Use when the user asks to:
- Create a spreadsheet or Excel file
- Build a budget, tracker, or data table
- Export data to Excel format
- Create a financial model or projection

IMPORTANT: Use Excel formulas (e.g., "=SUM(A2:A10)") for calculations, not hardcoded values.
The generated file will be available for download.`,
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Output filename (without .xlsx extension)',
          },
          sheets: {
            type: 'array',
            description: 'Array of sheet definitions',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Sheet name (max 31 chars)',
                },
                headers: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Column headers',
                },
                rows: {
                  type: 'array',
                  description: 'Data rows (array of arrays)',
                  items: {
                    type: 'array',
                    items: {
                      oneOf: [
                        { type: 'string' },
                        { type: 'number' },
                        { type: 'boolean' },
                        { type: 'null' },
                      ],
                    },
                  },
                },
                formulas: {
                  type: 'array',
                  description: 'Formulas to add [{cell: "D2", formula: "=SUM(A2:C2)"}]',
                  items: {
                    type: 'object',
                    properties: {
                      cell: { type: 'string' },
                      formula: { type: 'string' },
                    },
                    required: ['cell', 'formula'],
                  },
                },
                columnWidths: {
                  type: 'object',
                  description: 'Column widths by letter, e.g., {"A": 20, "B": 15}',
                },
              },
              required: ['name', 'headers', 'rows'],
            },
          },
        },
        required: ['filename', 'sheets'],
      },
    },
  },

  validateConfig: validateXlsxGenConfig,
  defaultConfig: XLSX_GEN_DEFAULTS as unknown as Record<string, unknown>,
  configSchema: xlsxGenConfigSchema,

  execute: async (args: XlsxGenToolArgs): Promise<string> => {
    try {
      // Get context from AsyncLocalStorage
      const context = getRequestContext();
      const { threadId } = context;

      // Validate we have required context
      if (!threadId) {
        console.warn('[XlsxGen] No thread context available');
        return JSON.stringify({
          success: false,
          error: 'Spreadsheet generation requires an active chat thread',
          errorCode: 'NO_CONTEXT',
        } as XlsxGenResponse);
      }

      // Step 0: Payload size check (first!)
      const payloadCheck = checkPayloadSize(args, MAX_PAYLOAD_MB);
      if (!payloadCheck.pass) {
        return JSON.stringify({
          success: false,
          error: payloadCheck.reason,
          errorCode: 'PAYLOAD_TOO_LARGE',
        } as XlsxGenResponse);
      }

      // Step 1: Validate inputs
      if (!args.sheets || args.sheets.length === 0) {
        return JSON.stringify({
          success: false,
          error: 'At least one sheet is required',
          errorCode: 'INVALID_INPUT',
        } as XlsxGenResponse);
      }

      // Calculate totals for validation
      const totalRows = args.sheets.reduce((sum, s) => sum + s.rows.length, 0);
      const maxCols = Math.max(...args.sheets.map((s) => s.headers.length));

      // Validate row limit
      if (totalRows > MAX_ROWS) {
        return JSON.stringify({
          success: false,
          error: `Row limit exceeded: ${totalRows} rows provided, maximum is ${MAX_ROWS}`,
          errorCode: 'LIMIT_EXCEEDED',
          suggestion: `Reduce the number of rows to ${MAX_ROWS} or fewer`,
        } as XlsxGenResponse);
      }

      // Validate column limit
      if (maxCols > MAX_COLUMNS) {
        return JSON.stringify({
          success: false,
          error: `Column limit exceeded: ${maxCols} columns, maximum is ${MAX_COLUMNS}`,
          errorCode: 'LIMIT_EXCEEDED',
          suggestion: `Reduce the number of columns to ${MAX_COLUMNS} or fewer`,
        } as XlsxGenResponse);
      }

      // Step 2: Check memory
      const memCheck = checkMemoryForXlsx(args.sheets);
      if (!memCheck.canProceed) {
        console.warn('[XlsxGen] Memory check failed:', memCheck.reason);
        return JSON.stringify({
          success: false,
          error: memCheck.reason,
          errorCode: 'MEMORY_LIMIT',
        } as XlsxGenResponse);
      }

      // Get tool configuration
      const toolConfig = await getToolConfig('xlsx_gen');
      const config = (toolConfig?.config as Partial<XlsxGenConfig>) || {};
      const organizationName = config.branding?.organizationName || '';

      // Check if tool is enabled
      if (toolConfig && !toolConfig.isEnabled) {
        return JSON.stringify({
          success: false,
          error: 'Spreadsheet generation is currently disabled',
          errorCode: 'TOOL_DISABLED',
        } as XlsxGenResponse);
      }

      // Step 3: Generate spreadsheet
      console.log(`[XlsxGen] Generating spreadsheet: "${args.filename}" with ${args.sheets.length} sheet(s)`);

      const result = await generateXlsx({
        filename: args.filename,
        sheets: args.sheets,
        organizationName,
      });

      // Step 4: Save file
      const outputDir = getOutputDirectory();
      const filename = generateDocumentFilename(args.filename, 'xlsx', threadId);
      const filepath = path.join(outputDir, filename);

      fs.writeFileSync(filepath, result.buffer);

      // Step 5: Determine context and save to database
      const threadContext = await getThreadContext(threadId);

      if (!threadContext.exists) {
        console.error('[XlsxGen] Thread not found in database:', threadId);
        // File is saved, but we can't track it in DB
        return JSON.stringify({
          success: true,
          document: {
            filename,
            fileSize: result.fileSize,
            sheetCount: result.sheetCount,
            downloadUrl: '', // Can't provide without DB entry
          },
        } as XlsxGenResponse);
      }

      let docId: number;
      let downloadUrlPrefix: string;

      if (threadContext.isWorkspace) {
        // Workspace context
        const wsResult = await addWorkspaceOutput(
          threadContext.workspaceId!,
          threadContext.sessionId!,
          threadContext.actualThreadId ?? null,
          filename,
          filepath,
          'xlsx',
          result.fileSize
        );
        docId = wsResult.id;
        downloadUrlPrefix = '/api/workspace-documents';
      } else {
        // Main chat context
        const outputResult = await addThreadOutput(
          threadId,
          null, // messageId not available yet
          filename,
          filepath,
          'xlsx',
          result.fileSize
        );
        docId = outputResult.id;
        downloadUrlPrefix = '/api/documents';
      }

      console.log(`[XlsxGen] Spreadsheet generated: ${filename} (${formatFileSize(result.fileSize)})`);

      return JSON.stringify({
        success: true,
        document: {
          filename,
          fileSize: result.fileSize,
          sheetCount: result.sheetCount,
          downloadUrl: `${downloadUrlPrefix}/${docId}/download`,
        },
      } as XlsxGenResponse);
    } catch (error) {
      console.error('[XlsxGen] Generation error:', error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during spreadsheet generation',
        errorCode: 'GENERATION_ERROR',
      } as XlsxGenResponse);
    }
  },
};

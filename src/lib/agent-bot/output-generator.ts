/**
 * Agent Bot Output Generator
 *
 * Generates outputs in various formats for agent bot jobs:
 * - PDF, DOCX, MD documents
 * - XLSX spreadsheets
 * - Stores files and returns metadata
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { generatePdf } from '@/lib/docgen/pdf-builder';
import { generateDocx } from '@/lib/docgen/docx-builder';
import { generateMd } from '@/lib/docgen/md-builder';
import { generateXlsx } from '@/lib/xlsxgen/xlsx-builder';
import type { SheetDefinition } from '@/types/xlsx-gen';
import {
  getOutputDirectory,
  type BrandingConfig,
  DEFAULT_BRANDING,
  mergeBrandingConfigs,
} from '@/lib/docgen/branding';
import type {
  OutputType,
  DocumentBrandingConfig,
  AgentBotVersionWithRelations,
} from '@/types/agent-bot';

// ============================================================================
// Types
// ============================================================================

export interface GeneratedOutput {
  type: OutputType;
  content?: string;
  filename?: string;
  filepath?: string;
  fileSize?: number;
  mimeType: string;
}

export interface DocumentOutputOptions {
  title: string;
  content: string;
  format: 'pdf' | 'docx' | 'md';
  branding?: Partial<BrandingConfig>;
  jobId: string;
}

export interface SpreadsheetOutputOptions {
  title: string;
  sheets: SheetDefinition[];
  jobId: string;
}

export interface JsonOutputOptions {
  data: Record<string, unknown>;
}

// ============================================================================
// Output Directory
// ============================================================================

/**
 * Get output directory for agent bot jobs
 */
function getAgentBotOutputDirectory(): string {
  const baseDir = getOutputDirectory();
  const agentBotDir = path.join(baseDir, 'agent-bots');
  if (!fs.existsSync(agentBotDir)) {
    fs.mkdirSync(agentBotDir, { recursive: true });
  }
  return agentBotDir;
}

/**
 * Generate a unique filename for agent bot output
 */
function generateFilename(baseName: string, format: string, jobId: string): string {
  const timestamp = Date.now();
  const sanitized = baseName
    .replace(/[^a-z0-9]/gi, '_')
    .substring(0, 50)
    .toLowerCase();
  const prefix = jobId.substring(0, 8);
  return `${prefix}_${sanitized}_${timestamp}.${format}`;
}

// ============================================================================
// Branding Conversion
// ============================================================================

/**
 * Convert DocumentBrandingConfig to BrandingConfig
 */
function convertBranding(config?: DocumentBrandingConfig): Partial<BrandingConfig> | undefined {
  if (!config || !config.enabled) {
    return undefined;
  }

  return {
    enabled: true,
    logoUrl: config.logoUrl || '',
    organizationName: config.organizationName || '',
    primaryColor: config.primaryColor || '#003366',
  };
}

// ============================================================================
// Document Generation
// ============================================================================

/**
 * Generate a document (PDF, DOCX, or MD)
 */
export async function generateDocument(options: DocumentOutputOptions): Promise<GeneratedOutput> {
  const { title, content, format, branding, jobId } = options;

  // Get output directory
  const outputDir = getAgentBotOutputDirectory();

  // Generate filename
  const filename = generateFilename(title || 'document', format, jobId);
  const filepath = path.join(outputDir, filename);

  // Resolve branding
  const resolvedBranding = mergeBrandingConfigs(
    DEFAULT_BRANDING,
    branding || null
  );

  // Generate the document
  let fileBuffer: Buffer;

  const docOptions = {
    title,
    content,
    branding: resolvedBranding,
  };

  switch (format) {
    case 'pdf': {
      const result = await generatePdf(docOptions);
      fileBuffer = result.buffer;
      break;
    }

    case 'docx': {
      const result = await generateDocx(docOptions);
      fileBuffer = result.buffer;
      break;
    }

    case 'md': {
      const result = await generateMd(docOptions);
      fileBuffer = result.buffer;
      break;
    }

    default:
      throw new Error(`Unsupported document format: ${format}`);
  }

  // Write file
  fs.writeFileSync(filepath, fileBuffer);

  const fileSize = fs.statSync(filepath).size;

  return {
    type: format as OutputType,
    filename,
    filepath,
    fileSize,
    mimeType: getMimeType(format),
  };
}

/**
 * Generate a spreadsheet (XLSX)
 */
export async function generateSpreadsheet(options: SpreadsheetOutputOptions): Promise<GeneratedOutput> {
  const { title, sheets, jobId } = options;

  // Get output directory
  const outputDir = getAgentBotOutputDirectory();

  // Generate filename
  const filename = generateFilename(title || 'spreadsheet', 'xlsx', jobId);
  const filepath = path.join(outputDir, filename);

  // Generate the spreadsheet
  const result = await generateXlsx({
    filename,
    sheets,
  });

  // Write file
  fs.writeFileSync(filepath, result.buffer);

  return {
    type: 'xlsx',
    filename,
    filepath,
    fileSize: result.fileSize,
    mimeType: getMimeType('xlsx'),
  };
}

// ============================================================================
// Text/JSON Output
// ============================================================================

/**
 * Generate text output (no file, just content)
 */
export function generateTextOutput(content: string): GeneratedOutput {
  return {
    type: 'text',
    content,
    mimeType: 'text/plain',
  };
}

/**
 * Generate JSON output (no file, just content)
 */
export function generateJsonOutput(data: Record<string, unknown>): GeneratedOutput {
  return {
    type: 'json',
    content: JSON.stringify(data, null, 2),
    mimeType: 'application/json',
  };
}

/**
 * Generate markdown output (no file, just content)
 */
export function generateMarkdownOutput(content: string): GeneratedOutput {
  return {
    type: 'md',
    content,
    mimeType: 'text/markdown',
  };
}

// ============================================================================
// Main Output Generator
// ============================================================================

export interface GenerateOutputParams {
  outputType: OutputType;
  content: string;
  jobId: string;
  version: AgentBotVersionWithRelations;
  title?: string;
}

/**
 * Generate output based on type
 * Routes to appropriate generator based on output type
 */
export async function generateOutput(params: GenerateOutputParams): Promise<GeneratedOutput> {
  const { outputType, content, jobId, version, title } = params;

  // Get branding config from version
  const branding = convertBranding(version.output_config.documentBranding);

  switch (outputType) {
    case 'text':
      return generateTextOutput(content);

    case 'json':
      // Try to parse JSON from content
      try {
        const parsed = JSON.parse(content);
        const data = Array.isArray(parsed) ? { data: parsed } : parsed;
        return generateJsonOutput(data);
      } catch {
        // Try to extract from markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1].trim());
            const data = Array.isArray(parsed) ? { data: parsed } : parsed;
            return generateJsonOutput(data);
          } catch {
            return generateJsonOutput({ response: content });
          }
        }
        return generateJsonOutput({ response: content });
      }

    case 'md':
      return generateMarkdownOutput(content);

    case 'pdf':
      return generateDocument({
        title: title || 'Document',
        content,
        format: 'pdf',
        branding,
        jobId,
      });

    case 'docx':
      return generateDocument({
        title: title || 'Document',
        content,
        format: 'docx',
        branding,
        jobId,
      });

    case 'xlsx':
      // For XLSX, we need structured data
      // Try to extract table data from content
      const tableData = extractTableData(content);
      if (tableData) {
        return generateSpreadsheet({
          title: title || 'Spreadsheet',
          sheets: [tableData],
          jobId,
        });
      }
      // Fallback: create a simple sheet with the content
      return generateSpreadsheet({
        title: title || 'Spreadsheet',
        sheets: [{
          name: 'Data',
          headers: ['Content'],
          rows: [[content]],
        }],
        jobId,
      });

    case 'pptx':
    case 'image':
    case 'podcast':
      // These require more complex processing
      // For now, return the content as text with a note
      return {
        type: outputType,
        content: `Output type '${outputType}' generation not yet implemented. Raw content:\n\n${content}`,
        mimeType: getMimeType(outputType),
      };

    default:
      return generateTextOutput(content);
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get MIME type for output type
 */
function getMimeType(outputType: string): string {
  const mimeTypes: Record<string, string> = {
    text: 'text/plain',
    json: 'application/json',
    md: 'text/markdown',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    image: 'image/png',
    podcast: 'audio/mpeg',
  };
  return mimeTypes[outputType] || 'application/octet-stream';
}

/**
 * Extract table data from content (for XLSX generation)
 * Tries to find structured data in JSON or markdown table format
 */
function extractTableData(content: string): SheetDefinition | null {
  // Try JSON array first
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const firstItem = parsed[0];
      if (typeof firstItem === 'object' && firstItem !== null) {
        const headers = Object.keys(firstItem);
        const rows = parsed.map(item =>
          headers.map(h => String(item[h] ?? ''))
        );
        return { name: 'Data', headers, rows };
      }
    }
  } catch {
    // Not JSON, try other formats
  }

  // Try to extract JSON from code blocks
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (Array.isArray(parsed) && parsed.length > 0) {
        const firstItem = parsed[0];
        if (typeof firstItem === 'object' && firstItem !== null) {
          const headers = Object.keys(firstItem);
          const rows = parsed.map(item =>
            headers.map(h => String(item[h] ?? ''))
          );
          return { name: 'Data', headers, rows };
        }
      }
    } catch {
      // Not valid JSON
    }
  }

  // Try markdown table format
  const tableMatch = content.match(/\|(.+)\|\n\|[-\s|]+\|\n((?:\|.+\|\n?)+)/);
  if (tableMatch) {
    const headerLine = tableMatch[1];
    const rowsText = tableMatch[2];

    const headers = headerLine.split('|').map(h => h.trim()).filter(Boolean);
    const rows = rowsText
      .trim()
      .split('\n')
      .map(line =>
        line.split('|').map(cell => cell.trim()).filter(Boolean)
      );

    if (headers.length > 0 && rows.length > 0) {
      return { name: 'Data', headers, rows };
    }
  }

  return null;
}

/**
 * Clean up old output files
 */
export function cleanupOldOutputs(maxAgeDays: number = 7): number {
  const outputDir = getAgentBotOutputDirectory();
  const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

  let deletedCount = 0;

  try {
    const files = fs.readdirSync(outputDir);
    for (const file of files) {
      const filepath = path.join(outputDir, file);
      const stats = fs.statSync(filepath);

      if (stats.mtimeMs < cutoffTime) {
        fs.unlinkSync(filepath);
        deletedCount++;
      }
    }
  } catch (error) {
    console.error('[OutputGenerator] Cleanup error:', error);
  }

  return deletedCount;
}

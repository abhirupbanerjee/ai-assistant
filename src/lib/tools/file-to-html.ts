/**
 * File to HTML Converter Tool
 *
 * Converts uploaded DOCX/PDF documents to self-contained HTML pages
 * with TOC sidebar, search, and branding — using mammoth for DOCX
 * and the existing extraction pipeline for PDF.
 */

import * as fs from 'fs';
import * as path from 'path';
import mammoth from 'mammoth';
import type { ToolDefinition, ValidationResult } from '@/lib/tools';
import { getToolConfig, TOOL_DEFAULTS } from '@/lib/db/compat/tool-config';
import { getEffectiveToolConfig, type BrandingConfig } from '@/lib/db/compat/category-tool-config';
import { getThreadUploads } from '@/lib/db/compat/threads';
import { addThreadOutput } from '@/lib/db/compat/threads';
import { getRequestContext } from '@/lib/request-context';
import { generateHtmlFromSource } from '../docgen/html-builder';
import { extractText, isDocx, isPDF } from '../document-extractor';
import { generateDocumentFilename } from '../docgen/branding';
import { getOutputDirectory } from '../docgen/branding';

export const FILE_TO_HTML_FUNCTION_DESCRIPTION =
  'Convert an uploaded DOCX or PDF document to a self-contained HTML page. The HTML page includes a table of contents sidebar, search functionality, and organization branding. Supports documentation, playbook, and roadmap layouts. Works best with DOCX files which retain all images as embedded base64 data URIs. Call this tool when the user explicitly asks to convert a document to HTML, export as HTML page, or create an HTML version of a document.';


// ============ Config Schema ============

const fileToHtmlConfigSchema = {
  type: 'object' as const,
  properties: {
    enabled: {
      type: 'boolean' as const,
      title: 'Enable File to HTML Conversion',
      description: 'Allow converting uploaded documents to HTML pages',
      default: true,
    },
    branding: {
      type: 'object' as const,
      title: 'Branding Settings',
      description: 'Document branding configuration',
      properties: {
        enabled: {
          type: 'boolean' as const,
          title: 'Enable Branding',
          description: 'Add organization branding to HTML pages',
          default: false,
        },
        logoUrl: {
          type: 'string' as const,
          title: 'Logo URL',
          description: 'URL or data URL of organization logo',
          default: '',
        },
        organizationName: {
          type: 'string' as const,
          title: 'Organization Name',
          description: 'Name displayed in page header',
          default: '',
        },
        primaryColor: {
          type: 'string' as const,
          title: 'Primary Color',
          description: 'Primary color for headings and accents (hex)',
          pattern: '^#[0-9A-Fa-f]{6}$',
          default: '#003366',
        },
        fontFamily: {
          type: 'string' as const,
          title: 'Font Family',
          description: 'Primary font for page text',
          default: 'Segoe UI, Arial, sans-serif',
        },
      },
    },
    expirationDays: {
      type: 'number' as const,
      title: 'Document Expiration (days)',
      description: 'Days until converted HTML pages expire (0 = never)',
      minimum: 0,
      maximum: 365,
      default: 30,
    },
  },
};

// ============ Validation ============

function validateConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (config.branding) {
    const branding = config.branding as Record<string, unknown>;
    if (branding.primaryColor && !/^#[0-9A-Fa-f]{6}$/.test(branding.primaryColor as string)) {
      errors.push('branding.primaryColor must be a valid hex color (e.g., #003366)');
    }
  }

  if (config.expirationDays !== undefined) {
    const days = config.expirationDays as number;
    if (typeof days !== 'number' || days < 0 || days > 365) {
      errors.push('expirationDays must be a number between 0 and 365');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============ Tool Definition ============

export const fileToHtmlTool: ToolDefinition = {
  name: 'file_to_html',
  displayName: 'File to HTML',
  description: 'Convert an uploaded DOCX or PDF document to a self-contained HTML page with TOC sidebar, search, and branding',
  category: 'autonomous',

  definition: {
    type: 'function' as const,
    function: {
      name: 'file_to_html',
      description: FILE_TO_HTML_FUNCTION_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description:
              'The filename of the uploaded document to convert (e.g., "policy-document.docx"). If not provided, the most recent DOCX or PDF upload in the conversation will be used.',
          },
          title: {
            type: 'string',
            description:
              'Title for the HTML page. Defaults to the uploaded filename if not provided.',
          },
          page_type: {
            type: 'string',
            enum: ['documentation', 'playbook', 'roadmap', 'gantt', 'project_plan', 'dashboard'],
            description: 'Output layout type. documentation = TOC/sidebar page. playbook = card-based interactive playbook layout derived from document headings. roadmap = timeline-based roadmap page with phase cards and milestone markers. gantt = Gantt chart (requires a ```gantt JSON block in the document). project_plan = project plan with KPI strip and work-stream roll-up (requires a ```gantt JSON block). dashboard = analytical dashboard (requires ```chart/kpi/filters/data blocks).',
          },
        },
        required: [],
      },
    },
  },

  validateConfig,

  defaultConfig: TOOL_DEFAULTS.file_to_html?.config || {
    enabled: true,
    branding: {
      enabled: false,
      logoUrl: '',
      organizationName: '',
      primaryColor: '#003366',
      fontFamily: 'Segoe UI, Arial, sans-serif',
    },
    expirationDays: 30,
  },

  configSchema: fileToHtmlConfigSchema,

  execute: async (args: {
    filename?: string;
    title?: string;
    page_type?: 'documentation' | 'playbook' | 'roadmap' | 'gantt' | 'project_plan' | 'dashboard';
  }): Promise<string> => {
    try {
      // Get context from AsyncLocalStorage
      const context = getRequestContext();
      const { threadId, categoryIds } = context;
      const categoryId = categoryIds?.[0];

      if (!threadId) {
        return JSON.stringify({
          error: 'Document conversion requires an active chat thread',
          errorCode: 'NO_CONTEXT',
        });
      }

      // Get tool configuration
      const toolConfig = await getToolConfig('file_to_html');
      const config = (toolConfig?.config || TOOL_DEFAULTS.file_to_html?.config || {}) as Record<string, unknown>;

      if (!toolConfig?.isEnabled && !(TOOL_DEFAULTS.file_to_html?.enabled ?? true)) {
        return JSON.stringify({
          error: 'File to HTML conversion is currently disabled',
          errorCode: 'TOOL_DISABLED',
        });
      }

      const branding = config.branding as BrandingConfig || {
        enabled: false,
        logoUrl: '',
        organizationName: '',
        primaryColor: '#003366',
        fontFamily: 'Segoe UI, Arial, sans-serif',
      };
      const expirationDays = (config.expirationDays as number) || 30;

      // Get category branding if applicable
      if (categoryId) {
        const effective = await getEffectiveToolConfig('file_to_html', categoryId);
        if (effective.branding) {
          branding.enabled = effective.branding.enabled ?? branding.enabled;
          branding.logoUrl = effective.branding.logoUrl ?? branding.logoUrl;
          branding.organizationName = effective.branding.organizationName ?? branding.organizationName;
          branding.primaryColor = effective.branding.primaryColor ?? branding.primaryColor;
          branding.fontFamily = effective.branding.fontFamily ?? branding.fontFamily;
        }
      }

      // Get uploads for this thread
      const uploads = await getThreadUploads(threadId);
      const documents = uploads.filter(u => {
        const ext = u.filename.toLowerCase().split('.').pop();
        return ext === 'docx' || ext === 'pdf';
      });

      if (documents.length === 0) {
        return JSON.stringify({
          error: 'No DOCX or PDF document found in this conversation. Please upload a document first.',
          errorCode: 'NO_DOCUMENT',
          hint: 'Upload a .docx or .pdf file to the chat, then ask to convert it to HTML.',
        });
      }

      // Find the target file
      let targetUpload;
      if (args.filename) {
        targetUpload = documents.find(u =>
          u.filename.toLowerCase() === args.filename!.toLowerCase() ||
          u.filename.toLowerCase() === args.filename!.toLowerCase().replace(/\s+/g, '_')
        );
        if (!targetUpload) {
          const available = documents.map(u => u.filename).join(', ');
          return JSON.stringify({
            error: `File "${args.filename}" not found. Available documents: ${available}`,
            errorCode: 'FILE_NOT_FOUND',
          });
        }
      } else {
        // Use most recent document, preferring DOCX over PDF
        const docxFiles = documents.filter(u => u.filename.toLowerCase().endsWith('.docx'));
        const pdfFiles = documents.filter(u => u.filename.toLowerCase().endsWith('.pdf'));
        targetUpload = docxFiles.length > 0 ? docxFiles[docxFiles.length - 1] : documents[documents.length - 1];
      }

      const sourceFilename = targetUpload.filename;
      const filePath = targetUpload.filepath;
      const isDocxFile = sourceFilename.toLowerCase().endsWith('.docx');

      console.log(`[FileToHtml] Converting: ${sourceFilename} (${filePath})`);

      // Read file buffer
      if (!fs.existsSync(filePath)) {
        return JSON.stringify({
          error: `File not found on server: ${sourceFilename}`,
          errorCode: 'FILE_MISSING',
        });
      }

      const buffer = fs.readFileSync(filePath);
      let sourceHtml: string;

      if (isDocxFile) {
        // DOCX: use mammoth.convertToHtml for full fidelity with embedded images
        const mammothResult = await mammoth.convertToHtml({ buffer });
        sourceHtml = mammothResult.value;
        console.log(`[FileToHtml] mammoth converted ${sourceFilename} (${sourceHtml.length} chars HTML)`);
      } else {
        // PDF: extract text (images not yet supported for PDF)
        const result = await extractText(buffer, 'application/pdf', sourceFilename);
        sourceHtml = `<div class="pdf-content">\n<p>${escapeHtml(result.text).replace(/\n\n+/g, '</p>\n<p>')}</p>\n</div>`;
        console.log(`[FileToHtml] Extracted ${result.text.length} chars from PDF`);
      }

      // Determine page title
      const pageTitle = args.title || sourceFilename.replace(/\.[^/.]+$/, '');

      // Generate the HTML page — playbook or documentation layout
      const htmlResult = await generateHtmlFromSource({
        title: pageTitle,
        sourceHtml,
        branding,
        metadata: {
          date: new Date().toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
          }),
        },
        pageType: args.page_type,
      });

      // Save to disk
      const outputDir = getOutputDirectory();
      const outputFilename = generateDocumentFilename(pageTitle, 'html', threadId);
      const outputPath = path.join(outputDir, outputFilename);
      fs.writeFileSync(outputPath, htmlResult.buffer);

      // Calculate expiration
      const expiresAt = expirationDays > 0
        ? new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

      // Store in database
      const outputResult = await addThreadOutput(
        threadId,
        null,
        outputFilename,
        outputPath,
        'html',
        htmlResult.buffer.length,
        JSON.stringify({
          title: pageTitle,
          sourceFilename,
          sourceFormat: isDocxFile ? 'docx' : 'pdf',
          tocCount: htmlResult.tocCount,
          pageType: args.page_type || 'documentation',
          branding: branding.enabled ? {
            organizationName: branding.organizationName,
            primaryColor: branding.primaryColor,
          } : null,
        }),
        expiresAt
      );

      console.log(`[FileToHtml] HTML page generated: ${outputFilename} (${htmlResult.fileSize} bytes, ${htmlResult.tocCount} TOC entries)`);

      return JSON.stringify({
        success: true,
        message: `Converted "${sourceFilename}" to HTML page with ${htmlResult.tocCount} sections. Do NOT call file_to_html again unless the user explicitly asks for another conversion.`,
        document: {
          id: outputResult.id,
          filename: outputFilename,
          fileType: 'html',
          fileSize: htmlResult.fileSize,
          fileSizeFormatted: formatFileSize(htmlResult.fileSize),
          downloadUrl: `/api/documents/${outputResult.id}/download`,
          sourceFormat: isDocxFile ? 'DOCX' : 'PDF',
          tocCount: htmlResult.tocCount,
          pageType: args.page_type || 'documentation',
          hasImages: isDocxFile, // mammoth embeds images, PDF extraction doesn't (yet)
        },
      });
    } catch (error) {
      console.error('[FileToHtml] Conversion error:', error);
      return JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error during document conversion',
        errorCode: 'CONVERSION_ERROR',
      });
    }
  },
};

// ============ Helper Functions ============

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '\x26amp;')
    .replace(/</g, '\x26lt;')
    .replace(/>/g, '\x26gt;')
    .replace(/"/g, '\x26quot;')
    .replace(/'/g, '\x26#39;');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ============ Export Types ============

export type { BrandingConfig };

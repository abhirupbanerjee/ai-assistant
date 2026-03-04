/**
 * Document Generation Tool Definition
 *
 * Autonomous tool for generating branded PDF and Word documents
 * from chat content. LLM-triggered via OpenAI function calling
 * when users request document exports.
 */

import type { ToolDefinition, ValidationResult } from '../tools';
import { getToolConfig, TOOL_DEFAULTS } from '../db/compat/tool-config';
import { getEffectiveToolConfig, type BrandingConfig } from '../db/compat/category-tool-config';
import {
  createDocumentGenerator,
  type DocumentFormat,
  type GeneratedDocument,
  type DocGenConfig,
} from '../docgen/document-generator';
import { getRequestContext } from '../request-context';

// ============ Config Schema ============

const docGenConfigSchema = {
  type: 'object',
  properties: {
    defaultFormat: {
      type: 'string',
      title: 'Default Format',
      description: 'Default document format when not specified',
      enum: ['pdf', 'docx', 'md'],
      default: 'pdf',
    },
    enabledFormats: {
      type: 'array',
      title: 'Enabled Formats',
      description: 'Document formats available for export',
      items: {
        type: 'string',
        enum: ['pdf', 'docx', 'md'],
      },
      default: ['pdf', 'docx', 'md'],
    },
    branding: {
      type: 'object',
      title: 'Branding Settings',
      description: 'Document branding configuration',
      properties: {
        enabled: {
          type: 'boolean',
          title: 'Enable Branding',
          description: 'Add organization branding to documents',
          default: false,
        },
        logoUrl: {
          type: 'string',
          title: 'Logo URL',
          description: 'URL or data URL of organization logo',
          default: '',
        },
        organizationName: {
          type: 'string',
          title: 'Organization Name',
          description: 'Name displayed in document header',
          default: '',
        },
        primaryColor: {
          type: 'string',
          title: 'Primary Color',
          description: 'Primary color for headings and accents (hex)',
          pattern: '^#[0-9A-Fa-f]{6}$',
          default: '#003366',
        },
        fontFamily: {
          type: 'string',
          title: 'Font Family',
          description: 'Primary font for document text',
          default: 'Calibri',
        },
      },
    },
    header: {
      type: 'object',
      title: 'Header Settings',
      properties: {
        enabled: {
          type: 'boolean',
          title: 'Enable Header',
          default: true,
        },
        content: {
          type: 'string',
          title: 'Header Content',
          description: 'Custom header text (supports {{date}}, {{organization}})',
          default: '',
        },
      },
    },
    footer: {
      type: 'object',
      title: 'Footer Settings',
      properties: {
        enabled: {
          type: 'boolean',
          title: 'Enable Footer',
          default: true,
        },
        content: {
          type: 'string',
          title: 'Footer Content',
          description: 'Custom footer text (supports {{date}}, {{page}}, {{total}})',
          default: '',
        },
        includePageNumber: {
          type: 'boolean',
          title: 'Include Page Number',
          default: true,
        },
      },
    },
    expirationDays: {
      type: 'number',
      title: 'Document Expiration (days)',
      description: 'Days until generated documents expire (0 = never)',
      minimum: 0,
      maximum: 365,
      default: 30,
    },
    maxDocumentSizeMB: {
      type: 'number',
      title: 'Max Document Size (MB)',
      description: 'Maximum generated document size',
      minimum: 1,
      maximum: 100,
      default: 50,
    },
  },
};

// ============ Validation ============

function validateDocGenConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // Validate defaultFormat
  if (config.defaultFormat && !['pdf', 'docx', 'md'].includes(config.defaultFormat as string)) {
    errors.push('defaultFormat must be one of: pdf, docx, md');
  }

  // Validate enabledFormats
  if (config.enabledFormats) {
    if (!Array.isArray(config.enabledFormats)) {
      errors.push('enabledFormats must be an array');
    } else {
      const validFormats = ['pdf', 'docx', 'md'];
      for (const format of config.enabledFormats) {
        if (!validFormats.includes(format as string)) {
          errors.push(`Invalid format in enabledFormats: ${format}`);
        }
      }
    }
  }

  // Validate branding
  if (config.branding) {
    const branding = config.branding as Record<string, unknown>;

    if (branding.primaryColor && !/^#[0-9A-Fa-f]{6}$/.test(branding.primaryColor as string)) {
      errors.push('branding.primaryColor must be a valid hex color (e.g., #003366)');
    }

    if (branding.logoUrl && typeof branding.logoUrl !== 'string') {
      errors.push('branding.logoUrl must be a string');
    }

    if (branding.organizationName && typeof branding.organizationName !== 'string') {
      errors.push('branding.organizationName must be a string');
    }
  }

  // Validate expirationDays
  if (config.expirationDays !== undefined) {
    const days = config.expirationDays as number;
    if (typeof days !== 'number' || days < 0 || days > 365) {
      errors.push('expirationDays must be a number between 0 and 365');
    }
  }

  // Validate maxDocumentSizeMB
  if (config.maxDocumentSizeMB !== undefined) {
    const size = config.maxDocumentSizeMB as number;
    if (typeof size !== 'number' || size < 1 || size > 100) {
      errors.push('maxDocumentSizeMB must be a number between 1 and 100');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============ Tool Definition ============

export const documentGenerationTool: ToolDefinition = {
  name: 'doc_gen',
  displayName: 'Document Generation',
  description: 'Generate branded PDF, Word, or Markdown documents from content',
  category: 'autonomous',

  // OpenAI function definition for autonomous tool calling
  definition: {
    type: 'function' as const,
    function: {
      name: 'doc_gen',
      description:
        'Generate a formatted document (PDF, Word, or Markdown) from content. Use this tool when the user explicitly asks to create, export, download, or save a document, report, summary, or policy. Do NOT use for regular responses - only when explicitly requested. The generated document will be displayed automatically in the chat with a download button - do NOT create markdown links for downloading.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Document title (appears as the main heading)',
          },
          content: {
            type: 'string',
            description:
              'Document content in markdown format. Include all relevant information the user wants in the document.',
          },
          format: {
            type: 'string',
            enum: ['pdf', 'docx', 'md'],
            description:
              'Output format: pdf (recommended for professional documents), docx (Word, for editable documents), or md (Markdown, for plain text)',
          },
        },
        required: ['title', 'content', 'format'],
      },
    },
  },

  validateConfig: validateDocGenConfig,

  defaultConfig: TOOL_DEFAULTS.doc_gen.config,

  configSchema: docGenConfigSchema,

  /**
   * Execute document generation (autonomous mode)
   *
   * Args from LLM function call:
   * - title: string - Document title
   * - content: string - Markdown content to convert
   * - format: 'pdf' | 'docx' | 'md' - Output format
   *
   * Context (threadId, messageId, categoryId) comes from request context
   */
  execute: async (args: {
    title: string;
    content: string;
    format: DocumentFormat;
  }): Promise<string> => {
    try {
      // Get context from AsyncLocalStorage (set by chat API route)
      const context = getRequestContext();
      const { threadId, categoryIds } = context;
      const categoryId = categoryIds?.[0]; // Use first category for branding/config

      // Validate we have required context
      if (!threadId) {
        console.warn('[DocGen] No thread context available');
        return JSON.stringify({
          error: 'Document generation requires an active chat thread',
          errorCode: 'NO_CONTEXT',
        });
      }

      // Fix C: Guard against oversized content (before any processing or allocation)
      const MAX_CONTENT_CHARS = 200_000; // ~50k tokens worst case
      if (args.content && args.content.length > MAX_CONTENT_CHARS) {
        console.warn(`[DocGen] Content too large: ${args.content.length} chars`);
        return JSON.stringify({
          error: `Content too large (${args.content.length} chars). Maximum is ${MAX_CONTENT_CHARS}.`,
          errorCode: 'CONTENT_TOO_LARGE',
        });
      }

      // Fix B: Detect likely LLM truncation via unclosed code fences and auto-close
      if (args.content) {
        const codeFences = (args.content.match(/^```/gm) || []).length;
        if (codeFences % 2 !== 0) {
          console.warn('[DocGen] Odd number of code fences detected — content may be truncated by LLM. Auto-closing.');
          args.content = args.content + '\n```';
        }
      }

      // Get tool configuration
      const toolConfig = await getToolConfig('doc_gen');
      const config = toolConfig?.config || TOOL_DEFAULTS.doc_gen.config;

      // Build DocGenConfig
      const docGenConfig: DocGenConfig = {
        enabled: toolConfig?.isEnabled ?? TOOL_DEFAULTS.doc_gen.enabled,
        defaultFormat: (config.defaultFormat as DocumentFormat) || 'pdf',
        enabledFormats: (config.enabledFormats as DocumentFormat[]) || ['pdf', 'docx', 'md'],
        branding: config.branding as BrandingConfig,
        expirationDays: (config.expirationDays as number) || 30,
        maxDocumentSizeMB: (config.maxDocumentSizeMB as number) || 50,
      };

      // Check if tool is enabled
      if (!docGenConfig.enabled) {
        return JSON.stringify({
          error: 'Document generation is currently disabled',
          errorCode: 'TOOL_DISABLED',
        });
      }

      // Validate format is enabled
      const format = args.format || docGenConfig.defaultFormat;
      if (!docGenConfig.enabledFormats.includes(format)) {
        return JSON.stringify({
          error: `Format '${format}' is not enabled. Available formats: ${docGenConfig.enabledFormats.join(', ')}`,
          errorCode: 'FORMAT_DISABLED',
        });
      }

      // Get category branding if applicable
      let categoryBranding: BrandingConfig | null = null;
      if (categoryId) {
        const effective = await getEffectiveToolConfig('doc_gen', categoryId);
        categoryBranding = effective.branding;
      }

      // Create generator
      const generator = createDocumentGenerator(docGenConfig, categoryBranding);

      // Generate document
      // Note: messageId is NOT passed because the assistant message hasn't been saved yet
      // (it's saved after ragQuery returns). The document is linked to the thread instead.
      console.log(`[DocGen] Generating ${format} document: "${args.title}"`);
      const result = await generator.generate({
        title: args.title,
        content: args.content,
        format,
        threadId,
        messageId: undefined, // Message not yet saved - avoid FK constraint error
        categoryId,
      });

      console.log(`[DocGen] Document generated: ${result.filename} (${formatFileSize(result.fileSize)})`);

      return JSON.stringify({
        success: true,
        message: 'Document generated successfully. Do NOT call doc_gen again unless the user explicitly requests another document.',
        document: {
          id: result.id,
          filename: result.filename,
          fileType: result.fileType,
          fileSize: result.fileSize,
          fileSizeFormatted: formatFileSize(result.fileSize),
          downloadUrl: result.downloadUrl,
          expiresAt: result.expiresAt,
        },
      });
    } catch (error) {
      console.error('[DocGen] Generation error:', error);
      return JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error during document generation',
        errorCode: 'GENERATION_ERROR',
      });
    }
  },
};

// ============ Helper Functions ============

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ============ Convenience Functions ============

/**
 * Get the document generation configuration
 */
export async function getDocGenConfig(): Promise<DocGenConfig> {
  const toolConfig = await getToolConfig('doc_gen');
  const config = toolConfig?.config || TOOL_DEFAULTS.doc_gen.config;

  return {
    enabled: toolConfig?.isEnabled ?? TOOL_DEFAULTS.doc_gen.enabled,
    defaultFormat: (config.defaultFormat as DocumentFormat) || 'pdf',
    enabledFormats: (config.enabledFormats as DocumentFormat[]) || ['pdf', 'docx'],
    branding: config.branding as BrandingConfig,
    expirationDays: (config.expirationDays as number) || 30,
    maxDocumentSizeMB: (config.maxDocumentSizeMB as number) || 50,
  };
}

/**
 * Check if document generation is enabled
 */
export async function isDocGenEnabled(): Promise<boolean> {
  const toolConfig = await getToolConfig('doc_gen');
  return toolConfig?.isEnabled ?? TOOL_DEFAULTS.doc_gen.enabled;
}

/**
 * Get enabled formats
 */
export async function getEnabledFormats(): Promise<DocumentFormat[]> {
  const config = await getDocGenConfig();
  return config.enabledFormats;
}

// ============ Export Types ============

export type { DocumentFormat, GeneratedDocument, DocGenConfig };

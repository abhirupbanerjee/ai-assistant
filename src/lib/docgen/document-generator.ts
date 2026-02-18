/**
 * Document Generator - Main orchestrator for document generation
 *
 * Coordinates PDF and Word document generation with:
 * - Branding configuration resolution
 * - Storage management
 * - Expiration handling
 */

import * as fs from 'fs';
import * as path from 'path';
import { generatePdf } from './pdf-builder';
import { generateDocx } from './docx-builder';
import { generateMd } from './md-builder';
import {
  type BrandingConfig,
  mergeBrandingConfigs,
  getOutputDirectory,
  generateDocumentFilename,
} from './branding';
import {
  type DbThreadOutput,
  getThreadContext,
  addThreadOutput,
  addWorkspaceOutput,
  getThreadOutputById,
  getThreadOutputs,
  getExpiredThreadOutputs,
  deleteThreadOutput,
  incrementThreadOutputDownloadCount,
  getThreadOutputDownloadCount,
} from '@/lib/db/compat';

// ============ Types ============

export type DocumentFormat = 'pdf' | 'docx' | 'md';

export interface GenerateDocumentOptions {
  title: string;
  content: string;
  format: DocumentFormat;
  threadId?: string;
  messageId?: string;
  categoryId?: number;
  branding?: Partial<BrandingConfig>;
  metadata?: {
    author?: string;
    subject?: string;
    keywords?: string[];
  };
}

export interface GeneratedDocument {
  id: number;
  threadId: string;
  messageId: string | null;
  filename: string;
  filepath: string;
  fileType: DocumentFormat;
  fileSize: number;
  downloadUrl: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface DocGenConfig {
  enabled: boolean;
  defaultFormat: DocumentFormat;
  enabledFormats: DocumentFormat[];
  branding: BrandingConfig;
  expirationDays: number;
  maxDocumentSizeMB: number;
}

// ============ Document Generator Class ============

export class DocumentGenerator {
  private config: DocGenConfig;
  private categoryBranding: Partial<BrandingConfig> | null;

  constructor(config: DocGenConfig, categoryBranding?: Partial<BrandingConfig> | null) {
    this.config = config;
    this.categoryBranding = categoryBranding || null;
  }

  /**
   * Generate a document
   */
  async generate(options: GenerateDocumentOptions): Promise<GeneratedDocument> {
    // Validate format
    if (!this.config.enabledFormats.includes(options.format)) {
      throw new Error(`Format '${options.format}' is not enabled. Available formats: ${this.config.enabledFormats.join(', ')}`);
    }

    // Resolve branding configuration
    const branding = mergeBrandingConfigs(
      this.config.branding,
      options.branding || this.categoryBranding
    );

    // Generate document based on format
    let buffer: Buffer;
    let pageCount: number | undefined;

    if (options.format === 'pdf') {
      const result = await generatePdf({
        title: options.title,
        content: options.content,
        branding,
        metadata: options.metadata,
      });
      buffer = result.buffer;
      pageCount = result.pageCount;
    } else if (options.format === 'docx') {
      const result = await generateDocx({
        title: options.title,
        content: options.content,
        branding,
        metadata: options.metadata,
      });
      buffer = result.buffer;
    } else {
      // Markdown format
      const result = await generateMd({
        title: options.title,
        content: options.content,
        branding,
        metadata: {
          author: options.metadata?.author,
          date: new Date().toLocaleDateString(),
        },
      });
      buffer = result.buffer;
    }

    // Check file size limit
    const fileSizeMB = buffer.length / (1024 * 1024);
    if (fileSizeMB > this.config.maxDocumentSizeMB) {
      throw new Error(
        `Generated document (${fileSizeMB.toFixed(2)} MB) exceeds maximum size limit (${this.config.maxDocumentSizeMB} MB)`
      );
    }

    // Generate filename and save to disk
    const filename = generateDocumentFilename(options.title, options.format, options.threadId);
    const outputDir = getOutputDirectory();
    const filepath = path.join(outputDir, filename);

    fs.writeFileSync(filepath, buffer);

    // Calculate expiration date
    const expiresAt = this.config.expirationDays > 0
      ? new Date(Date.now() + this.config.expirationDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // Validate threadId exists if provided (foreign key constraint)
    const effectiveThreadId = options.threadId;
    if (!effectiveThreadId) {
      console.warn('[DocGen] No threadId provided - document will not be saved to database');
      // Return early with in-memory result (no database persistence)
      return {
        id: 0, // No database ID
        threadId: undefined,
        messageId: options.messageId || null,
        filename,
        filepath,
        fileType: options.format,
        fileSize: buffer.length,
        downloadUrl: '', // Not accessible without database entry
        expiresAt: null,
        createdAt: new Date().toISOString(),
      } as unknown as GeneratedDocument;
    }

    // Check if this is a main chat thread or workspace thread/session
    const threadContext = await getThreadContext(effectiveThreadId);

    if (!threadContext.exists) {
      console.error('[DocGen] Thread not found in database:', effectiveThreadId);
      throw new Error(`Thread ${effectiveThreadId} not found - cannot save generated document`);
    }

    const generationConfig = JSON.stringify({
      title: options.title,
      branding: branding.enabled ? {
        organizationName: branding.organizationName,
        primaryColor: branding.primaryColor,
      } : null,
      pageCount,
    });

    // Store in appropriate database table based on context
    let docId: number;
    let downloadUrlPrefix: string;

    if (threadContext.isWorkspace) {
      // Workspace context - use workspace_outputs table
      const wsResult = await addWorkspaceOutput(
        threadContext.workspaceId!,
        threadContext.sessionId!,
        threadContext.actualThreadId ?? null,
        filename,
        filepath,
        options.format as 'pdf' | 'docx' | 'md',
        buffer.length,
        generationConfig,
        expiresAt
      );
      docId = wsResult.id;
      downloadUrlPrefix = '/api/workspace-documents';
    } else {
      // Main chat context - use thread_outputs table
      const outputResult = await addThreadOutput(
        effectiveThreadId,
        options.messageId || null,
        filename,
        filepath,
        options.format as 'pdf' | 'docx',
        buffer.length,
        generationConfig,
        expiresAt
      );
      docId = outputResult.id;
      downloadUrlPrefix = '/api/documents';
    }

    return {
      id: docId,
      threadId: effectiveThreadId,
      messageId: options.messageId || null,
      filename,
      filepath,
      fileType: options.format,
      fileSize: buffer.length,
      downloadUrl: `${downloadUrlPrefix}/${docId}/download`,
      expiresAt,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Get supported formats
   */
  getSupportedFormats(): DocumentFormat[] {
    return this.config.enabledFormats;
  }

  /**
   * Check if a format is enabled
   */
  isFormatEnabled(format: DocumentFormat): boolean {
    return this.config.enabledFormats.includes(format);
  }
}

// ============ Document Storage Functions ============

/**
 * Get a document by ID
 */
export async function getDocument(docId: number): Promise<GeneratedDocument | null> {
  const row = await getThreadOutputById(docId);
  if (!row) return null;
  return mapDbToDocument(row);
}

/**
 * Get documents for a thread
 */
export async function getThreadDocuments(threadId: string): Promise<GeneratedDocument[]> {
  const rows = await getThreadOutputs(threadId);
  return rows.map(mapDbToDocument);
}

/**
 * Get expired documents
 */
export async function getExpiredDocuments(): Promise<GeneratedDocument[]> {
  const rows = await getExpiredThreadOutputs();
  return rows.map(mapDbToDocument);
}

/**
 * Delete a document
 */
export async function deleteDocument(docId: number): Promise<boolean> {
  const doc = await getDocument(docId);
  if (!doc) return false;

  // Delete file from disk
  if (fs.existsSync(doc.filepath)) {
    fs.unlinkSync(doc.filepath);
  }

  // Delete from database
  await deleteThreadOutput(docId);

  return true;
}

/**
 * Clean up expired documents
 */
export async function cleanupExpiredDocuments(): Promise<number> {
  const expired = await getExpiredDocuments();
  let deleted = 0;

  for (const doc of expired) {
    if (await deleteDocument(doc.id)) {
      deleted++;
    }
  }

  return deleted;
}

/**
 * Increment download count for a document
 */
export async function incrementDownloadCount(docId: number): Promise<void> {
  await incrementThreadOutputDownloadCount(docId);
}

/**
 * Get download count for a document
 */
export async function getDownloadCount(docId: number): Promise<number> {
  return getThreadOutputDownloadCount(docId);
}

// ============ Mappers ============

function mapDbToDocument(row: DbThreadOutput): GeneratedDocument {
  return {
    id: row.id,
    threadId: row.thread_id,
    messageId: row.message_id,
    filename: row.filename,
    filepath: row.filepath,
    fileType: row.file_type as DocumentFormat,
    fileSize: row.file_size,
    downloadUrl: `/api/documents/${row.id}/download`,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at,
  };
}

// ============ Factory Function ============

/**
 * Create a document generator with config from database
 */
export function createDocumentGenerator(
  config: DocGenConfig,
  categoryBranding?: Partial<BrandingConfig> | null
): DocumentGenerator {
  return new DocumentGenerator(config, categoryBranding);
}

// ============ Export Types ============

export type { BrandingConfig } from './branding';

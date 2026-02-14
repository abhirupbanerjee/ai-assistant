/**
 * Folder Sync Utilities
 *
 * Hash calculation and change detection for folder upload re-sync
 */

import { createHash } from 'crypto';
import type { FolderSyncFile } from './db/folder-syncs';

/**
 * Calculate SHA-256 hash of file content
 */
export function calculateFileHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Determine if a file needs to be re-synced based on hash comparison
 */
export function needsResync(
  existingFile: FolderSyncFile,
  newHash: string,
  newLastModified?: number
): boolean {
  // If we have hashes, compare them (most reliable)
  if (existingFile.fileHash && newHash) {
    return existingFile.fileHash !== newHash;
  }

  // Fallback to lastModified comparison
  if (existingFile.lastModified && newLastModified) {
    return newLastModified > existingFile.lastModified;
  }

  // If no comparison data available, assume needs sync
  return true;
}

/**
 * Supported file types for folder upload
 * (same as single file upload)
 */
const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'text/plain',
  'text/markdown',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

const SUPPORTED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.txt',
  '.md',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
];

/**
 * Check if a file type is supported for upload
 */
export function isSupportedFileType(mimeType: string, filename: string): boolean {
  // Check MIME type
  if (SUPPORTED_MIME_TYPES.includes(mimeType)) {
    return true;
  }

  // Fallback to extension check (for when browser doesn't provide MIME type)
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * Filter files from a folder selection to only supported types
 */
export function filterSupportedFiles(files: File[]): {
  supported: File[];
  unsupported: { name: string; reason: string }[];
} {
  const supported: File[] = [];
  const unsupported: { name: string; reason: string }[] = [];

  for (const file of files) {
    if (isSupportedFileType(file.type, file.name)) {
      supported.push(file);
    } else {
      const ext = file.name.substring(file.name.lastIndexOf('.'));
      unsupported.push({
        name: file.name,
        reason: `Unsupported file type: ${ext || 'unknown'}`,
      });
    }
  }

  return { supported, unsupported };
}

/**
 * Extract folder name from webkitRelativePath
 */
export function extractFolderName(webkitRelativePath: string): string {
  const parts = webkitRelativePath.split('/');
  return parts[0] || 'Unknown Folder';
}

/**
 * Get relative path without the root folder name
 * e.g., "MyFolder/docs/file.pdf" -> "docs/file.pdf"
 */
export function getRelativePathWithoutRoot(webkitRelativePath: string): string {
  const parts = webkitRelativePath.split('/');
  return parts.slice(1).join('/') || parts[0];
}

/**
 * Categorize files by their sync action based on comparison with existing records
 */
export interface SyncAction {
  file: File;
  relativePath: string;
  action: 'add' | 'update' | 'skip';
  existingFileId?: number;
  existingDocumentId?: number;
}

/**
 * Determine sync actions for a set of files
 * Note: This requires file hashes which need to be calculated client-side
 * or passed with the files
 */
export function determineSyncActions(
  files: Array<{ file: File; relativePath: string; hash: string }>,
  existingFiles: FolderSyncFile[]
): SyncAction[] {
  const actions: SyncAction[] = [];
  const existingByPath = new Map(existingFiles.map(f => [f.relativePath, f]));

  for (const { file, relativePath, hash } of files) {
    const existing = existingByPath.get(relativePath);

    if (!existing) {
      // New file
      actions.push({
        file,
        relativePath,
        action: 'add',
      });
    } else if (needsResync(existing, hash, file.lastModified)) {
      // Changed file
      actions.push({
        file,
        relativePath,
        action: 'update',
        existingFileId: existing.id,
        existingDocumentId: existing.documentId ?? undefined,
      });
    } else {
      // Unchanged file
      actions.push({
        file,
        relativePath,
        action: 'skip',
        existingFileId: existing.id,
        existingDocumentId: existing.documentId ?? undefined,
      });
    }
  }

  return actions;
}

/**
 * Generate a summary of sync actions
 */
export interface SyncActionSummary {
  toAdd: number;
  toUpdate: number;
  toSkip: number;
  total: number;
}

export function summarizeSyncActions(actions: SyncAction[]): SyncActionSummary {
  return {
    toAdd: actions.filter(a => a.action === 'add').length,
    toUpdate: actions.filter(a => a.action === 'update').length,
    toSkip: actions.filter(a => a.action === 'skip').length,
    total: actions.length,
  };
}

/**
 * Maximum files allowed per folder sync
 */
export const MAX_FILES_PER_FOLDER = 500;

/**
 * Maximum file size in bytes (50MB)
 */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Validate folder for upload
 */
export function validateFolder(files: File[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check total file count
  if (files.length > MAX_FILES_PER_FOLDER) {
    errors.push(`Too many files: ${files.length} (max: ${MAX_FILES_PER_FOLDER})`);
  }

  // Check individual file sizes
  const oversizedFiles = files.filter(f => f.size > MAX_FILE_SIZE_BYTES);
  if (oversizedFiles.length > 0) {
    errors.push(`${oversizedFiles.length} file(s) exceed 50MB size limit`);
  }

  // Check for unsupported files
  const { unsupported } = filterSupportedFiles(files);
  if (unsupported.length > 0) {
    warnings.push(`${unsupported.length} unsupported file(s) will be skipped`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

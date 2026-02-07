/**
 * Workspace Upload Utilities
 *
 * Helper functions for workspace file uploads.
 * Used by both the upload API and chat stream for RAG processing.
 */

import path from 'path';
import { promises as fs } from 'fs';
import { getDataDir } from '@/lib/storage';

// Image MIME types for categorization
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
]);

/**
 * Get MIME type from file extension
 */
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Get workspace uploads directory path
 */
export function getWorkspaceUploadsDir(workspaceId: string, sessionId: string): string {
  const safeWorkspaceId = workspaceId.replace(/[^a-zA-Z0-9-]/g, '_');
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9-]/g, '_');
  return path.join(getDataDir(), 'workspace-uploads', safeWorkspaceId, safeSessionId);
}

/**
 * Upload detail structure for RAG processing
 */
export interface WorkspaceUploadDetail {
  filepath: string;
  filename: string;
  mimeType: string;
  isImage: boolean;
  fileSize: number;
}

/**
 * Get detailed information about uploaded files for RAG processing.
 * Separates images from documents for multimodal LLM processing.
 *
 * @param workspaceId - The workspace ID
 * @param sessionId - The session ID
 * @param filenames - Optional array of specific filenames to filter
 * @returns Object with images and documents arrays
 */
export async function getWorkspaceUploadDetails(
  workspaceId: string,
  sessionId: string,
  filenames?: string[]
): Promise<{ images: WorkspaceUploadDetail[]; documents: WorkspaceUploadDetail[] }> {
  const uploadsDir = getWorkspaceUploadsDir(workspaceId, sessionId);

  const images: WorkspaceUploadDetail[] = [];
  const documents: WorkspaceUploadDetail[] = [];

  try {
    let files = await fs.readdir(uploadsDir);

    // Filter to specific filenames if provided
    if (filenames && filenames.length > 0) {
      const filenameSet = new Set(filenames);
      files = files.filter(f => filenameSet.has(f));
    }

    for (const filename of files) {
      const filepath = path.join(uploadsDir, filename);

      try {
        const stats = await fs.stat(filepath);
        const mimeType = getMimeType(filename);
        const isImage = IMAGE_TYPES.has(mimeType);

        const detail: WorkspaceUploadDetail = {
          filepath,
          filename,
          mimeType,
          isImage,
          fileSize: stats.size,
        };

        if (isImage) {
          images.push(detail);
        } else {
          documents.push(detail);
        }
      } catch {
        // Skip files we can't stat
        continue;
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return { images, documents };
}

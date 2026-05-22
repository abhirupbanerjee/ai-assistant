/**
 * Agent Bot Uploaded File Management
 *
 * Shared module for managing temporary uploaded files before invocation.
 * Used by both the upload API route and the executor.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ensureDir } from '@/lib/storage';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const AGENT_BOT_UPLOADS_DIR = path.join(DATA_DIR, 'agent-bot-uploads');

// Temp file expiry (1 hour)
const TEMP_FILE_TTL_MS = 60 * 60 * 1000;

// In-memory map of file IDs to file info (for temp files before invoke)
const tempFileMap = new Map<string, {
  filepath: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  agentBotId: string;
  createdAt: Date;
}>();

/**
 * Get upload directory for temp files
 */
export function getAgentBotUploadsDir(): string {
  return path.join(AGENT_BOT_UPLOADS_DIR, 'temp');
}

/**
 * Get permanent storage directory for job files
 */
export function getAgentBotJobFilesDir(): string {
  return path.join(AGENT_BOT_UPLOADS_DIR, 'jobs');
}

/**
 * Store file info in temp map
 */
export function registerUploadedFile(
  fileId: string,
  info: {
    filepath: string;
    originalFilename: string;
    mimeType: string;
    fileSize: number;
    agentBotId: string;
  }
): void {
  tempFileMap.set(fileId, {
    ...info,
    createdAt: new Date(),
  });
}

/**
 * Get uploaded file info by ID
 */
export function getUploadedFile(fileId: string): {
  filepath: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  agentBotId: string;
} | null {
  const info = tempFileMap.get(fileId);
  if (!info) return null;

  // Check if expired
  if (Date.now() - info.createdAt.getTime() > TEMP_FILE_TTL_MS) {
    fs.promises.unlink(info.filepath).catch(() => {});
    tempFileMap.delete(fileId);
    return null;
  }

  return {
    filepath: info.filepath,
    originalFilename: info.originalFilename,
    mimeType: info.mimeType,
    fileSize: info.fileSize,
    agentBotId: info.agentBotId,
  };
}

/**
 * Remove uploaded file after processing
 */
export function removeUploadedFile(fileId: string): void {
  const info = tempFileMap.get(fileId);
  if (info) {
    fs.promises.unlink(info.filepath).catch(() => {});
    tempFileMap.delete(fileId);
  }
}

/**
 * Move uploaded file to permanent storage for a job
 */
export async function moveUploadedFileToPermanent(
  fileId: string,
  jobId: string
): Promise<{ filepath: string; originalFilename: string; mimeType: string; fileSize: number } | null> {
  const info = getUploadedFile(fileId);
  if (!info) return null;

  const jobFilesDir = path.join(getAgentBotJobFilesDir(), jobId.substring(0, 8));
  await ensureDir(jobFilesDir);

  const ext = path.extname(info.originalFilename) || '';
  const safeFilename = `${fileId}${ext}`;
  const destPath = path.join(jobFilesDir, safeFilename);

  try {
    await fs.promises.rename(info.filepath, destPath);
  } catch {
    // If rename fails (e.g., cross-device), try copy+delete
    try {
      const buffer = await fs.promises.readFile(info.filepath);
      await fs.promises.writeFile(destPath, buffer);
      await fs.promises.unlink(info.filepath);
    } catch {
      return null;
    }
  }

  // Remove from temp map
  tempFileMap.delete(fileId);

  return {
    filepath: destPath,
    originalFilename: info.originalFilename,
    mimeType: info.mimeType,
    fileSize: info.fileSize,
  };
}

/**
 * Clean up expired temp files
 */
export function cleanupExpiredFiles(): void {
  const now = Date.now();
  for (const [fileId, info] of tempFileMap.entries()) {
    if (now - info.createdAt.getTime() > TEMP_FILE_TTL_MS) {
      fs.promises.unlink(info.filepath).catch(() => {});
      tempFileMap.delete(fileId);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupExpiredFiles, 10 * 60 * 1000);

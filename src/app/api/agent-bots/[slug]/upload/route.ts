/**
 * Agent Bot File Upload API
 *
 * POST /api/agent-bots/[slug]/upload
 *
 * Upload files for agent bot invocation.
 * Files are stored temporarily and can be referenced in invoke requests.
 */

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { promises as fs } from 'fs';
import { getActiveAgentBotBySlug, getDefaultVersion } from '@/lib/db/compat';
import {
  authenticateRequest,
  isAuthError,
  agentBotErrors,
} from '@/lib/agent-bot/auth';
import { ensureDir } from '@/lib/storage';
import { getCurrentUser } from '@/lib/auth';

// ============================================================================
// Constants
// ============================================================================

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

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get upload directory for temp files
 */
function getAgentBotUploadsDir(): string {
  return path.join(AGENT_BOT_UPLOADS_DIR, 'temp');
}

/**
 * Check if admin test mode is enabled
 */
async function isAdminTest(request: NextRequest): Promise<boolean> {
  const adminTestHeader = request.headers.get('X-Admin-Test');
  if (adminTestHeader !== 'true') {
    return false;
  }

  // Verify user is authenticated as admin
  try {
    const user = await getCurrentUser();
    return user?.role === 'admin' || user?.role === 'superuser';
  } catch {
    return false;
  }
}

/**
 * Clean up expired temp files
 */
function cleanupExpiredFiles(): void {
  const now = Date.now();
  for (const [fileId, info] of tempFileMap.entries()) {
    if (now - info.createdAt.getTime() > TEMP_FILE_TTL_MS) {
      // Delete file and remove from map
      fs.unlink(info.filepath).catch(() => {});
      tempFileMap.delete(fileId);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupExpiredFiles, 10 * 60 * 1000);

// ============================================================================
// Route Handlers
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  try {
    const { slug } = await params;

    // Get agent bot
    const agentBot = await getActiveAgentBotBySlug(slug);
    if (!agentBot) {
      return agentBotErrors.agentBotNotFound();
    }

    // Check authentication (API key or admin test)
    const isAdmin = await isAdminTest(request);
    if (!isAdmin) {
      const authResult = await authenticateRequest(request, slug);
      if (isAuthError(authResult)) {
        return authResult;
      }
    }

    // Get default version for file config
    const version = await getDefaultVersion(agentBot.id);
    if (!version) {
      return agentBotErrors.versionNotFound();
    }

    // Check if file upload is enabled
    const fileConfig = version.input_schema?.files;
    if (!fileConfig?.enabled) {
      return agentBotErrors.fileValidationError('File upload is not enabled for this agent bot');
    }

    // Parse form data
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Content-Type must be multipart/form-data', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return agentBotErrors.fileValidationError('No file provided');
    }

    // Validate file type
    const allowedTypes = fileConfig.allowedTypes || [];
    if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
      return agentBotErrors.fileValidationError(
        `File type '${file.type}' is not allowed. Allowed types: ${allowedTypes.join(', ')}`
      );
    }

    // Validate file size
    const maxSizeMB = fileConfig.maxSizePerFileMB || 10;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      return agentBotErrors.fileValidationError(
        `File too large. Maximum size is ${maxSizeMB}MB`
      );
    }

    // Generate file ID and save file
    const fileId = `file_${uuidv4()}`;
    const ext = path.extname(file.name) || '';
    const safeFilename = `${fileId}${ext}`;

    const uploadsDir = getAgentBotUploadsDir();
    await ensureDir(uploadsDir);

    const filepath = path.join(uploadsDir, safeFilename);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(filepath, buffer);

    // Store file info in temp map
    tempFileMap.set(fileId, {
      filepath,
      originalFilename: file.name,
      mimeType: file.type,
      fileSize: file.size,
      agentBotId: agentBot.id,
      createdAt: new Date(),
    });

    return NextResponse.json({
      fileId,
      filename: file.name,
      mimeType: file.type,
      fileSize: file.size,
    });
  } catch (error) {
    console.error('[AgentBot] Upload error:', error);
    return NextResponse.json(
      { error: 'Failed to upload file', code: 'UPLOAD_ERROR' },
      { status: 500 }
    );
  }
}

// ============================================================================
// Export file lookup for executor
// ============================================================================

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
    fs.unlink(info.filepath).catch(() => {});
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
    fs.unlink(info.filepath).catch(() => {});
    tempFileMap.delete(fileId);
  }
}

// ============================================================================
// OPTIONS Handler (CORS)
// ============================================================================

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Test',
      'Access-Control-Max-Age': '86400',
    },
  });
}

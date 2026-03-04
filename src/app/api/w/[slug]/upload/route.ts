/**
 * Workspace Upload API
 *
 * File upload endpoint for workspace sessions.
 * Supports file uploads for both embed and standalone modes
 * when file_upload_enabled is true for the workspace.
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import {
  validateWorkspaceRequest,
  extractOrigin,
  extractIP,
  hashIP,
} from '@/lib/workspace/validator';
import { getSession, isSessionValid } from '@/lib/db/compat';
import {
  checkRateLimit,
  getRateLimitHeaders,
} from '@/lib/workspace/rate-limiter';
import { ensureDir } from '@/lib/storage';
import { getWorkspaceUploadsDir } from '@/lib/workspace/uploads';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

// Allowed MIME types for workspace uploads
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
]);

// Save upload file
async function saveWorkspaceUpload(
  workspaceId: string,
  sessionId: string,
  filename: string,
  buffer: Buffer
): Promise<{ filepath: string; filename: string }> {
  const uploadsDir = getWorkspaceUploadsDir(workspaceId, sessionId);
  await ensureDir(uploadsDir);

  // Generate unique filename
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const safeBase = base.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 50);
  const uniqueFilename = `${Date.now()}-${safeBase}${ext}`;

  const filepath = path.join(uploadsDir, uniqueFilename);
  await fs.writeFile(filepath, buffer);

  return { filepath, filename: uniqueFilename };
}

// List uploads for a session
async function listSessionUploads(
  workspaceId: string,
  sessionId: string
): Promise<Array<{ filename: string; size: number; uploadedAt: Date }>> {
  const uploadsDir = getWorkspaceUploadsDir(workspaceId, sessionId);

  try {
    const files = await fs.readdir(uploadsDir);
    const uploads = await Promise.all(
      files.map(async (filename) => {
        const filepath = path.join(uploadsDir, filename);
        const stats = await fs.stat(filepath);
        return {
          filename,
          size: stats.size,
          uploadedAt: stats.mtime,
        };
      })
    );
    return uploads;
  } catch {
    return [];
  }
}

// Delete upload file
async function deleteWorkspaceUpload(
  workspaceId: string,
  sessionId: string,
  filename: string
): Promise<boolean> {
  const uploadsDir = getWorkspaceUploadsDir(workspaceId, sessionId);
  const filepath = path.join(uploadsDir, filename);

  try {
    await fs.unlink(filepath);
    return true;
  } catch {
    return false;
  }
}

/**
 * POST /api/w/[slug]/upload
 *
 * Upload a file for the workspace session.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { slug } = await context.params;
    const origin = extractOrigin(request.headers);
    const ip = extractIP(request.headers);
    const ipHash = hashIP(ip);

    // Get session ID from form data or header
    const contentType = request.headers.get('content-type') || '';

    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Content-Type must be multipart/form-data', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const sessionId = formData.get('sessionId') as string;
    const file = formData.get('file') as File | null;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Validate workspace
    const validation = await validateWorkspaceRequest(slug, {
      origin: origin || undefined,
      checkEnabled: true,
    });

    if (!validation.valid || !validation.workspace) {
      return NextResponse.json(
        { error: validation.error, code: validation.errorCode },
        { status: 404 }
      );
    }

    const workspace = validation.workspace;

    // Check if file upload is enabled for this workspace
    if (!workspace.file_upload_enabled) {
      return NextResponse.json(
        { error: 'File upload not enabled for this workspace', code: 'UPLOAD_DISABLED' },
        { status: 403 }
      );
    }

    // Validate session
    if (!(await isSessionValid(sessionId))) {
      return NextResponse.json(
        { error: 'Session expired', code: 'SESSION_EXPIRED' },
        { status: 401 }
      );
    }

    const session = await getSession(sessionId);
    if (!session || session.workspace_id !== workspace.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'SESSION_INVALID' },
        { status: 401 }
      );
    }

    // Rate limiting for embed mode
    if (workspace.type === 'embed') {
      const rateLimit = await checkRateLimit(workspace.id, ipHash, sessionId);

      if (!rateLimit.allowed) {
        return NextResponse.json(
          {
            error: 'Rate limit exceeded',
            code: 'RATE_LIMITED',
            resetAt: rateLimit.resetAt?.toISOString(),
          },
          {
            status: 429,
            headers: getRateLimitHeaders(rateLimit),
          }
        );
      }
    }

    // Validate file type
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        {
          error: 'Invalid file type. Allowed: PDF, TXT, MD, JSON, PNG, JPG, GIF, WEBP, DOCX',
          code: 'INVALID_FILE_TYPE',
        },
        { status: 400 }
      );
    }

    // Validate file size
    const maxFileSizeBytes = workspace.max_file_size_mb * 1024 * 1024;
    if (file.size > maxFileSizeBytes) {
      return NextResponse.json(
        {
          error: `File too large (max ${workspace.max_file_size_mb}MB)`,
          code: 'FILE_TOO_LARGE',
        },
        { status: 413 }
      );
    }

    // Save file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await saveWorkspaceUpload(
      workspace.id,
      sessionId,
      file.name,
      buffer
    );

    return NextResponse.json({
      filename: result.filename,
      filepath: result.filepath,
      size: file.size,
      mimeType: file.type,
    });
  } catch (error) {
    console.error('Workspace upload error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to upload file',
        code: 'UPLOAD_ERROR',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/w/[slug]/upload
 *
 * List uploads for a session.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { slug } = await context.params;
    const origin = extractOrigin(request.headers);
    const searchParams = request.nextUrl.searchParams;

    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Validate workspace
    const validation = await validateWorkspaceRequest(slug, {
      origin: origin || undefined,
      checkEnabled: true,
    });

    if (!validation.valid || !validation.workspace) {
      return NextResponse.json(
        { error: validation.error, code: validation.errorCode },
        { status: 404 }
      );
    }

    const workspace = validation.workspace;

    // Validate session
    if (!(await isSessionValid(sessionId))) {
      return NextResponse.json(
        { error: 'Session expired', code: 'SESSION_EXPIRED' },
        { status: 401 }
      );
    }

    const session = await getSession(sessionId);
    if (!session || session.workspace_id !== workspace.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'SESSION_INVALID' },
        { status: 401 }
      );
    }

    // List uploads
    const uploads = await listSessionUploads(workspace.id, sessionId);

    return NextResponse.json({ uploads });
  } catch (error) {
    console.error('List uploads error:', error);
    return NextResponse.json(
      { error: 'Failed to list uploads', code: 'LIST_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/w/[slug]/upload
 *
 * Delete an upload file.
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { slug } = await context.params;
    const origin = extractOrigin(request.headers);
    const searchParams = request.nextUrl.searchParams;

    const sessionId = searchParams.get('sessionId');
    const filename = searchParams.get('filename');

    if (!sessionId || !filename) {
      return NextResponse.json(
        { error: 'Session ID and filename required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Validate workspace
    const validation = await validateWorkspaceRequest(slug, {
      origin: origin || undefined,
      checkEnabled: true,
    });

    if (!validation.valid || !validation.workspace) {
      return NextResponse.json(
        { error: validation.error, code: validation.errorCode },
        { status: 404 }
      );
    }

    const workspace = validation.workspace;

    // Validate session
    if (!(await isSessionValid(sessionId))) {
      return NextResponse.json(
        { error: 'Session expired', code: 'SESSION_EXPIRED' },
        { status: 401 }
      );
    }

    const session = await getSession(sessionId);
    if (!session || session.workspace_id !== workspace.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'SESSION_INVALID' },
        { status: 401 }
      );
    }

    // Delete file
    const deleted = await deleteWorkspaceUpload(workspace.id, sessionId, filename);

    if (!deleted) {
      return NextResponse.json(
        { error: 'File not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, filename });
  } catch (error) {
    console.error('Delete upload error:', error);
    return NextResponse.json(
      { error: 'Failed to delete file', code: 'DELETE_ERROR' },
      { status: 500 }
    );
  }
}

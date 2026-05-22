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
import {
  getAgentBotUploadsDir,
  registerUploadedFile,
} from '@/lib/agent-bot/uploaded-files';
import { ensureDir } from '@/lib/storage';
import { getCurrentUser } from '@/lib/auth';

// ============================================================================
// Helpers
// ============================================================================

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

    // Validate file type (supports wildcards like "image/*")
    const allowedTypes = fileConfig.allowedTypes || [];
    if (allowedTypes.length > 0) {
      const isAllowed = allowedTypes.some((allowed) => {
        if (allowed.endsWith('/*')) {
          const prefix = allowed.slice(0, -1);
          return file.type.startsWith(prefix);
        }
        return file.type === allowed;
      });

      if (!isAllowed) {
        return agentBotErrors.fileValidationError(
          `File type '${file.type}' is not allowed. Allowed types: ${allowedTypes.join(', ')}`
        );
      }
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
    registerUploadedFile(fileId, {
      filepath,
      originalFilename: file.name,
      mimeType: file.type,
      fileSize: file.size,
      agentBotId: agentBot.id,
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

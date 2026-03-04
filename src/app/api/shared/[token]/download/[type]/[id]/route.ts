/**
 * Shared Thread File Download API
 * GET - Download a file from a shared thread
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import { getCurrentUser } from '@/lib/auth';
import {
  getUserByEmail,
  getShareByToken,
  validateShareAccess,
  logShareAccess,
  getThreadUploadById,
  getThreadOutputById,
} from '@/lib/db/compat';
import { isToolEnabled } from '@/lib/tools';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ token: string; type: string; id: string }>;
}

/**
 * GET /api/shared/[token]/download/[type]/[id]
 * Download a file from a shared thread
 * type: 'upload' | 'output'
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Authentication required', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { token, type, id } = await params;

    // Validate type parameter
    if (type !== 'upload' && type !== 'output') {
      return NextResponse.json<ApiError>(
        { error: 'Invalid file type', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Check if share_thread tool is enabled
    if (!(await isToolEnabled('share_thread'))) {
      return NextResponse.json<ApiError>(
        { error: 'Thread sharing is currently disabled', code: 'NOT_CONFIGURED' },
        { status: 403 }
      );
    }

    // Get user from database
    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get share by token
    const share = await getShareByToken(token);
    if (!share) {
      return NextResponse.json<ApiError>(
        { error: 'Share not found or invalid link', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Validate share access
    const validationError = validateShareAccess(share);
    if (validationError) {
      return NextResponse.json<ApiError>(
        { error: validationError, code: 'ACCESS_DENIED' },
        { status: 403 }
      );
    }

    // Check if downloads are allowed
    if (!share.allowDownload) {
      return NextResponse.json<ApiError>(
        { error: 'Downloads are not allowed for this share', code: 'ACCESS_DENIED' },
        { status: 403 }
      );
    }

    // Get file based on type
    const fileId = parseInt(id, 10);
    if (isNaN(fileId)) {
      return NextResponse.json<ApiError>(
        { error: 'Invalid file ID', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    let filepath: string;
    let filename: string;
    let fileSize: number;
    let fileType: string;

    if (type === 'upload') {
      const upload = await getThreadUploadById(fileId);
      if (!upload) {
        return NextResponse.json<ApiError>(
          { error: 'File not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }

      // Verify file belongs to the shared thread
      if (upload.thread_id !== share.threadId) {
        return NextResponse.json<ApiError>(
          { error: 'File does not belong to this thread', code: 'ACCESS_DENIED' },
          { status: 403 }
        );
      }

      filepath = upload.filepath;
      filename = upload.filename;
      fileSize = upload.file_size;
      fileType = getFileExtension(upload.filename);
    } else {
      const output = await getThreadOutputById(fileId);
      if (!output) {
        return NextResponse.json<ApiError>(
          { error: 'File not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }

      // Verify file belongs to the shared thread
      if (output.thread_id !== share.threadId) {
        return NextResponse.json<ApiError>(
          { error: 'File does not belong to this thread', code: 'ACCESS_DENIED' },
          { status: 403 }
        );
      }

      filepath = output.filepath;
      filename = output.filename;
      fileSize = output.file_size;
      fileType = output.file_type;
    }

    // Check if file exists
    if (!fs.existsSync(filepath)) {
      return NextResponse.json<ApiError>(
        { error: 'File not found on server', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Log the download
    await logShareAccess(share.id, dbUser.id, 'download', type, id);

    // Read file and return
    const fileBuffer = fs.readFileSync(filepath);
    const contentType = getContentType(fileType);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': fileSize.toString(),
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (error) {
    console.error('Shared file download error:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to download file', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * Get file extension from filename
 */
function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Get content type for file type
 */
function getContentType(fileType: string): string {
  const contentTypes: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    md: 'text/markdown',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    image: 'image/webp',
  };

  return contentTypes[fileType] || 'application/octet-stream';
}

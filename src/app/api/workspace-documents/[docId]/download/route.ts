/**
 * Workspace Document Download API
 *
 * GET /api/workspace-documents/[docId]/download
 * Download a generated document from a workspace context
 *
 * Similar to /api/documents/[docId]/download but for workspace outputs.
 * Does not require authentication (workspace sessions handle access control).
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  getWorkspaceOutputById,
  incrementWorkspaceOutputDownloadCount,
} from '@/lib/db/compat';

interface RouteParams {
  params: Promise<{ docId: string }>;
}

/**
 * GET /api/workspace-documents/[docId]/download
 * Download a generated workspace document
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { docId } = await params;
    const docIdNum = parseInt(docId, 10);
    const searchParams = request.nextUrl.searchParams;
    const thumbnail = searchParams.get('thumbnail') === 'true';

    if (isNaN(docIdNum)) {
      return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
    }

    // Get document metadata from workspace_outputs table
    const doc = await getWorkspaceOutputById(docIdNum);

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Check if document has expired
    if (doc.expires_at) {
      const expiryDate = new Date(doc.expires_at);
      if (expiryDate < new Date()) {
        return NextResponse.json(
          { error: 'Document has expired', expiredAt: doc.expires_at },
          { status: 410 }
        );
      }
    }

    // Determine which file to serve (main or thumbnail)
    let filepath = doc.filepath;
    let filename = doc.filename;

    if (thumbnail && doc.generation_config) {
      try {
        const config = JSON.parse(doc.generation_config);
        if (config.thumbnailFilename) {
          const thumbnailPath = path.join(path.dirname(doc.filepath), config.thumbnailFilename);
          if (fs.existsSync(thumbnailPath)) {
            filepath = thumbnailPath;
            filename = config.thumbnailFilename;
          }
        }
      } catch {
        // Ignore parse errors, use main file
      }
    }

    // Check if file exists on disk
    if (!fs.existsSync(filepath)) {
      return NextResponse.json(
        { error: 'Document file not found on server' },
        { status: 404 }
      );
    }

    // Read file contents
    const fileBuffer = fs.readFileSync(filepath);

    // Increment download count
    await incrementWorkspaceOutputDownloadCount(docIdNum);

    // Determine content type
    const contentType = getContentType(doc.file_type, filename);

    // Create response with file
    const response = new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    });

    return response;
  } catch (error) {
    console.error('Workspace document download error:', error);
    return NextResponse.json(
      { error: 'Failed to download document' },
      { status: 500 }
    );
  }
}

/**
 * Get content type for file type
 */
function getContentType(fileType: string, filename: string): string {
  // Check file extension for more specific types
  const ext = filename.split('.').pop()?.toLowerCase();

  const extensionTypes: Record<string, string> = {
    webp: 'image/webp',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
  };

  if (ext && extensionTypes[ext]) {
    return extensionTypes[ext];
  }

  const fileTypes: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    md: 'text/markdown',
    image: 'image/webp', // Default for generated images
    chart: 'image/png',
  };

  return fileTypes[fileType] || 'application/octet-stream';
}

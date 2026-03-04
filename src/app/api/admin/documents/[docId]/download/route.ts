/**
 * Admin Document Download API
 *
 * GET /api/admin/documents/[docId]/download
 * Download a knowledge base document by ID (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import path from 'path';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole } from '@/lib/users';
import { getDocumentById } from '@/lib/db/compat';
import { getGlobalDocsDir } from '@/lib/storage';

interface RouteParams {
  params: Promise<{ docId: string }>;
}

/**
 * GET /api/admin/documents/[docId]/download
 * Download a knowledge base document
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { docId } = await params;
    const docIdNum = parseInt(docId, 10);

    if (isNaN(docIdNum)) {
      return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
    }

    // Verify user is authenticated and is admin
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get document metadata
    const doc = await getDocumentById(docIdNum);
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Construct full file path
    const filePath = path.join(getGlobalDocsDir(), doc.filepath);

    // Check if file exists on disk
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: 'Document file not found on server' },
        { status: 404 }
      );
    }

    // Read file contents
    const fileBuffer = fs.readFileSync(filePath);

    // Determine content type
    const contentType = getContentType(doc.filename);

    // Create response with file
    const response = new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.filename)}"`,
        'Content-Length': doc.file_size.toString(),
        'Cache-Control': 'private, no-cache',
      },
    });

    return response;
  } catch (error) {
    console.error('Document download error:', error);
    return NextResponse.json(
      { error: 'Failed to download document' },
      { status: 500 }
    );
  }
}

/**
 * Get content type based on filename extension
 */
function getContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };

  return contentTypes[ext] || 'application/octet-stream';
}

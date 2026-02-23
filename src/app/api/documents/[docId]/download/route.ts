/**
 * Document Download API
 *
 * GET /api/documents/[docId]/download
 * Download a generated document by ID
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import { getCurrentUser } from '@/lib/auth';
import {
  getDocument,
  incrementDownloadCount,
} from '@/lib/docgen/document-generator';

interface RouteParams {
  params: Promise<{ docId: string }>;
}

/**
 * GET /api/documents/[docId]/download
 * Download a generated document
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { docId } = await params;
    const docIdNum = parseInt(docId, 10);

    if (isNaN(docIdNum)) {
      return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
    }

    // Verify user is authenticated
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get document metadata
    const doc = await getDocument(docIdNum);
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Check if document has expired
    if (doc.expiresAt) {
      const expiryDate = new Date(doc.expiresAt);
      if (expiryDate < new Date()) {
        return NextResponse.json(
          { error: 'Document has expired', expiredAt: doc.expiresAt },
          { status: 410 }
        );
      }
    }

    // Check if file exists on disk
    if (!fs.existsSync(doc.filepath)) {
      return NextResponse.json(
        { error: 'Document file not found on server' },
        { status: 404 }
      );
    }

    // Read file contents
    const fileBuffer = fs.readFileSync(doc.filepath);

    // Increment download count
    await incrementDownloadCount(docIdNum);

    // Determine content type
    const fileType = doc.fileType as string;
    const contentType = getContentType(fileType);

    // Use inline disposition for audio (streaming) and attachment for downloads
    const disposition = fileType === 'mp3' ? 'inline' : 'attachment';

    // Create response with file
    const response = new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `${disposition}; filename="${encodeURIComponent(doc.filename)}"`,
        'Content-Length': doc.fileSize.toString(),
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
 * Get content type for file type
 */
function getContentType(fileType: string): string {
  const contentTypes: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    md: 'text/markdown',
    image: 'image/webp', // Generated images are stored as WebP
    mp3: 'audio/mpeg', // Generated podcasts
  };

  return contentTypes[fileType] || 'application/octet-stream';
}

/**
 * Chat Export API
 *
 * POST /api/chat/export
 * Generate a PDF or Word document from chat content
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { executeTool, isToolEnabled, initializeTools } from '@/lib/tools';

interface ExportRequest {
  content: string;
  title?: string;
  format?: 'pdf' | 'docx';
  threadId?: string;
  messageId?: string;
  categoryId?: number;
}

/**
 * POST /api/chat/export
 * Generate a document from chat content
 */
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = (await request.json()) as ExportRequest;
    const {
      content,
      title = 'Chat Export',
      format = 'pdf',
      threadId,
      messageId,
      categoryId,
    } = body;

    // Validate content
    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Content is required and must be a string' },
        { status: 400 }
      );
    }

    if (content.length > 500000) {
      return NextResponse.json(
        { error: 'Content is too long (max 500KB)' },
        { status: 400 }
      );
    }

    // Validate format
    if (!['pdf', 'docx'].includes(format)) {
      return NextResponse.json(
        { error: 'Invalid format. Must be "pdf" or "docx"' },
        { status: 400 }
      );
    }

    // Initialize tools and check if doc_gen is enabled
    await initializeTools();
    if (!(await isToolEnabled('doc_gen'))) {
      return NextResponse.json(
        { error: 'Document generation is currently disabled' },
        { status: 503 }
      );
    }

    // Execute the doc_gen tool
    const resultJson = await executeTool(
      'doc_gen',
      JSON.stringify({
        title,
        content,
        format,
        threadId,
        messageId,
        categoryId,
      })
    );

    const result = JSON.parse(resultJson);

    if (result.error) {
      return NextResponse.json(
        { error: result.error, errorCode: result.errorCode },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      document: result.document,
    });
  } catch (error) {
    console.error('Chat export error:', error);
    return NextResponse.json(
      { error: 'Failed to export document' },
      { status: 500 }
    );
  }
}

/**
 * Admin Document Summaries API
 *
 * POST /api/admin/document-summaries/generate
 *   Trigger summary generation for documents.
 *   Body: { documentId?: number, categoryId?: number, all?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { generateDocumentSummary } from '@/lib/document-summarizer';
import {
  getDocumentById,
  getDocumentsByCategory,
  getAllDocuments,
  getCategoryById,
} from '@/lib/db/compat';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();

    const body = await request.json().catch(() => ({}));
    const { documentId, categoryId, all } = body;

    // Coerce string ids to numbers — the frontend GlobalDocument.id is a string
    // (stringified by toGlobalDocument), but the DB primary key is SERIAL (numeric).
    const numericDocumentId =
      typeof documentId === 'number'
        ? documentId
        : typeof documentId === 'string' && documentId.trim() !== '' && !isNaN(Number(documentId))
        ? Number(documentId)
        : undefined;
    const numericCategoryId =
      typeof categoryId === 'number'
        ? categoryId
        : typeof categoryId === 'string' && categoryId.trim() !== '' && !isNaN(Number(categoryId))
        ? Number(categoryId)
        : undefined;

    // Mode 1: Generate summary for a single document
    if (typeof numericDocumentId === 'number') {
      const doc = await getDocumentById(numericDocumentId);
      if (!doc) {
        return NextResponse.json(
          { error: 'Document not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }

      if (doc.status !== 'ready') {
        return NextResponse.json(
          { error: `Document is not ready (status: ${doc.status})`, code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }

      // Fire-and-forget: the generation is async and may take time
      generateDocumentSummary(numericDocumentId).catch(err =>
        console.error(`[Admin] Summary generation failed for doc ${numericDocumentId}:`, err)
      );

      return NextResponse.json({
        success: true,
        message: `Summary generation started for "${doc.filename}"`,
        documentId: numericDocumentId,
      });
    }

    // Mode 2: Generate summaries for all documents in a category
    if (typeof numericCategoryId === 'number') {
      const category = await getCategoryById(numericCategoryId);
      if (!category) {
        return NextResponse.json(
          { error: 'Category not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }

      const docs = await getDocumentsByCategory(numericCategoryId);
      const readyDocs = docs.filter(d => d.status === 'ready');

      if (readyDocs.length === 0) {
        return NextResponse.json({
          success: true,
          message: `No ready documents found in category "${category.name}"`,
          categoryId: numericCategoryId,
          docCount: 0,
        });
      }

      // Fire-and-forget for all docs in the category
      for (const doc of readyDocs) {
        generateDocumentSummary(doc.id).catch(err =>
          console.error(`[Admin] Summary generation failed for doc ${doc.id}:`, err)
        );
      }

      return NextResponse.json({
        success: true,
        message: `Summary generation started for ${readyDocs.length} document(s) in "${category.name}"`,
        categoryId: numericCategoryId,
        docCount: readyDocs.length,
      });
    }

    // Mode 3: Generate summaries for all documents
    if (all === true) {
      const docs = await getAllDocuments();
      const readyDocs = docs.filter(d => d.status === 'ready');

      if (readyDocs.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'No ready documents found',
          docCount: 0,
        });
      }

      // Fire-and-forget for all documents
      for (const doc of readyDocs) {
        generateDocumentSummary(doc.id).catch(err =>
          console.error(`[Admin] Summary generation failed for doc ${doc.id}:`, err)
        );
      }

      return NextResponse.json({
        success: true,
        message: `Summary generation started for ${readyDocs.length} document(s)`,
        docCount: readyDocs.length,
      });
    }

    return NextResponse.json(
      { error: 'Specify documentId, categoryId, or all: true', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json(
        { error: 'Admin access required', code: 'ACCESS_DENIED' },
        { status: 403 }
      );
    }

    console.error('[Admin] Error generating summaries:', error);
    return NextResponse.json(
      { error: 'Failed to generate summaries', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

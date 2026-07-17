/**
 * Admin Document Summaries Stats API
 *
 * GET /api/admin/document-summaries?categoryId=1
 *   Returns count of documents with/without summaries.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db/kysely';
import { sql } from 'kysely';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get('categoryId')
      ? parseInt(searchParams.get('categoryId')!, 10)
      : null;

    const db = await getDb();

    if (categoryId && !isNaN(categoryId)) {
      // Filter by category: docs tagged to the category + global docs
      const result = await sql<{ with_summary: number; total_ready: number }>`
        SELECT
          COUNT(DISTINCT CASE WHEN ds.document_id IS NOT NULL THEN d.id END)::int AS with_summary,
          COUNT(DISTINCT d.id)::int AS total_ready
        FROM documents d
        LEFT JOIN document_summaries ds ON d.id = ds.document_id
        LEFT JOIN document_categories dc ON d.id = dc.document_id
        WHERE d.status = 'ready'
          AND (dc.category_id = ${categoryId} OR d.is_global = 1)
      `.execute(db);

      // Also fetch which document IDs have summaries for per-doc badges
      const docIdsResult = await sql<{ document_id: number }>`
        SELECT DISTINCT ds.document_id FROM document_summaries ds
        INNER JOIN documents d ON ds.document_id = d.id
        LEFT JOIN document_categories dc ON d.id = dc.document_id
        WHERE d.status = 'ready'
          AND (dc.category_id = ${categoryId} OR d.is_global = 1)
      `.execute(db);

      const row = result.rows[0];
      return NextResponse.json({
        withSummary: row?.with_summary ?? 0,
        totalReady: row?.total_ready ?? 0,
        withoutSummary: (row?.total_ready ?? 0) - (row?.with_summary ?? 0),
        summarizedDocIds: docIdsResult.rows.map(r => r.document_id),
      });
    }

    // All documents (no category filter)
    const result = await sql<{ with_summary: number; total_ready: number }>`
      SELECT
        COUNT(ds.document_id)::int AS with_summary,
        COUNT(d.id)::int AS total_ready
      FROM documents d
      LEFT JOIN document_summaries ds ON d.id = ds.document_id
      WHERE d.status = 'ready'
    `.execute(db);

    // Also fetch which document IDs have summaries for per-doc badges
    const docIdsResult = await sql<{ document_id: number }>`
      SELECT ds.document_id FROM document_summaries ds
      INNER JOIN documents d ON ds.document_id = d.id
      WHERE d.status = 'ready'
    `.execute(db);

    const row = result.rows[0];
    return NextResponse.json({
      withSummary: row?.with_summary ?? 0,
      totalReady: row?.total_ready ?? 0,
      withoutSummary: (row?.total_ready ?? 0) - (row?.with_summary ?? 0),
      summarizedDocIds: docIdsResult.rows.map(r => r.document_id),
    });
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

    console.error('[Admin] Error fetching summary stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch summary stats', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

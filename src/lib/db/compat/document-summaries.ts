/**
 * Document Summaries Database Operations - Async Compatibility Layer
 *
 * Manages pre-computed per-document summaries stored in the document_summaries table.
 * These summaries power KB overview queries ("summarise the knowledge base") by
 * providing directly-queryable summary text that bypasses similarity search and the
 * reranker.
 *
 * Uses raw SQL queries (sql``) because the table is added via migration and may not
 * yet exist in the generated DB types. Run `db:types` after the migration has been
 * applied to the database to regenerate Kysely types.
 */

import { getDb } from '../kysely';
import { sql } from 'kysely';

/**
 * A document summary row from the database.
 */
export interface DocumentSummary {
  id: number;
  document_id: number;
  summary_text: string;
  generated_at: string;
  model_used: string | null;
}

/**
 * A document summary with the document filename, used for KB overview queries.
 */
export interface DocumentSummaryWithFilename {
  documentId: number;
  filename: string;
  summaryText: string;
  generatedAt: string;
}

/**
 * Get the summary for a single document.
 */
export async function getDocumentSummary(
  documentId: number
): Promise<DocumentSummary | undefined> {
  const db = await getDb();
  const rows = await sql<DocumentSummary>`
    SELECT id, document_id, summary_text, generated_at, model_used
    FROM document_summaries
    WHERE document_id = ${documentId}
  `.execute(db);
  return rows.rows[0] ?? undefined;
}

/**
 * Get summaries for all ready documents in one or more categories.
 * Joins through document_categories to get only documents tagged to the
 * specified categories (plus global documents).
 *
 * @param categoryIds - Category IDs to fetch summaries for
 * @returns Array of document summaries with filenames
 */
export async function getDocumentSummariesByCategories(
  categoryIds: number[]
): Promise<DocumentSummaryWithFilename[]> {
  if (categoryIds.length === 0) return [];

  const db = await getDb();

  // Fetch summaries for documents tagged to the given categories (via document_categories)
  // and for global documents (is_global = 1) which belong to all categories.
  const rows = await sql<DocumentSummaryWithFilename>`
    SELECT DISTINCT ON (ds.document_id)
      ds.document_id AS "documentId",
      d.filename,
      ds.summary_text AS "summaryText",
      ds.generated_at AS "generatedAt"
    FROM document_summaries ds
    INNER JOIN documents d ON ds.document_id = d.id
    LEFT JOIN document_categories dc ON d.id = dc.document_id
    WHERE d.status = 'ready'
      AND (dc.category_id = ANY(${categoryIds}) OR d.is_global = 1)
    ORDER BY ds.document_id
  `.execute(db);

  return rows.rows;
}

/**
 * Upsert a document summary. Uses INSERT ON CONFLICT DO UPDATE to handle
 * concurrent regeneration safely.
 */
export async function upsertDocumentSummary(
  documentId: number,
  summaryText: string,
  modelUsed?: string
): Promise<void> {
  const db = await getDb();
  await sql`
    INSERT INTO document_summaries (document_id, summary_text, model_used)
    VALUES (${documentId}, ${summaryText}, ${modelUsed ?? null})
    ON CONFLICT (document_id)
    DO UPDATE SET
      summary_text = EXCLUDED.summary_text,
      model_used = EXCLUDED.model_used,
      generated_at = NOW()
  `.execute(db);
}

/**
 * Delete the summary for a document. Used before regeneration (reindex).
 * Not needed on document deletion — ON DELETE CASCADE handles that.
 */
export async function deleteDocumentSummary(documentId: number): Promise<void> {
  const db = await getDb();
  await sql`
    DELETE FROM document_summaries WHERE document_id = ${documentId}
  `.execute(db);
}

/**
 * Check whether a document has a summary.
 */
export async function hasDocumentSummary(documentId: number): Promise<boolean> {
  const db = await getDb();
  const result = await sql<{ count: number }>`
    SELECT COUNT(*)::int AS count FROM document_summaries WHERE document_id = ${documentId}
  `.execute(db);
  return (result.rows[0]?.count ?? 0) > 0;
}

/**
 * Get the count of documents with summaries in a category.
 */
export async function getCategorySummaryCount(categoryId: number): Promise<number> {
  const db = await getDb();
  const result = await sql<{ count: number }>`
    SELECT COUNT(*)::int AS count
    FROM document_summaries ds
    INNER JOIN documents d ON ds.document_id = d.id
    INNER JOIN document_categories dc ON d.id = dc.document_id
    WHERE dc.category_id = ${categoryId} AND d.status = 'ready'
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

/**
 * Document Database Operations
 *
 * CRUD operations for document metadata with category tagging
 */

import { execute, queryAll, queryOne, transaction } from './index';

// ============ Types ============

export type DocumentStatus = 'processing' | 'ready' | 'error';

export interface DbDocument {
  id: number;
  filename: string;
  filepath: string;
  file_size: number;
  is_global: number; // SQLite boolean (0/1)
  chunk_count: number;
  status: DocumentStatus;
  error_message: string | null;
  uploaded_by: string;
  created_at: string;
}

export interface DocumentWithCategories extends Omit<DbDocument, 'is_global'> {
  isGlobal: boolean;
  categories: {
    id: number;
    name: string;
    slug: string;
  }[];
}

export interface CreateDocumentInput {
  filename: string;
  filepath: string;
  fileSize: number;
  uploadedBy: string;
  isGlobal?: boolean;
  categoryIds?: number[];
}

export interface UpdateDocumentInput {
  chunkCount?: number;
  status?: DocumentStatus;
  errorMessage?: string | null;
}

// ============ Document CRUD ============

/**
 * Get all documents
 */
export function getAllDocuments(): DbDocument[] {
  return queryAll<DbDocument>(`
    SELECT id, filename, filepath, file_size, is_global, chunk_count, status, error_message, uploaded_by, created_at
    FROM documents
    ORDER BY created_at DESC
  `);
}

/**
 * Get all documents with their categories
 */
export function getAllDocumentsWithCategories(): DocumentWithCategories[] {
  const documents = getAllDocuments();

  return documents.map(doc => {
    const categories = queryAll<{ id: number; name: string; slug: string }>(`
      SELECT c.id, c.name, c.slug
      FROM categories c
      JOIN document_categories dc ON c.id = dc.category_id
      WHERE dc.document_id = ?
      ORDER BY c.name
    `, [doc.id]);

    return {
      ...doc,
      isGlobal: Boolean(doc.is_global),
      categories,
    };
  });
}

/**
 * Get document by ID
 */
export function getDocumentById(id: number): DbDocument | undefined {
  return queryOne<DbDocument>(`
    SELECT id, filename, filepath, file_size, is_global, chunk_count, status, error_message, uploaded_by, created_at
    FROM documents
    WHERE id = ?
  `, [id]);
}

/**
 * Get document with categories
 */
export function getDocumentWithCategories(id: number): DocumentWithCategories | undefined {
  const doc = getDocumentById(id);
  if (!doc) return undefined;

  const categories = queryAll<{ id: number; name: string; slug: string }>(`
    SELECT c.id, c.name, c.slug
    FROM categories c
    JOIN document_categories dc ON c.id = dc.category_id
    WHERE dc.document_id = ?
    ORDER BY c.name
  `, [id]);

  return {
    ...doc,
    isGlobal: Boolean(doc.is_global),
    categories,
  };
}

/**
 * Create a new document
 */
export function createDocument(input: CreateDocumentInput): DbDocument {
  return transaction(() => {
    const result = execute(`
      INSERT INTO documents (filename, filepath, file_size, is_global, status, uploaded_by)
      VALUES (?, ?, ?, ?, 'processing', ?)
    `, [
      input.filename,
      input.filepath,
      input.fileSize,
      input.isGlobal ? 1 : 0,
      input.uploadedBy,
    ]);

    const docId = result.lastInsertRowid as number;

    // Add category associations
    if (input.categoryIds && input.categoryIds.length > 0) {
      for (const categoryId of input.categoryIds) {
        execute(`
          INSERT INTO document_categories (document_id, category_id)
          VALUES (?, ?)
        `, [docId, categoryId]);
      }
    }

    return getDocumentById(docId)!;
  });
}

/**
 * Update document
 */
export function updateDocument(id: number, input: UpdateDocumentInput): DbDocument | undefined {
  const updates: string[] = [];
  const params: unknown[] = [];

  if (input.chunkCount !== undefined) {
    updates.push('chunk_count = ?');
    params.push(input.chunkCount);
  }

  if (input.status !== undefined) {
    updates.push('status = ?');
    params.push(input.status);
  }

  if (input.errorMessage !== undefined) {
    updates.push('error_message = ?');
    params.push(input.errorMessage);
  }

  if (updates.length === 0) {
    return getDocumentById(id);
  }

  params.push(id);
  execute(`UPDATE documents SET ${updates.join(', ')} WHERE id = ?`, params);

  return getDocumentById(id);
}

/**
 * Delete document
 */
export function deleteDocument(id: number): boolean {
  const result = execute('DELETE FROM documents WHERE id = ?', [id]);
  return result.changes > 0;
}

// ============ Category Operations ============

/**
 * Get categories for a document
 */
export function getDocumentCategories(docId: number): number[] {
  const results = queryAll<{ category_id: number }>(`
    SELECT category_id FROM document_categories WHERE document_id = ?
  `, [docId]);
  return results.map(r => r.category_id);
}

/**
 * Add document to category
 */
export function addDocumentToCategory(docId: number, categoryId: number): boolean {
  try {
    execute(`
      INSERT INTO document_categories (document_id, category_id)
      VALUES (?, ?)
    `, [docId, categoryId]);
    return true;
  } catch {
    return false; // Already in category or invalid IDs
  }
}

/**
 * Remove document from category
 */
export function removeDocumentFromCategory(docId: number, categoryId: number): boolean {
  const result = execute(`
    DELETE FROM document_categories
    WHERE document_id = ? AND category_id = ?
  `, [docId, categoryId]);
  return result.changes > 0;
}

/**
 * Set document categories (replace all)
 */
export function setDocumentCategories(docId: number, categoryIds: number[]): void {
  transaction(() => {
    // Remove existing categories
    execute('DELETE FROM document_categories WHERE document_id = ?', [docId]);

    // Add new categories
    for (const categoryId of categoryIds) {
      execute(`
        INSERT INTO document_categories (document_id, category_id)
        VALUES (?, ?)
      `, [docId, categoryId]);
    }
  });
}

/**
 * Toggle document global status
 */
export function setDocumentGlobal(docId: number, isGlobal: boolean): boolean {
  const result = execute(`
    UPDATE documents SET is_global = ? WHERE id = ?
  `, [isGlobal ? 1 : 0, docId]);
  return result.changes > 0;
}

// ============ Query Helpers ============

/**
 * Get documents by category
 */
export function getDocumentsByCategory(categoryId: number): DbDocument[] {
  return queryAll<DbDocument>(`
    SELECT d.id, d.filename, d.filepath, d.file_size, d.is_global, d.chunk_count, d.status, d.error_message, d.uploaded_by, d.created_at
    FROM documents d
    JOIN document_categories dc ON d.id = dc.document_id
    WHERE dc.category_id = ?
    ORDER BY d.created_at DESC
  `, [categoryId]);
}

/**
 * Get global documents
 */
export function getGlobalDocuments(): DbDocument[] {
  return queryAll<DbDocument>(`
    SELECT id, filename, filepath, file_size, is_global, chunk_count, status, error_message, uploaded_by, created_at
    FROM documents
    WHERE is_global = 1
    ORDER BY created_at DESC
  `);
}

/**
 * Get unassigned documents (no categories)
 */
export function getUnassignedDocuments(): DbDocument[] {
  return queryAll<DbDocument>(`
    SELECT d.id, d.filename, d.filepath, d.file_size, d.is_global, d.chunk_count, d.status, d.error_message, d.uploaded_by, d.created_at
    FROM documents d
    LEFT JOIN document_categories dc ON d.id = dc.document_id
    WHERE dc.category_id IS NULL
    ORDER BY d.created_at DESC
  `);
}

/**
 * Get documents by status
 */
export function getDocumentsByStatus(status: DocumentStatus): DbDocument[] {
  return queryAll<DbDocument>(`
    SELECT id, filename, filepath, file_size, is_global, chunk_count, status, error_message, uploaded_by, created_at
    FROM documents
    WHERE status = ?
    ORDER BY created_at DESC
  `, [status]);
}

// ============ Statistics ============

/**
 * Get total chunk count
 */
export function getTotalChunkCount(): number {
  const result = queryOne<{ total: number }>(`
    SELECT COALESCE(SUM(chunk_count), 0) as total FROM documents WHERE status = 'ready'
  `);
  return result?.total ?? 0;
}

/**
 * Get document count by status
 */
export function getDocumentCountByStatus(): { processing: number; ready: number; error: number } {
  const results = queryAll<{ status: string; count: number }>(`
    SELECT status, COUNT(*) as count FROM documents GROUP BY status
  `);

  const counts = { processing: 0, ready: 0, error: 0 };
  for (const r of results) {
    if (r.status in counts) {
      counts[r.status as keyof typeof counts] = r.count;
    }
  }
  return counts;
}

/**
 * Get total document storage size
 */
export function getTotalStorageSize(): number {
  const result = queryOne<{ total: number }>(`
    SELECT COALESCE(SUM(file_size), 0) as total FROM documents
  `);
  return result?.total ?? 0;
}

// ============ Folder Sync Operations ============

/**
 * Update document with folder sync metadata
 */
export function updateDocumentFolderSync(
  docId: number | string,
  folderSyncId: string,
  relativePath: string
): void {
  const id = typeof docId === 'string' ? parseInt(docId, 10) : docId;
  execute(`
    UPDATE documents
    SET folder_sync_id = ?, original_relative_path = ?
    WHERE id = ?
  `, [folderSyncId, relativePath, id]);
}

/**
 * Document Database Operations - Async Compatibility Layer
 *
 * Provides async wrappers that work with both SQLite and PostgreSQL.
 * - SQLite: Delegates to existing sync functions
 * - PostgreSQL: Uses Kysely query builder
 */

import { getDb, transaction } from '../kysely';
import { sql } from 'kysely';

// Re-export types
export type {
  DocumentStatus,
  DbDocument,
  DocumentWithCategories,
  CreateDocumentInput,
  UpdateDocumentInput,
} from '../documents';

import type {
  DocumentStatus,
  DbDocument,
  DocumentWithCategories,
  CreateDocumentInput,
  UpdateDocumentInput,
} from '../documents';

// ============ Document CRUD ============

export async function getAllDocuments(): Promise<DbDocument[]> {
  const db = await getDb();
  return db
    .selectFrom('documents')
    .select([
      'id',
      'filename',
      'filepath',
      'file_size',
      'is_global',
      'chunk_count',
      'status',
      'error_message',
      'uploaded_by',
      'created_at',
    ])
    .orderBy('created_at', 'desc')
    .execute() as Promise<DbDocument[]>;
}

export async function getAllDocumentsWithCategories(): Promise<DocumentWithCategories[]> {
  const db = await getDb();

  // Single query: fetch all documents with their categories via LEFT JOIN
  const rows = await db
    .selectFrom('documents as d')
    .leftJoin('document_categories as dc', 'd.id', 'dc.document_id')
    .leftJoin('categories as c', 'dc.category_id', 'c.id')
    .select([
      'd.id',
      'd.filename',
      'd.filepath',
      'd.file_size',
      'd.is_global',
      'd.chunk_count',
      'd.status',
      'd.error_message',
      'd.uploaded_by',
      'd.created_at',
      'c.id as cat_id',
      'c.name as cat_name',
      'c.slug as cat_slug',
    ])
    .orderBy('d.created_at', 'desc')
    .orderBy('c.name')
    .execute();

  // Group rows by document, collecting categories
  const docMap = new Map<number, DocumentWithCategories>();
  for (const row of rows) {
    const docId = row.id as number;
    if (!docMap.has(docId)) {
      docMap.set(docId, {
        id: docId,
        filename: row.filename as string,
        filepath: row.filepath as string,
        file_size: row.file_size as number,
        chunk_count: row.chunk_count as number,
        status: row.status as DocumentStatus,
        error_message: row.error_message as string | null,
        uploaded_by: (row.uploaded_by || '') as string,
        created_at: row.created_at as string,
        isGlobal: Boolean(row.is_global),
        categories: [],
      });
    }
    if (row.cat_id != null) {
      docMap.get(docId)!.categories.push({
        id: row.cat_id as number,
        name: row.cat_name as string,
        slug: row.cat_slug as string,
      });
    }
  }

  return Array.from(docMap.values());
}

export async function getDocumentById(id: number): Promise<DbDocument | undefined> {
  const db = await getDb();
  return db
    .selectFrom('documents')
    .select([
      'id',
      'filename',
      'filepath',
      'file_size',
      'is_global',
      'chunk_count',
      'status',
      'error_message',
      'uploaded_by',
      'created_at',
    ])
    .where('id', '=', id)
    .executeTakeFirst() as Promise<DbDocument | undefined>;
}

export async function getDocumentWithCategories(id: number): Promise<DocumentWithCategories | undefined> {
  const doc = await getDocumentById(id);
  if (!doc) return undefined;

  const db = await getDb();
  const categories = await db
    .selectFrom('categories as c')
    .innerJoin('document_categories as dc', 'c.id', 'dc.category_id')
    .select(['c.id', 'c.name', 'c.slug'])
    .where('dc.document_id', '=', id)
    .orderBy('c.name')
    .execute();

  return {
    ...doc,
    isGlobal: Boolean(doc.is_global),
    categories: categories as { id: number; name: string; slug: string }[],
  };
}

export async function createDocument(input: CreateDocumentInput): Promise<DbDocument> {
  return transaction(async (trx) => {
    const result = await trx
      .insertInto('documents')
      .values({
        filename: input.filename,
        filepath: input.filepath,
        file_size: input.fileSize,
        is_global: input.isGlobal ? 1 : 0,
        status: 'processing' as DocumentStatus,
        uploaded_by: input.uploadedBy,
      })
      .returning([
        'id',
        'filename',
        'filepath',
        'file_size',
        'is_global',
        'chunk_count',
        'status',
        'error_message',
        'uploaded_by',
        'created_at',
      ])
      .executeTakeFirstOrThrow();

    const docId = result.id;

    // Add category associations
    if (input.categoryIds && input.categoryIds.length > 0) {
      await trx
        .insertInto('document_categories')
        .values(input.categoryIds.map(cid => ({ document_id: docId, category_id: cid })))
        .execute();
    }

    return result as DbDocument;
  });
}

export async function updateDocument(
  id: number,
  input: UpdateDocumentInput
): Promise<DbDocument | undefined> {
  const updates: Record<string, unknown> = {};

  if (input.chunkCount !== undefined) {
    updates.chunk_count = input.chunkCount;
  }

  if (input.status !== undefined) {
    updates.status = input.status;
  }

  if (input.errorMessage !== undefined) {
    updates.error_message = input.errorMessage;
  }

  if (Object.keys(updates).length === 0) {
    return getDocumentById(id);
  }

  const db = await getDb();
  await db.updateTable('documents').set(updates).where('id', '=', id).execute();

  return getDocumentById(id);
}

export async function deleteDocument(id: number): Promise<boolean> {
  const db = await getDb();
  const result = await db.deleteFrom('documents').where('id', '=', id).executeTakeFirst();
  return (result.numDeletedRows ?? BigInt(0)) > BigInt(0);
}

// ============ Category Operations ============

export async function getDocumentCategories(docId: number): Promise<number[]> {
  const db = await getDb();
  const results = await db
    .selectFrom('document_categories')
    .select('category_id')
    .where('document_id', '=', docId)
    .execute();
  // category_id is NOT NULL in the table, but type system doesn't know
  return results.map((r) => r.category_id as number);
}

export async function addDocumentToCategory(docId: number, categoryId: number): Promise<boolean> {
  try {
    const db = await getDb();
    await db
      .insertInto('document_categories')
      .values({ document_id: docId, category_id: categoryId })
      .execute();
    return true;
  } catch {
    return false; // Already in category or invalid IDs
  }
}

export async function removeDocumentFromCategory(docId: number, categoryId: number): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('document_categories')
    .where('document_id', '=', docId)
    .where('category_id', '=', categoryId)
    .executeTakeFirst();
  return (result.numDeletedRows ?? BigInt(0)) > BigInt(0);
}

export async function setDocumentCategories(docId: number, categoryIds: number[]): Promise<void> {
  await transaction(async (trx) => {
    // Remove existing categories
    await trx.deleteFrom('document_categories').where('document_id', '=', docId).execute();

    // Add new categories
    if (categoryIds.length > 0) {
      await trx
        .insertInto('document_categories')
        .values(categoryIds.map(cid => ({ document_id: docId, category_id: cid })))
        .execute();
    }
  });
}

export async function setDocumentGlobal(docId: number, isGlobal: boolean): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .updateTable('documents')
    .set({ is_global: isGlobal ? 1 : 0 })
    .where('id', '=', docId)
    .executeTakeFirst();
  return (result.numUpdatedRows ?? BigInt(0)) > BigInt(0);
}

// ============ Query Helpers ============

export async function getDocumentsByCategory(categoryId: number): Promise<DbDocument[]> {
  const db = await getDb();
  return db
    .selectFrom('documents as d')
    .innerJoin('document_categories as dc', 'd.id', 'dc.document_id')
    .select([
      'd.id',
      'd.filename',
      'd.filepath',
      'd.file_size',
      'd.is_global',
      'd.chunk_count',
      'd.status',
      'd.error_message',
      'd.uploaded_by',
      'd.created_at',
    ])
    .where('dc.category_id', '=', categoryId)
    .orderBy('d.created_at', 'desc')
    .execute() as Promise<DbDocument[]>;
}

export async function getGlobalDocuments(): Promise<DbDocument[]> {
  const db = await getDb();
  return db
    .selectFrom('documents')
    .select([
      'id',
      'filename',
      'filepath',
      'file_size',
      'is_global',
      'chunk_count',
      'status',
      'error_message',
      'uploaded_by',
      'created_at',
    ])
    .where('is_global', '=', 1)
    .orderBy('created_at', 'desc')
    .execute() as Promise<DbDocument[]>;
}

export async function getUnassignedDocuments(): Promise<DbDocument[]> {
  const db = await getDb();
  return db
    .selectFrom('documents as d')
    .leftJoin('document_categories as dc', 'd.id', 'dc.document_id')
    .select([
      'd.id',
      'd.filename',
      'd.filepath',
      'd.file_size',
      'd.is_global',
      'd.chunk_count',
      'd.status',
      'd.error_message',
      'd.uploaded_by',
      'd.created_at',
    ])
    .where('dc.category_id', 'is', null)
    .orderBy('d.created_at', 'desc')
    .execute() as Promise<DbDocument[]>;
}

export async function getDocumentsByStatus(status: DocumentStatus): Promise<DbDocument[]> {
  const db = await getDb();
  return db
    .selectFrom('documents')
    .select([
      'id',
      'filename',
      'filepath',
      'file_size',
      'is_global',
      'chunk_count',
      'status',
      'error_message',
      'uploaded_by',
      'created_at',
    ])
    .where('status', '=', status)
    .orderBy('created_at', 'desc')
    .execute() as Promise<DbDocument[]>;
}

// ============ Statistics ============

export async function getTotalChunkCount(): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('documents')
    .select(sql<number>`COALESCE(SUM(chunk_count), 0)`.as('total'))
    .where('status', '=', 'ready')
    .executeTakeFirst();
  return result?.total ?? 0;
}

export async function getDocumentCountByStatus(): Promise<{
  processing: number;
  ready: number;
  error: number;
}> {
  const db = await getDb();
  const results = await db
    .selectFrom('documents')
    .select(['status', db.fn.count<number>('id').as('count')])
    .groupBy('status')
    .execute();

  const counts = { processing: 0, ready: 0, error: 0 };
  for (const r of results) {
    const status = r.status as string;
    if (status in counts) {
      counts[status as keyof typeof counts] = r.count;
    }
  }
  return counts;
}

export async function getTotalStorageSize(): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('documents')
    .select(sql<number>`COALESCE(SUM(file_size), 0)`.as('total'))
    .executeTakeFirst();
  return result?.total ?? 0;
}

// ============ Folder Sync Operations ============

/**
 * Update document with folder sync metadata
 */
export async function updateDocumentFolderSync(
  docId: number | string,
  folderSyncId: string,
  relativePath: string
): Promise<void> {
  const db = await getDb();
  const id = typeof docId === 'string' ? parseInt(docId, 10) : docId;
  await db
    .updateTable('documents')
    .set({
      folder_sync_id: folderSyncId,
      original_relative_path: relativePath,
    })
    .where('id', '=', id)
    .execute();
}

/**
 * Folder Syncs Database Operations - Async Compatibility Layer
 *
 * Provides async wrappers that work with both SQLite and PostgreSQL.
 * - SQLite: Delegates to existing sync functions
 * - PostgreSQL: Uses Kysely query builder
 */

import { getDb, transaction } from '../kysely';
import { v4 as uuidv4 } from 'uuid';

// Re-export types from sync module
export type {
  FolderSyncStatus,
  FolderSyncFileStatus,
  DbFolderSync,
  FolderSync,
  DbFolderSyncFile,
  FolderSyncFile,
  CreateFolderSyncInput,
  CreateFolderSyncFileInput,
  UpdateFolderSyncInput,
  UpdateFolderSyncFileInput,
} from '../folder-syncs';

import type {
  FolderSync,
  FolderSyncFile,
  FolderSyncFileStatus,
  CreateFolderSyncInput,
  CreateFolderSyncFileInput,
  UpdateFolderSyncInput,
  UpdateFolderSyncFileInput,
} from '../folder-syncs';

// ============ Helper Functions ============

interface DbFolderSyncRow {
  id: string;
  folder_name: string;
  original_path: string;
  uploaded_by: string;
  category_ids: string | null;
  is_global: number;
  total_files: number;
  synced_files: number;
  failed_files: number;
  status: string;
  error_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DbFolderSyncFileRow {
  id: number;
  folder_sync_id: string;
  document_id: number | null;
  relative_path: string;
  filename: string;
  file_hash: string | null;
  file_size: number;
  last_modified: number | null;
  status: string;
  error_message: string | null;
  synced_at: string | null;
  created_at: string;
}

function mapDbToFolderSync(row: DbFolderSyncRow): FolderSync {
  return {
    id: row.id,
    folderName: row.folder_name,
    originalPath: row.original_path,
    uploadedBy: row.uploaded_by,
    categoryIds: row.category_ids ? JSON.parse(row.category_ids) : [],
    isGlobal: Boolean(row.is_global),
    totalFiles: row.total_files,
    syncedFiles: row.synced_files,
    failedFiles: row.failed_files,
    status: row.status as 'active' | 'syncing' | 'error',
    errorMessage: row.error_message,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDbToFolderSyncFile(row: DbFolderSyncFileRow): FolderSyncFile {
  return {
    id: row.id,
    folderSyncId: row.folder_sync_id,
    documentId: row.document_id,
    relativePath: row.relative_path,
    filename: row.filename,
    fileHash: row.file_hash,
    fileSize: row.file_size,
    lastModified: row.last_modified,
    status: row.status as 'pending' | 'synced' | 'skipped' | 'error',
    errorMessage: row.error_message,
    syncedAt: row.synced_at,
    createdAt: row.created_at,
  };
}

// ============ Folder Sync CRUD ============

/**
 * Create a new folder sync record
 */
export async function createFolderSync(input: CreateFolderSyncInput): Promise<FolderSync> {
  const id = uuidv4();
  const db = await getDb();

  await db
    .insertInto('folder_syncs')
    .values({
      id,
      folder_name: input.folderName,
      original_path: input.originalPath,
      uploaded_by: input.uploadedBy,
      category_ids: input.categoryIds && input.categoryIds.length > 0 ? JSON.stringify(input.categoryIds) : null,
      is_global: input.isGlobal ? 1 : 0,
      status: 'active',
    })
    .execute();

  return (await getFolderSyncById(id))!;
}

/**
 * Get folder sync by ID
 */
export async function getFolderSyncById(id: string): Promise<FolderSync | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('folder_syncs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? mapDbToFolderSync(row as unknown as DbFolderSyncRow) : undefined;
}

/**
 * Get all folder syncs for a user
 */
export async function getFolderSyncsByUser(uploadedBy: string): Promise<FolderSync[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('folder_syncs')
    .selectAll()
    .where('uploaded_by', '=', uploadedBy)
    .orderBy('created_at', 'desc')
    .execute();

  return rows.map((row) => mapDbToFolderSync(row as unknown as DbFolderSyncRow));
}

/**
 * Get all folder syncs (admin)
 */
export async function getAllFolderSyncs(): Promise<FolderSync[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('folder_syncs')
    .selectAll()
    .orderBy('created_at', 'desc')
    .execute();

  return rows.map((row) => mapDbToFolderSync(row as unknown as DbFolderSyncRow));
}

/**
 * Update folder sync
 */
export async function updateFolderSync(id: string, input: UpdateFolderSyncInput): Promise<FolderSync | undefined> {
  const existing = await getFolderSyncById(id);
  if (!existing) return undefined;

  const db = await getDb();
  const updates: Record<string, unknown> = {};

  if (input.totalFiles !== undefined) updates.total_files = input.totalFiles;
  if (input.syncedFiles !== undefined) updates.synced_files = input.syncedFiles;
  if (input.failedFiles !== undefined) updates.failed_files = input.failedFiles;
  if (input.status !== undefined) updates.status = input.status;
  if (input.errorMessage !== undefined) updates.error_message = input.errorMessage;
  if (input.lastSyncedAt !== undefined) updates.last_synced_at = input.lastSyncedAt;

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  await db
    .updateTable('folder_syncs')
    .set(updates)
    .where('id', '=', id)
    .execute();

  return getFolderSyncById(id);
}

/**
 * Delete folder sync (and optionally its documents)
 */
export async function deleteFolderSync(id: string, deleteDocuments: boolean = false): Promise<boolean> {
  return transaction(async (trx) => {
    if (deleteDocuments) {
      // Get all document IDs associated with this sync
      const files = await trx
        .selectFrom('folder_sync_files')
        .select('document_id')
        .where('folder_sync_id', '=', id)
        .where('document_id', 'is not', null)
        .execute();

      // Delete the documents
      for (const file of files) {
        if (file.document_id) {
          await trx
            .deleteFrom('documents')
            .where('id', '=', file.document_id)
            .execute();
        }
      }
    }

    // Delete the folder sync (cascade deletes folder_sync_files)
    const result = await trx
      .deleteFrom('folder_syncs')
      .where('id', '=', id)
      .executeTakeFirst();

    return (result.numDeletedRows ?? 0) > 0;
  });
}

// ============ Folder Sync File CRUD ============

/**
 * Create a new folder sync file record
 */
export async function createFolderSyncFile(input: CreateFolderSyncFileInput): Promise<FolderSyncFile> {
  const db = await getDb();
  const result = await db
    .insertInto('folder_sync_files')
    .values({
      folder_sync_id: input.folderSyncId,
      relative_path: input.relativePath,
      filename: input.filename,
      file_size: input.fileSize,
      file_hash: input.fileHash || null,
      last_modified: input.lastModified || null,
      status: 'pending',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return (await getFolderSyncFileById(result.id as number))!;
}

/**
 * Batch create folder sync files (more efficient for large folders)
 */
export async function createFolderSyncFiles(inputs: CreateFolderSyncFileInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  return transaction(async (trx) => {
    await trx
      .insertInto('folder_sync_files')
      .values(inputs.map(input => ({
        folder_sync_id: input.folderSyncId,
        relative_path: input.relativePath,
        filename: input.filename,
        file_size: input.fileSize,
        file_hash: input.fileHash || null,
        last_modified: input.lastModified || null,
        status: 'pending' as const,
      })))
      .execute();
    return inputs.length;
  });
}

/**
 * Get folder sync file by ID
 */
export async function getFolderSyncFileById(id: number): Promise<FolderSyncFile | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('folder_sync_files')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? mapDbToFolderSyncFile(row as unknown as DbFolderSyncFileRow) : undefined;
}

/**
 * Get all files for a folder sync
 */
export async function getFolderSyncFiles(folderSyncId: string): Promise<FolderSyncFile[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('folder_sync_files')
    .selectAll()
    .where('folder_sync_id', '=', folderSyncId)
    .orderBy('relative_path')
    .execute();

  return rows.map((row) => mapDbToFolderSyncFile(row as unknown as DbFolderSyncFileRow));
}

/**
 * Find file by relative path within a folder sync
 */
export async function findFolderSyncFileByPath(folderSyncId: string, relativePath: string): Promise<FolderSyncFile | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('folder_sync_files')
    .selectAll()
    .where('folder_sync_id', '=', folderSyncId)
    .where('relative_path', '=', relativePath)
    .executeTakeFirst();

  return row ? mapDbToFolderSyncFile(row as unknown as DbFolderSyncFileRow) : undefined;
}

/**
 * Find file by hash within a folder sync
 */
export async function findFolderSyncFileByHash(folderSyncId: string, fileHash: string): Promise<FolderSyncFile | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('folder_sync_files')
    .selectAll()
    .where('folder_sync_id', '=', folderSyncId)
    .where('file_hash', '=', fileHash)
    .executeTakeFirst();

  return row ? mapDbToFolderSyncFile(row as unknown as DbFolderSyncFileRow) : undefined;
}

/**
 * Update folder sync file
 */
export async function updateFolderSyncFile(id: number, input: UpdateFolderSyncFileInput): Promise<FolderSyncFile | undefined> {
  const existing = await getFolderSyncFileById(id);
  if (!existing) return undefined;

  const db = await getDb();
  const updates: Record<string, unknown> = {};

  if (input.documentId !== undefined) updates.document_id = input.documentId;
  if (input.fileHash !== undefined) updates.file_hash = input.fileHash;
  if (input.status !== undefined) updates.status = input.status;
  if (input.errorMessage !== undefined) updates.error_message = input.errorMessage;
  if (input.syncedAt !== undefined) updates.synced_at = input.syncedAt;

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  await db
    .updateTable('folder_sync_files')
    .set(updates)
    .where('id', '=', id)
    .execute();

  return getFolderSyncFileById(id);
}

/**
 * Delete folder sync file
 */
export async function deleteFolderSyncFile(id: number): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('folder_sync_files')
    .where('id', '=', id)
    .executeTakeFirst();

  return (result.numDeletedRows ?? 0) > 0;
}

// ============ Statistics ============

/**
 * Get folder sync file counts by status
 */
export async function getFolderSyncFileCountsByStatus(folderSyncId: string): Promise<Record<FolderSyncFileStatus, number>> {
  const db = await getDb();
  const results = await db
    .selectFrom('folder_sync_files')
    .select(['status'])
    .select((eb) => eb.fn.count('id').as('count'))
    .where('folder_sync_id', '=', folderSyncId)
    .groupBy('status')
    .execute();

  const counts: Record<FolderSyncFileStatus, number> = {
    pending: 0,
    synced: 0,
    skipped: 0,
    error: 0,
  };

  for (const r of results) {
    counts[r.status as FolderSyncFileStatus] = Number(r.count);
  }

  return counts;
}

/**
 * Get pending files for a folder sync (for re-sync)
 */
export async function getPendingFolderSyncFiles(folderSyncId: string): Promise<FolderSyncFile[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('folder_sync_files')
    .selectAll()
    .where('folder_sync_id', '=', folderSyncId)
    .where('status', '=', 'pending')
    .orderBy('relative_path')
    .execute();

  return rows.map((row) => mapDbToFolderSyncFile(row as unknown as DbFolderSyncFileRow));
}

/**
 * Get failed files for a folder sync (for retry)
 */
export async function getFailedFolderSyncFiles(folderSyncId: string): Promise<FolderSyncFile[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('folder_sync_files')
    .selectAll()
    .where('folder_sync_id', '=', folderSyncId)
    .where('status', '=', 'error')
    .orderBy('relative_path')
    .execute();

  return rows.map((row) => mapDbToFolderSyncFile(row as unknown as DbFolderSyncFileRow));
}

/**
 * Mark all pending files as skipped (when aborting a sync)
 */
export async function markAllPendingAsSkipped(folderSyncId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .updateTable('folder_sync_files')
    .set({ status: 'skipped' })
    .where('folder_sync_id', '=', folderSyncId)
    .where('status', '=', 'pending')
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0);
}

/**
 * Reset file status to pending (for retry)
 */
export async function resetFileStatusToPending(folderSyncId: string, fileIds?: number[]): Promise<number> {
  const db = await getDb();

  if (fileIds && fileIds.length > 0) {
    // Reset specific files
    const result = await db
      .updateTable('folder_sync_files')
      .set({ status: 'pending', error_message: null })
      .where('folder_sync_id', '=', folderSyncId)
      .where('id', 'in', fileIds)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  } else {
    // Reset all error files
    const result = await db
      .updateTable('folder_sync_files')
      .set({ status: 'pending', error_message: null })
      .where('folder_sync_id', '=', folderSyncId)
      .where('status', '=', 'error')
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }
}

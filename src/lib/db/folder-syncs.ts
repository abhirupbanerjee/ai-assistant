/**
 * Folder Sync Database Operations
 *
 * CRUD operations for folder upload tracking with re-sync capability
 */

import { execute, queryAll, queryOne, transaction } from './index';
import { v4 as uuidv4 } from 'uuid';

// ============ Types ============

export type FolderSyncStatus = 'active' | 'syncing' | 'error';
export type FolderSyncFileStatus = 'pending' | 'synced' | 'skipped' | 'error';

export interface DbFolderSync {
  id: string;
  folder_name: string;
  original_path: string;
  uploaded_by: string;
  category_ids: string | null; // JSON array
  is_global: number; // SQLite boolean (0/1)
  total_files: number;
  synced_files: number;
  failed_files: number;
  status: FolderSyncStatus;
  error_message: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FolderSync {
  id: string;
  folderName: string;
  originalPath: string;
  uploadedBy: string;
  categoryIds: number[];
  isGlobal: boolean;
  totalFiles: number;
  syncedFiles: number;
  failedFiles: number;
  status: FolderSyncStatus;
  errorMessage: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DbFolderSyncFile {
  id: number;
  folder_sync_id: string;
  document_id: number | null;
  relative_path: string;
  filename: string;
  file_hash: string | null;
  file_size: number;
  last_modified: number | null;
  status: FolderSyncFileStatus;
  error_message: string | null;
  synced_at: string | null;
  created_at: string;
}

export interface FolderSyncFile {
  id: number;
  folderSyncId: string;
  documentId: number | null;
  relativePath: string;
  filename: string;
  fileHash: string | null;
  fileSize: number;
  lastModified: number | null;
  status: FolderSyncFileStatus;
  errorMessage: string | null;
  syncedAt: string | null;
  createdAt: string;
}

export interface CreateFolderSyncInput {
  folderName: string;
  originalPath: string;
  uploadedBy: string;
  categoryIds?: number[];
  isGlobal?: boolean;
}

export interface CreateFolderSyncFileInput {
  folderSyncId: string;
  relativePath: string;
  filename: string;
  fileSize: number;
  fileHash?: string;
  lastModified?: number;
}

export interface UpdateFolderSyncInput {
  totalFiles?: number;
  syncedFiles?: number;
  failedFiles?: number;
  status?: FolderSyncStatus;
  errorMessage?: string | null;
  lastSyncedAt?: string;
}

export interface UpdateFolderSyncFileInput {
  documentId?: number | null;
  fileHash?: string;
  status?: FolderSyncFileStatus;
  errorMessage?: string | null;
  syncedAt?: string;
}

// ============ Helper Functions ============

function mapDbToFolderSync(db: DbFolderSync): FolderSync {
  return {
    id: db.id,
    folderName: db.folder_name,
    originalPath: db.original_path,
    uploadedBy: db.uploaded_by,
    categoryIds: db.category_ids ? JSON.parse(db.category_ids) : [],
    isGlobal: Boolean(db.is_global),
    totalFiles: db.total_files,
    syncedFiles: db.synced_files,
    failedFiles: db.failed_files,
    status: db.status,
    errorMessage: db.error_message,
    lastSyncedAt: db.last_synced_at,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

function mapDbToFolderSyncFile(db: DbFolderSyncFile): FolderSyncFile {
  return {
    id: db.id,
    folderSyncId: db.folder_sync_id,
    documentId: db.document_id,
    relativePath: db.relative_path,
    filename: db.filename,
    fileHash: db.file_hash,
    fileSize: db.file_size,
    lastModified: db.last_modified,
    status: db.status,
    errorMessage: db.error_message,
    syncedAt: db.synced_at,
    createdAt: db.created_at,
  };
}

// ============ Folder Sync CRUD ============

/**
 * Create a new folder sync record
 */
export function createFolderSync(input: CreateFolderSyncInput): FolderSync {
  const id = uuidv4();

  execute(`
    INSERT INTO folder_syncs (id, folder_name, original_path, uploaded_by, category_ids, is_global, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `, [
    id,
    input.folderName,
    input.originalPath,
    input.uploadedBy,
    input.categoryIds && input.categoryIds.length > 0 ? JSON.stringify(input.categoryIds) : null,
    input.isGlobal ? 1 : 0,
  ]);

  return getFolderSyncById(id)!;
}

/**
 * Get folder sync by ID
 */
export function getFolderSyncById(id: string): FolderSync | undefined {
  const db = queryOne<DbFolderSync>(`
    SELECT * FROM folder_syncs WHERE id = ?
  `, [id]);

  return db ? mapDbToFolderSync(db) : undefined;
}

/**
 * Get all folder syncs for a user
 */
export function getFolderSyncsByUser(uploadedBy: string): FolderSync[] {
  const dbs = queryAll<DbFolderSync>(`
    SELECT * FROM folder_syncs
    WHERE uploaded_by = ?
    ORDER BY created_at DESC
  `, [uploadedBy]);

  return dbs.map(mapDbToFolderSync);
}

/**
 * Get all folder syncs (admin)
 */
export function getAllFolderSyncs(): FolderSync[] {
  const dbs = queryAll<DbFolderSync>(`
    SELECT * FROM folder_syncs ORDER BY created_at DESC
  `);

  return dbs.map(mapDbToFolderSync);
}

/**
 * Update folder sync
 */
export function updateFolderSync(id: string, input: UpdateFolderSyncInput): FolderSync | undefined {
  const updates: string[] = [];
  const params: unknown[] = [];

  if (input.totalFiles !== undefined) {
    updates.push('total_files = ?');
    params.push(input.totalFiles);
  }

  if (input.syncedFiles !== undefined) {
    updates.push('synced_files = ?');
    params.push(input.syncedFiles);
  }

  if (input.failedFiles !== undefined) {
    updates.push('failed_files = ?');
    params.push(input.failedFiles);
  }

  if (input.status !== undefined) {
    updates.push('status = ?');
    params.push(input.status);
  }

  if (input.errorMessage !== undefined) {
    updates.push('error_message = ?');
    params.push(input.errorMessage);
  }

  if (input.lastSyncedAt !== undefined) {
    updates.push('last_synced_at = ?');
    params.push(input.lastSyncedAt);
  }

  if (updates.length === 0) {
    return getFolderSyncById(id);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  execute(`UPDATE folder_syncs SET ${updates.join(', ')} WHERE id = ?`, params);

  return getFolderSyncById(id);
}

/**
 * Delete folder sync (and optionally its documents)
 */
export function deleteFolderSync(id: string, deleteDocuments: boolean = false): boolean {
  return transaction(() => {
    if (deleteDocuments) {
      // Get all document IDs associated with this sync
      const files = queryAll<{ document_id: number }>(`
        SELECT document_id FROM folder_sync_files
        WHERE folder_sync_id = ? AND document_id IS NOT NULL
      `, [id]);

      // Delete the documents
      for (const file of files) {
        execute('DELETE FROM documents WHERE id = ?', [file.document_id]);
      }
    }

    // Delete the folder sync (cascade deletes folder_sync_files)
    const result = execute('DELETE FROM folder_syncs WHERE id = ?', [id]);
    return result.changes > 0;
  });
}

// ============ Folder Sync File CRUD ============

/**
 * Create a new folder sync file record
 */
export function createFolderSyncFile(input: CreateFolderSyncFileInput): FolderSyncFile {
  const result = execute(`
    INSERT INTO folder_sync_files (folder_sync_id, relative_path, filename, file_size, file_hash, last_modified, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `, [
    input.folderSyncId,
    input.relativePath,
    input.filename,
    input.fileSize,
    input.fileHash || null,
    input.lastModified || null,
  ]);

  return getFolderSyncFileById(result.lastInsertRowid as number)!;
}

/**
 * Batch create folder sync files (more efficient for large folders)
 */
export function createFolderSyncFiles(inputs: CreateFolderSyncFileInput[]): number {
  return transaction(() => {
    let count = 0;
    for (const input of inputs) {
      execute(`
        INSERT INTO folder_sync_files (folder_sync_id, relative_path, filename, file_size, file_hash, last_modified, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `, [
        input.folderSyncId,
        input.relativePath,
        input.filename,
        input.fileSize,
        input.fileHash || null,
        input.lastModified || null,
      ]);
      count++;
    }
    return count;
  });
}

/**
 * Get folder sync file by ID
 */
export function getFolderSyncFileById(id: number): FolderSyncFile | undefined {
  const db = queryOne<DbFolderSyncFile>(`
    SELECT * FROM folder_sync_files WHERE id = ?
  `, [id]);

  return db ? mapDbToFolderSyncFile(db) : undefined;
}

/**
 * Get all files for a folder sync
 */
export function getFolderSyncFiles(folderSyncId: string): FolderSyncFile[] {
  const dbs = queryAll<DbFolderSyncFile>(`
    SELECT * FROM folder_sync_files
    WHERE folder_sync_id = ?
    ORDER BY relative_path
  `, [folderSyncId]);

  return dbs.map(mapDbToFolderSyncFile);
}

/**
 * Find file by relative path within a folder sync
 */
export function findFolderSyncFileByPath(folderSyncId: string, relativePath: string): FolderSyncFile | undefined {
  const db = queryOne<DbFolderSyncFile>(`
    SELECT * FROM folder_sync_files
    WHERE folder_sync_id = ? AND relative_path = ?
  `, [folderSyncId, relativePath]);

  return db ? mapDbToFolderSyncFile(db) : undefined;
}

/**
 * Find file by hash within a folder sync
 */
export function findFolderSyncFileByHash(folderSyncId: string, fileHash: string): FolderSyncFile | undefined {
  const db = queryOne<DbFolderSyncFile>(`
    SELECT * FROM folder_sync_files
    WHERE folder_sync_id = ? AND file_hash = ?
  `, [folderSyncId, fileHash]);

  return db ? mapDbToFolderSyncFile(db) : undefined;
}

/**
 * Update folder sync file
 */
export function updateFolderSyncFile(id: number, input: UpdateFolderSyncFileInput): FolderSyncFile | undefined {
  const updates: string[] = [];
  const params: unknown[] = [];

  if (input.documentId !== undefined) {
    updates.push('document_id = ?');
    params.push(input.documentId);
  }

  if (input.fileHash !== undefined) {
    updates.push('file_hash = ?');
    params.push(input.fileHash);
  }

  if (input.status !== undefined) {
    updates.push('status = ?');
    params.push(input.status);
  }

  if (input.errorMessage !== undefined) {
    updates.push('error_message = ?');
    params.push(input.errorMessage);
  }

  if (input.syncedAt !== undefined) {
    updates.push('synced_at = ?');
    params.push(input.syncedAt);
  }

  if (updates.length === 0) {
    return getFolderSyncFileById(id);
  }

  params.push(id);
  execute(`UPDATE folder_sync_files SET ${updates.join(', ')} WHERE id = ?`, params);

  return getFolderSyncFileById(id);
}

/**
 * Delete folder sync file
 */
export function deleteFolderSyncFile(id: number): boolean {
  const result = execute('DELETE FROM folder_sync_files WHERE id = ?', [id]);
  return result.changes > 0;
}

// ============ Statistics ============

/**
 * Get folder sync file counts by status
 */
export function getFolderSyncFileCountsByStatus(folderSyncId: string): Record<FolderSyncFileStatus, number> {
  const results = queryAll<{ status: FolderSyncFileStatus; count: number }>(`
    SELECT status, COUNT(*) as count
    FROM folder_sync_files
    WHERE folder_sync_id = ?
    GROUP BY status
  `, [folderSyncId]);

  const counts: Record<FolderSyncFileStatus, number> = {
    pending: 0,
    synced: 0,
    skipped: 0,
    error: 0,
  };

  for (const r of results) {
    counts[r.status] = r.count;
  }

  return counts;
}

/**
 * Get pending files for a folder sync (for re-sync)
 */
export function getPendingFolderSyncFiles(folderSyncId: string): FolderSyncFile[] {
  const dbs = queryAll<DbFolderSyncFile>(`
    SELECT * FROM folder_sync_files
    WHERE folder_sync_id = ? AND status = 'pending'
    ORDER BY relative_path
  `, [folderSyncId]);

  return dbs.map(mapDbToFolderSyncFile);
}

/**
 * Get failed files for a folder sync (for retry)
 */
export function getFailedFolderSyncFiles(folderSyncId: string): FolderSyncFile[] {
  const dbs = queryAll<DbFolderSyncFile>(`
    SELECT * FROM folder_sync_files
    WHERE folder_sync_id = ? AND status = 'error'
    ORDER BY relative_path
  `, [folderSyncId]);

  return dbs.map(mapDbToFolderSyncFile);
}

/**
 * Mark all pending files as skipped (when aborting a sync)
 */
export function markAllPendingAsSkipped(folderSyncId: string): number {
  const result = execute(`
    UPDATE folder_sync_files
    SET status = 'skipped'
    WHERE folder_sync_id = ? AND status = 'pending'
  `, [folderSyncId]);

  return result.changes;
}

/**
 * Reset file status to pending (for retry)
 */
export function resetFileStatusToPending(folderSyncId: string, fileIds?: number[]): number {
  if (fileIds && fileIds.length > 0) {
    // Reset specific files
    const placeholders = fileIds.map(() => '?').join(',');
    const result = execute(`
      UPDATE folder_sync_files
      SET status = 'pending', error_message = NULL
      WHERE folder_sync_id = ? AND id IN (${placeholders})
    `, [folderSyncId, ...fileIds]);
    return result.changes;
  } else {
    // Reset all error files
    const result = execute(`
      UPDATE folder_sync_files
      SET status = 'pending', error_message = NULL
      WHERE folder_sync_id = ? AND status = 'error'
    `, [folderSyncId]);
    return result.changes;
  }
}

/**
 * Reindex Job Manager
 *
 * Handles background reindexing of documents when embedding model changes.
 * Stores job state in SQLite for persistence across restarts.
 */

import { execute, queryOne, queryAll } from './db/index';
import { getEmbeddingSettings, setEmbeddingSettings } from './db/config';
import { listGlobalDocuments, reindexDocument } from './ingest';
import { getVectorStore } from './vector-store';
import { clearAllCache } from './redis';
import { getEmbeddingModelDimensions } from './constants';

// Job status types
export type ReindexJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// Job interface
export interface ReindexJob {
  id: string;
  status: ReindexJobStatus;
  targetModel: string;
  targetDimensions: number;
  previousModel: string;
  previousDimensions: number;
  totalDocuments: number;
  processedDocuments: number;
  failedDocuments: number;
  errors: string[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdBy: string;
}

// Database row type
interface ReindexJobRow {
  id: string;
  status: string;
  target_model: string;
  target_dimensions: number;
  previous_model: string;
  previous_dimensions: number;
  total_documents: number;
  processed_documents: number;
  failed_documents: number;
  errors: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  created_by: string;
}

// Singleton for running job (only one reindex at a time)
let runningJobId: string | null = null;
let jobAborted = false;

/**
 * Initialize the reindex_jobs table
 */
export function initReindexJobsTable(): void {
  execute(`
    CREATE TABLE IF NOT EXISTS reindex_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      target_model TEXT NOT NULL,
      target_dimensions INTEGER NOT NULL,
      previous_model TEXT NOT NULL,
      previous_dimensions INTEGER NOT NULL,
      total_documents INTEGER DEFAULT 0,
      processed_documents INTEGER DEFAULT 0,
      failed_documents INTEGER DEFAULT 0,
      errors TEXT DEFAULT '[]',
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT NOT NULL
    )
  `);
}

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
  return `reindex_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Convert database row to Job object
 */
function rowToJob(row: ReindexJobRow): ReindexJob {
  return {
    id: row.id,
    status: row.status as ReindexJobStatus,
    targetModel: row.target_model,
    targetDimensions: row.target_dimensions,
    previousModel: row.previous_model,
    previousDimensions: row.previous_dimensions,
    totalDocuments: row.total_documents,
    processedDocuments: row.processed_documents,
    failedDocuments: row.failed_documents,
    errors: JSON.parse(row.errors || '[]'),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

/**
 * Get a reindex job by ID
 */
export function getReindexJob(jobId: string): ReindexJob | null {
  const row = queryOne<ReindexJobRow>(
    'SELECT * FROM reindex_jobs WHERE id = ?',
    [jobId]
  );
  return row ? rowToJob(row) : null;
}

/**
 * Get the currently running reindex job (if any)
 */
export function getRunningReindexJob(): ReindexJob | null {
  const row = queryOne<ReindexJobRow>(
    "SELECT * FROM reindex_jobs WHERE status = 'running' ORDER BY created_at DESC LIMIT 1"
  );
  return row ? rowToJob(row) : null;
}

/**
 * Get recent reindex jobs
 */
export function getRecentReindexJobs(limit: number = 10): ReindexJob[] {
  const rows = queryAll<ReindexJobRow>(
    'SELECT * FROM reindex_jobs ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
  return rows.map(rowToJob);
}

/**
 * Check if a reindex job is currently running
 */
export function isReindexRunning(): boolean {
  const job = getRunningReindexJob();
  return job !== null;
}

/**
 * Create a new reindex job
 */
export function createReindexJob(
  targetModel: string,
  createdBy: string
): ReindexJob {
  // Check if a job is already running
  if (isReindexRunning()) {
    throw new Error('A reindex job is already running');
  }

  // Get current settings
  const currentSettings = getEmbeddingSettings();
  const targetDimensions = getEmbeddingModelDimensions(targetModel);

  // Initialize table if needed
  initReindexJobsTable();

  const jobId = generateJobId();

  execute(`
    INSERT INTO reindex_jobs (
      id, status, target_model, target_dimensions,
      previous_model, previous_dimensions, created_by
    ) VALUES (?, 'pending', ?, ?, ?, ?, ?)
  `, [
    jobId,
    targetModel,
    targetDimensions,
    currentSettings.model,
    currentSettings.dimensions,
    createdBy,
  ]);

  return getReindexJob(jobId)!;
}

/**
 * Update job progress
 */
function updateJobProgress(
  jobId: string,
  processedDocuments: number,
  failedDocuments: number,
  errors: string[]
): void {
  execute(`
    UPDATE reindex_jobs
    SET processed_documents = ?,
        failed_documents = ?,
        errors = ?
    WHERE id = ?
  `, [processedDocuments, failedDocuments, JSON.stringify(errors), jobId]);
}

/**
 * Update job status
 */
function updateJobStatus(
  jobId: string,
  status: ReindexJobStatus,
  completedAt?: string
): void {
  if (completedAt) {
    execute(`
      UPDATE reindex_jobs
      SET status = ?, completed_at = ?
      WHERE id = ?
    `, [status, completedAt, jobId]);
  } else {
    execute(`
      UPDATE reindex_jobs
      SET status = ?
      WHERE id = ?
    `, [status, jobId]);
  }
}

/**
 * Cancel a running reindex job
 */
export function cancelReindexJob(jobId: string): boolean {
  const job = getReindexJob(jobId);
  if (!job || job.status !== 'running') {
    return false;
  }

  jobAborted = true;
  updateJobStatus(jobId, 'cancelled', new Date().toISOString());
  runningJobId = null;

  return true;
}

/**
 * Run the reindex job
 * This is called asynchronously after the API returns
 */
export async function runReindexJob(jobId: string): Promise<void> {
  const job = getReindexJob(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  if (job.status !== 'pending') {
    throw new Error(`Job ${jobId} is not in pending status`);
  }

  // Set as running
  runningJobId = jobId;
  jobAborted = false;

  execute(`
    UPDATE reindex_jobs
    SET status = 'running',
        started_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [jobId]);

  try {
    console.log(`[Reindex] Starting job ${jobId}: ${job.previousModel} -> ${job.targetModel}`);

    // Step 1: Update embedding settings first
    setEmbeddingSettings({
      model: job.targetModel,
      dimensions: job.targetDimensions,
    }, job.createdBy);
    console.log(`[Reindex] Updated embedding settings to ${job.targetModel} (${job.targetDimensions} dimensions)`);

    // Step 2: Clear Redis cache
    await clearAllCache();
    console.log('[Reindex] Cleared Redis cache');

    // Step 3: Get all documents to reindex
    const documents = await listGlobalDocuments();
    const totalDocuments = documents.length;

    execute(`
      UPDATE reindex_jobs
      SET total_documents = ?
      WHERE id = ?
    `, [totalDocuments, jobId]);

    console.log(`[Reindex] Found ${totalDocuments} documents to reindex`);

    if (totalDocuments === 0) {
      // No documents to reindex, mark as complete
      updateJobStatus(jobId, 'completed', new Date().toISOString());
      runningJobId = null;
      console.log('[Reindex] No documents to reindex, job completed');
      return;
    }

    // Step 4: Delete all existing vector store collections if dimensions changed
    if (job.previousDimensions !== job.targetDimensions) {
      console.log(`[Reindex] Dimensions changed (${job.previousDimensions} -> ${job.targetDimensions}), recreating collections`);
      const vectorStore = await getVectorStore();
      const collections = await vectorStore.listCollections();

      for (const collection of collections) {
        try {
          await vectorStore.deleteCollection(collection);
          console.log(`[Reindex] Deleted collection: ${collection}`);
        } catch (error) {
          console.warn(`[Reindex] Failed to delete collection ${collection}:`, error);
        }
      }
    }

    // Step 5: Reindex all documents
    let processedDocuments = 0;
    let failedDocuments = 0;
    const errors: string[] = [];

    for (const doc of documents) {
      // Check if job was cancelled
      if (jobAborted) {
        console.log('[Reindex] Job was cancelled');
        break;
      }

      try {
        await reindexDocument(doc.id);
        processedDocuments++;
        console.log(`[Reindex] Reindexed ${doc.filename} (${processedDocuments}/${totalDocuments})`);
      } catch (error) {
        failedDocuments++;
        const errorMsg = `${doc.filename}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(`[Reindex] Failed to reindex ${doc.filename}:`, error);
      }

      // Update progress
      updateJobProgress(jobId, processedDocuments, failedDocuments, errors);
    }

    // Step 6: Mark job as completed or failed
    if (jobAborted) {
      updateJobStatus(jobId, 'cancelled', new Date().toISOString());
      console.log('[Reindex] Job cancelled');
    } else if (failedDocuments > 0 && failedDocuments === totalDocuments) {
      updateJobStatus(jobId, 'failed', new Date().toISOString());
      console.log('[Reindex] Job failed - all documents failed');
    } else {
      updateJobStatus(jobId, 'completed', new Date().toISOString());
      console.log(`[Reindex] Job completed: ${processedDocuments} succeeded, ${failedDocuments} failed`);
    }
  } catch (error) {
    console.error('[Reindex] Job failed with error:', error);
    updateJobStatus(jobId, 'failed', new Date().toISOString());

    // Store the error
    const errors = [error instanceof Error ? error.message : 'Unknown error'];
    updateJobProgress(jobId, 0, 0, errors);
  } finally {
    runningJobId = null;
    jobAborted = false;
  }
}

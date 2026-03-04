/**
 * Reindex Job Manager
 *
 * Handles background reindexing of documents when embedding model changes.
 * Stores job state in PostgreSQL via Kysely for persistence across restarts.
 */

import { getDb } from './db/kysely';
import { sql } from 'kysely';
import { getEmbeddingSettings, setEmbeddingSettings } from './db/compat/config';
import { listGlobalDocuments, reindexDocument } from './ingest';
import { getVectorStore } from './vector-store';
import { clearAllCache } from './redis';
import { getEmbeddingModelDimensions } from './constants';
import { isLocalEmbeddingModel, resetLocalEmbedder } from './local-embeddings';

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
 * No-op: table creation is handled by Kysely migrations in kysely.ts
 */
export async function initReindexJobsTable(): Promise<void> {
  // Table is created by runPostgresMigrations() in kysely.ts
  return;
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
export async function getReindexJob(jobId: string): Promise<ReindexJob | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('reindex_jobs')
    .selectAll()
    .where('id', '=', jobId)
    .executeTakeFirst();

  return row ? rowToJob(row as unknown as ReindexJobRow) : null;
}

/**
 * Get the currently running reindex job (if any)
 */
export async function getRunningReindexJob(): Promise<ReindexJob | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('reindex_jobs')
    .selectAll()
    .where('status', '=', 'running')
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();

  return row ? rowToJob(row as unknown as ReindexJobRow) : null;
}

/**
 * Get recent reindex jobs
 */
export async function getRecentReindexJobs(limit: number = 10): Promise<ReindexJob[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('reindex_jobs')
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map((row) => rowToJob(row as unknown as ReindexJobRow));
}

/**
 * Check if a reindex job is currently running
 */
export async function isReindexRunning(): Promise<boolean> {
  const job = await getRunningReindexJob();
  return job !== null;
}

/**
 * Create a new reindex job
 */
export async function createReindexJob(
  targetModel: string,
  createdBy: string
): Promise<ReindexJob> {
  // Check if a job is already running
  if (await isReindexRunning()) {
    throw new Error('A reindex job is already running');
  }

  // Get current settings
  const currentSettings = await getEmbeddingSettings();
  const targetDimensions = getEmbeddingModelDimensions(targetModel);

  const jobId = generateJobId();

  const db = await getDb();
  await db
    .insertInto('reindex_jobs')
    .values({
      id: jobId,
      target_model: targetModel,
      target_dimensions: targetDimensions,
      previous_model: currentSettings.model,
      previous_dimensions: currentSettings.dimensions,
      created_by: createdBy,
    })
    .execute();

  return (await getReindexJob(jobId))!;
}

/**
 * Update job progress
 */
async function updateJobProgress(
  jobId: string,
  processedDocuments: number,
  failedDocuments: number,
  errors: string[]
): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('reindex_jobs')
    .set({
      processed_documents: processedDocuments,
      failed_documents: failedDocuments,
      errors: JSON.stringify(errors),
    })
    .where('id', '=', jobId)
    .execute();
}

/**
 * Update job status
 */
async function updateJobStatus(
  jobId: string,
  status: ReindexJobStatus,
  completedAt?: string
): Promise<void> {
  const db = await getDb();
  if (completedAt) {
    await db
      .updateTable('reindex_jobs')
      .set({ status, completed_at: completedAt })
      .where('id', '=', jobId)
      .execute();
  } else {
    await db
      .updateTable('reindex_jobs')
      .set({ status })
      .where('id', '=', jobId)
      .execute();
  }
}

/**
 * Cancel a running reindex job
 */
export async function cancelReindexJob(jobId: string): Promise<boolean> {
  const job = await getReindexJob(jobId);
  if (!job || job.status !== 'running') {
    return false;
  }

  jobAborted = true;
  await updateJobStatus(jobId, 'cancelled', new Date().toISOString());
  runningJobId = null;

  return true;
}

/**
 * Run the reindex job
 * This is called asynchronously after the API returns
 */
export async function runReindexJob(jobId: string): Promise<void> {
  const job = await getReindexJob(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  if (job.status !== 'pending') {
    throw new Error(`Job ${jobId} is not in pending status`);
  }

  // Set as running
  runningJobId = jobId;
  jobAborted = false;

  const db = await getDb();
  await sql`
    UPDATE reindex_jobs
    SET status = 'running',
        started_at = CURRENT_TIMESTAMP
    WHERE id = ${jobId}
  `.execute(db);

  try {
    console.log(`[Reindex] Starting job ${jobId}: ${job.previousModel} -> ${job.targetModel}`);

    // Step 1: Delete ALL vector store collections FIRST (before changing settings)
    // Different embedding models produce incompatible vectors, even with same dimensions
    // We must clear all collections to avoid dimension/embedding mismatches
    console.log(`[Reindex] Deleting all vector store collections...`);
    const vectorStore = await getVectorStore();
    const collections = await vectorStore.listCollections();

    console.log(`[Reindex] Found ${collections.length} collections to delete: ${collections.join(', ') || '(none)'}`);

    // Delete collections with retry logic
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const collectionsToDelete = await vectorStore.listCollections();

      if (collectionsToDelete.length === 0) {
        console.log(`[Reindex] All collections deleted successfully`);
        break;
      }

      console.log(`[Reindex] Attempt ${attempt}/${MAX_RETRIES}: Deleting ${collectionsToDelete.length} collections...`);

      for (const collection of collectionsToDelete) {
        try {
          await vectorStore.deleteCollection(collection);
          console.log(`[Reindex] Deleted collection: ${collection}`);
        } catch (error) {
          console.error(`[Reindex] Failed to delete collection ${collection}:`, error);
        }
      }

      // Verify deletion
      const remainingCollections = await vectorStore.listCollections();

      if (remainingCollections.length === 0) {
        console.log(`[Reindex] All collections deleted successfully on attempt ${attempt}`);
        break;
      }

      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Failed to delete all vector store collections after ${MAX_RETRIES} attempts. ` +
          `Remaining: ${remainingCollections.join(', ')}. ` +
          `Please check vector store connectivity and try again.`
        );
      }

      // Wait before retry with exponential backoff
      const delay = RETRY_DELAY_MS * attempt;
      console.log(`[Reindex] ${remainingCollections.length} collections remain, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Step 2: Reset local embedder if switching to a local model
    // This clears any previous load failure state
    if (isLocalEmbeddingModel(job.targetModel)) {
      resetLocalEmbedder();
      console.log(`[Reindex] Reset local embedder for ${job.targetModel}`);
    }

    // Step 3: Update embedding settings (safe because collections are empty)
    await setEmbeddingSettings({
      model: job.targetModel,
      dimensions: job.targetDimensions,
    }, job.createdBy);
    console.log(`[Reindex] Updated embedding settings to ${job.targetModel} (${job.targetDimensions} dimensions)`);

    // Step 4: Clear Redis cache
    await clearAllCache();
    console.log('[Reindex] Cleared Redis cache');

    // Step 5: Get all documents to reindex
    const documents = await listGlobalDocuments();
    const totalDocuments = documents.length;

    await db
      .updateTable('reindex_jobs')
      .set({ total_documents: totalDocuments })
      .where('id', '=', jobId)
      .execute();

    console.log(`[Reindex] Found ${totalDocuments} documents to reindex`);

    if (totalDocuments === 0) {
      // No documents to reindex, mark as complete
      await updateJobStatus(jobId, 'completed', new Date().toISOString());
      runningJobId = null;
      console.log('[Reindex] No documents to reindex, job completed');
      return;
    }

    // Step 6: Reindex all documents (collections will be auto-created with correct dimensions)
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
      await updateJobProgress(jobId, processedDocuments, failedDocuments, errors);
    }

    // Step 6: Mark job as completed or failed
    if (jobAborted) {
      await updateJobStatus(jobId, 'cancelled', new Date().toISOString());
      console.log('[Reindex] Job cancelled');
    } else if (failedDocuments > 0 && failedDocuments === totalDocuments) {
      await updateJobStatus(jobId, 'failed', new Date().toISOString());
      console.log('[Reindex] Job failed - all documents failed');
    } else {
      await updateJobStatus(jobId, 'completed', new Date().toISOString());
      console.log(`[Reindex] Job completed: ${processedDocuments} succeeded, ${failedDocuments} failed`);
    }
  } catch (error) {
    console.error('[Reindex] Job failed with error:', error);
    await updateJobStatus(jobId, 'failed', new Date().toISOString());

    // Store the error
    const errors = [error instanceof Error ? error.message : 'Unknown error'];
    await updateJobProgress(jobId, 0, 0, errors);
  } finally {
    runningJobId = null;
    jobAborted = false;
  }
}

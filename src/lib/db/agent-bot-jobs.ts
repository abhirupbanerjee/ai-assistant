/**
 * Agent Bot Job Database Operations
 *
 * Handles job creation, status tracking, output storage,
 * and file management for agent bot executions.
 */

import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, execute, transaction } from './index';
import type {
  AgentBotJob,
  AgentBotJobWithOutputs,
  AgentBotJobRow,
  AgentBotJobOutput,
  AgentBotJobOutputRow,
  AgentBotJobFile,
  AgentBotJobFileRow,
  JobStatus,
  OutputType,
  TokenUsage,
  FileExtractionStatus,
} from '@/types/agent-bot';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert database row to AgentBotJob object
 */
function rowToJob(row: AgentBotJobRow): AgentBotJob {
  return {
    id: row.id,
    agent_bot_id: row.agent_bot_id,
    version_id: row.version_id,
    api_key_id: row.api_key_id,
    status: row.status as JobStatus,
    input_json: JSON.parse(row.input_json),
    input_files_json: row.input_files_json ? JSON.parse(row.input_files_json) : null,
    output_type: row.output_type as OutputType,
    webhook_url: row.webhook_url,
    webhook_secret: row.webhook_secret,
    priority: row.priority,
    started_at: row.started_at,
    completed_at: row.completed_at,
    error_message: row.error_message,
    error_code: row.error_code,
    processing_time_ms: row.processing_time_ms,
    token_usage_json: row.token_usage_json ? JSON.parse(row.token_usage_json) : null,
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

/**
 * Convert database row to AgentBotJobOutput object
 */
function rowToOutput(row: AgentBotJobOutputRow): AgentBotJobOutput {
  return {
    id: row.id,
    job_id: row.job_id,
    output_type: row.output_type as OutputType,
    content: row.content,
    filename: row.filename,
    filepath: row.filepath,
    file_size: row.file_size,
    mime_type: row.mime_type,
    metadata_json: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    created_at: row.created_at,
  };
}

/**
 * Convert database row to AgentBotJobFile object
 */
function rowToFile(row: AgentBotJobFileRow): AgentBotJobFile {
  return {
    id: row.id,
    job_id: row.job_id,
    original_filename: row.original_filename,
    stored_filepath: row.stored_filepath,
    file_size: row.file_size,
    mime_type: row.mime_type,
    extracted_text: row.extracted_text,
    extraction_status: row.extraction_status as FileExtractionStatus,
    created_at: row.created_at,
  };
}

// ============================================================================
// Job CRUD
// ============================================================================

/**
 * Get job by ID
 */
export function getJobById(id: string): AgentBotJob | null {
  const row = queryOne<AgentBotJobRow>(
    'SELECT * FROM agent_bot_jobs WHERE id = ?',
    [id]
  );
  return row ? rowToJob(row) : null;
}

/**
 * Get job with outputs and input files
 */
export function getJobWithOutputs(id: string): AgentBotJobWithOutputs | null {
  const job = getJobById(id);
  if (!job) return null;

  const outputRows = queryAll<AgentBotJobOutputRow>(
    'SELECT * FROM agent_bot_job_outputs WHERE job_id = ? ORDER BY created_at',
    [id]
  );

  const fileRows = queryAll<AgentBotJobFileRow>(
    'SELECT * FROM agent_bot_job_files WHERE job_id = ? ORDER BY created_at',
    [id]
  );

  return {
    ...job,
    outputs: outputRows.map(rowToOutput),
    input_files: fileRows.map(rowToFile),
  };
}

/**
 * Create a new job
 */
export function createJob(params: {
  agentBotId: string;
  versionId: string;
  apiKeyId: string;
  inputJson: Record<string, unknown>;
  outputType: OutputType;
  webhookUrl?: string;
  webhookSecret?: string;
  priority?: number;
  expiresInHours?: number;
}): AgentBotJob {
  const id = uuidv4();

  // Calculate expiration
  let expiresAt: string | null = null;
  if (params.expiresInHours) {
    const expireDate = new Date();
    expireDate.setHours(expireDate.getHours() + params.expiresInHours);
    expiresAt = expireDate.toISOString();
  }

  execute(
    `INSERT INTO agent_bot_jobs (
      id, agent_bot_id, version_id, api_key_id, status,
      input_json, output_type, webhook_url, webhook_secret, priority, expires_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.agentBotId,
      params.versionId,
      params.apiKeyId,
      JSON.stringify(params.inputJson),
      params.outputType,
      params.webhookUrl || null,
      params.webhookSecret || null,
      params.priority ?? 100,
      expiresAt,
    ]
  );

  return getJobById(id)!;
}

/**
 * Update job status to running
 */
export function startJob(id: string): AgentBotJob | null {
  execute(
    `UPDATE agent_bot_jobs
     SET status = 'running', started_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'pending'`,
    [id]
  );
  return getJobById(id);
}

/**
 * Complete a job successfully
 */
export function completeJob(
  id: string,
  tokenUsage?: TokenUsage,
  processingTimeMs?: number
): AgentBotJob | null {
  execute(
    `UPDATE agent_bot_jobs
     SET status = 'completed',
         completed_at = CURRENT_TIMESTAMP,
         token_usage_json = ?,
         processing_time_ms = ?
     WHERE id = ?`,
    [
      tokenUsage ? JSON.stringify(tokenUsage) : null,
      processingTimeMs ?? null,
      id,
    ]
  );
  return getJobById(id);
}

/**
 * Fail a job with error
 */
export function failJob(
  id: string,
  errorMessage: string,
  errorCode: string,
  tokenUsage?: TokenUsage,
  processingTimeMs?: number
): AgentBotJob | null {
  execute(
    `UPDATE agent_bot_jobs
     SET status = 'failed',
         completed_at = CURRENT_TIMESTAMP,
         error_message = ?,
         error_code = ?,
         token_usage_json = ?,
         processing_time_ms = ?
     WHERE id = ?`,
    [
      errorMessage,
      errorCode,
      tokenUsage ? JSON.stringify(tokenUsage) : null,
      processingTimeMs ?? null,
      id,
    ]
  );
  return getJobById(id);
}

/**
 * Cancel a pending job
 */
export function cancelJob(id: string): AgentBotJob | null {
  const job = getJobById(id);
  if (!job || job.status !== 'pending') return null;

  execute(
    `UPDATE agent_bot_jobs
     SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'pending'`,
    [id]
  );
  return getJobById(id);
}

/**
 * List jobs for an agent bot
 */
export function listJobs(
  agentBotId: string,
  options?: {
    status?: JobStatus;
    limit?: number;
    offset?: number;
  }
): AgentBotJob[] {
  let sql = 'SELECT * FROM agent_bot_jobs WHERE agent_bot_id = ?';
  const params: unknown[] = [agentBotId];

  if (options?.status) {
    sql += ' AND status = ?';
    params.push(options.status);
  }

  sql += ' ORDER BY created_at DESC';

  if (options?.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
    if (options?.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }
  }

  const rows = queryAll<AgentBotJobRow>(sql, params);
  return rows.map(rowToJob);
}

/**
 * List pending jobs (for job processor)
 */
export function listPendingJobs(limit = 10): AgentBotJob[] {
  const rows = queryAll<AgentBotJobRow>(
    `SELECT * FROM agent_bot_jobs
     WHERE status = 'pending'
     ORDER BY priority DESC, created_at ASC
     LIMIT ?`,
    [limit]
  );
  return rows.map(rowToJob);
}

/**
 * Get job count by status for an agent bot
 */
export function getJobCountsByStatus(agentBotId: string): Record<JobStatus, number> {
  const rows = queryAll<{ status: string; count: number }>(
    `SELECT status, COUNT(*) as count
     FROM agent_bot_jobs
     WHERE agent_bot_id = ?
     GROUP BY status`,
    [agentBotId]
  );

  const counts: Record<JobStatus, number> = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const row of rows) {
    counts[row.status as JobStatus] = row.count;
  }

  return counts;
}

// ============================================================================
// Job Outputs
// ============================================================================

/**
 * Add an output to a job
 */
export function addJobOutput(params: {
  jobId: string;
  outputType: OutputType;
  content?: string;
  filename?: string;
  filepath?: string;
  fileSize?: number;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}): AgentBotJobOutput {
  const id = uuidv4();

  execute(
    `INSERT INTO agent_bot_job_outputs (
      id, job_id, output_type, content, filename, filepath, file_size, mime_type, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.jobId,
      params.outputType,
      params.content || null,
      params.filename || null,
      params.filepath || null,
      params.fileSize || null,
      params.mimeType || null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ]
  );

  const row = queryOne<AgentBotJobOutputRow>(
    'SELECT * FROM agent_bot_job_outputs WHERE id = ?',
    [id]
  );
  return rowToOutput(row!);
}

/**
 * Get outputs for a job
 */
export function getJobOutputs(jobId: string): AgentBotJobOutput[] {
  const rows = queryAll<AgentBotJobOutputRow>(
    'SELECT * FROM agent_bot_job_outputs WHERE job_id = ? ORDER BY created_at',
    [jobId]
  );
  return rows.map(rowToOutput);
}

/**
 * Get a specific output by ID
 */
export function getOutputById(id: string): AgentBotJobOutput | null {
  const row = queryOne<AgentBotJobOutputRow>(
    'SELECT * FROM agent_bot_job_outputs WHERE id = ?',
    [id]
  );
  return row ? rowToOutput(row) : null;
}

// ============================================================================
// Job Input Files
// ============================================================================

/**
 * Add an input file to a job
 */
export function addJobFile(params: {
  jobId: string;
  originalFilename: string;
  storedFilepath: string;
  fileSize: number;
  mimeType: string;
}): AgentBotJobFile {
  const id = uuidv4();

  execute(
    `INSERT INTO agent_bot_job_files (
      id, job_id, original_filename, stored_filepath, file_size, mime_type, extraction_status
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [
      id,
      params.jobId,
      params.originalFilename,
      params.storedFilepath,
      params.fileSize,
      params.mimeType,
    ]
  );

  const row = queryOne<AgentBotJobFileRow>(
    'SELECT * FROM agent_bot_job_files WHERE id = ?',
    [id]
  );
  return rowToFile(row!);
}

/**
 * Get input files for a job
 */
export function getJobFiles(jobId: string): AgentBotJobFile[] {
  const rows = queryAll<AgentBotJobFileRow>(
    'SELECT * FROM agent_bot_job_files WHERE job_id = ? ORDER BY created_at',
    [jobId]
  );
  return rows.map(rowToFile);
}

/**
 * Update file extraction status
 */
export function updateFileExtractionStatus(
  id: string,
  status: FileExtractionStatus,
  extractedText?: string
): AgentBotJobFile | null {
  execute(
    `UPDATE agent_bot_job_files
     SET extraction_status = ?, extracted_text = ?
     WHERE id = ?`,
    [status, extractedText || null, id]
  );

  const row = queryOne<AgentBotJobFileRow>(
    'SELECT * FROM agent_bot_job_files WHERE id = ?',
    [id]
  );
  return row ? rowToFile(row) : null;
}

/**
 * Get a specific file by ID
 */
export function getFileById(id: string): AgentBotJobFile | null {
  const row = queryOne<AgentBotJobFileRow>(
    'SELECT * FROM agent_bot_job_files WHERE id = ?',
    [id]
  );
  return row ? rowToFile(row) : null;
}

/**
 * Update job with input files JSON
 */
export function updateJobInputFiles(jobId: string, fileIds: string[]): void {
  execute(
    'UPDATE agent_bot_jobs SET input_files_json = ? WHERE id = ?',
    [JSON.stringify(fileIds), jobId]
  );
}

// ============================================================================
// Analytics & Cleanup
// ============================================================================

/**
 * Get job statistics for a date range
 */
export function getJobStats(
  agentBotId: string,
  startDate: string,
  endDate: string
): {
  total: number;
  completed: number;
  failed: number;
  avgProcessingTimeMs: number;
  totalTokens: number;
} {
  const stats = queryOne<{
    total: number;
    completed: number;
    failed: number;
    avg_processing_time: number;
  }>(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      AVG(processing_time_ms) as avg_processing_time
     FROM agent_bot_jobs
     WHERE agent_bot_id = ?
       AND DATE(created_at) >= ?
       AND DATE(created_at) <= ?`,
    [agentBotId, startDate, endDate]
  );

  // Calculate total tokens from completed jobs
  const tokenResult = queryOne<{ total_tokens: number }>(
    `SELECT SUM(
      CAST(JSON_EXTRACT(token_usage_json, '$.totalTokens') AS INTEGER)
    ) as total_tokens
     FROM agent_bot_jobs
     WHERE agent_bot_id = ?
       AND DATE(created_at) >= ?
       AND DATE(created_at) <= ?
       AND status = 'completed'
       AND token_usage_json IS NOT NULL`,
    [agentBotId, startDate, endDate]
  );

  return {
    total: stats?.total || 0,
    completed: stats?.completed || 0,
    failed: stats?.failed || 0,
    avgProcessingTimeMs: Math.round(stats?.avg_processing_time || 0),
    totalTokens: tokenResult?.total_tokens || 0,
  };
}

/**
 * Get output type distribution for an agent bot
 */
export function getOutputTypeDistribution(
  agentBotId: string,
  startDate: string,
  endDate: string
): { type: OutputType; count: number }[] {
  const rows = queryAll<{ output_type: string; count: number }>(
    `SELECT output_type, COUNT(*) as count
     FROM agent_bot_jobs
     WHERE agent_bot_id = ?
       AND DATE(created_at) >= ?
       AND DATE(created_at) <= ?
       AND status = 'completed'
     GROUP BY output_type
     ORDER BY count DESC`,
    [agentBotId, startDate, endDate]
  );

  return rows.map((r) => ({
    type: r.output_type as OutputType,
    count: r.count,
  }));
}

/**
 * Clean up expired jobs
 */
export function cleanupExpiredJobs(): number {
  const result = execute(
    `DELETE FROM agent_bot_jobs
     WHERE expires_at IS NOT NULL
       AND expires_at < CURRENT_TIMESTAMP
       AND status IN ('completed', 'failed', 'cancelled')`,
    []
  );
  return result.changes;
}

/**
 * Clean up old jobs (for maintenance)
 */
export function cleanupOldJobs(daysToKeep = 30): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoff = cutoffDate.toISOString();

  const result = execute(
    `DELETE FROM agent_bot_jobs
     WHERE created_at < ?
       AND status IN ('completed', 'failed', 'cancelled')`,
    [cutoff]
  );
  return result.changes;
}

/**
 * Get jobs requiring webhook delivery (for retry processor)
 */
export function getJobsNeedingWebhookDelivery(): AgentBotJob[] {
  const rows = queryAll<AgentBotJobRow>(
    `SELECT * FROM agent_bot_jobs
     WHERE status IN ('completed', 'failed')
       AND webhook_url IS NOT NULL
       AND completed_at IS NOT NULL
     ORDER BY completed_at ASC
     LIMIT 100`,
    []
  );
  return rows.map(rowToJob);
}

/**
 * List jobs for an agent bot (for admin UI)
 */
export function listJobsForAgentBot(agentBotId: string, limit = 50): AgentBotJob[] {
  const rows = queryAll<AgentBotJobRow>(
    `SELECT * FROM agent_bot_jobs
     WHERE agent_bot_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [agentBotId, limit]
  );
  return rows.map(rowToJob);
}

/**
 * Get usage statistics for an agent bot
 */
export function getUsageStats(
  agentBotId: string,
  days = 30
): {
  totalRequests: number;
  totalTokens: number;
  totalErrors: number;
  dailyStats: Array<{
    date: string;
    requests: number;
    tokens: number;
    errors: number;
  }>;
} {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoff = cutoffDate.toISOString().split('T')[0];

  // Get totals
  const totals = queryOne<{
    total_requests: number;
    total_errors: number;
  }>(
    `SELECT
      COUNT(*) as total_requests,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as total_errors
     FROM agent_bot_jobs
     WHERE agent_bot_id = ?
       AND DATE(created_at) >= ?`,
    [agentBotId, cutoff]
  );

  // Get total tokens
  const tokenResult = queryOne<{ total_tokens: number }>(
    `SELECT SUM(
      CAST(JSON_EXTRACT(token_usage_json, '$.totalTokens') AS INTEGER)
    ) as total_tokens
     FROM agent_bot_jobs
     WHERE agent_bot_id = ?
       AND DATE(created_at) >= ?
       AND token_usage_json IS NOT NULL`,
    [agentBotId, cutoff]
  );

  // Get daily breakdown
  const dailyRows = queryAll<{
    date: string;
    requests: number;
    tokens: number;
    errors: number;
  }>(
    `SELECT
      DATE(created_at) as date,
      COUNT(*) as requests,
      COALESCE(SUM(CAST(JSON_EXTRACT(token_usage_json, '$.totalTokens') AS INTEGER)), 0) as tokens,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as errors
     FROM agent_bot_jobs
     WHERE agent_bot_id = ?
       AND DATE(created_at) >= ?
     GROUP BY DATE(created_at)
     ORDER BY date DESC`,
    [agentBotId, cutoff]
  );

  return {
    totalRequests: totals?.total_requests || 0,
    totalTokens: tokenResult?.total_tokens || 0,
    totalErrors: totals?.total_errors || 0,
    dailyStats: dailyRows,
  };
}

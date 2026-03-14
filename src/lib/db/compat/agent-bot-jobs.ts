/**
 * Agent Bot Job Database Operations - Async Compatibility Layer
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'kysely';

// Re-export types from the types file
export type {
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

// ============ Helper Functions ============

function rowToJob(row: AgentBotJobRow): AgentBotJob {
  return {
    id: row.id,
    agent_bot_id: row.agent_bot_id,
    version_id: row.version_id,
    api_key_id: row.api_key_id,
    status: row.status as JobStatus,
    input_json: typeof row.input_json === 'string' ? JSON.parse(row.input_json) : row.input_json,
    input_files_json: row.input_files_json
      ? (typeof row.input_files_json === 'string'
          ? JSON.parse(row.input_files_json)
          : row.input_files_json)
      : null,
    output_type: row.output_type as OutputType,
    webhook_url: row.webhook_url,
    webhook_secret: row.webhook_secret,
    priority: row.priority,
    started_at: row.started_at,
    completed_at: row.completed_at,
    error_message: row.error_message,
    error_code: row.error_code,
    processing_time_ms: row.processing_time_ms,
    token_usage_json: row.token_usage_json
      ? (typeof row.token_usage_json === 'string'
          ? JSON.parse(row.token_usage_json)
          : row.token_usage_json)
      : null,
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

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
    metadata_json: row.metadata_json
      ? (typeof row.metadata_json === 'string'
          ? JSON.parse(row.metadata_json)
          : row.metadata_json)
      : null,
    created_at: row.created_at,
  };
}

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

// ============ Job CRUD ============

export async function getJobById(id: string): Promise<AgentBotJob | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('agent_bot_jobs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? rowToJob(row as AgentBotJobRow) : null;
}

export async function getJobWithOutputs(id: string): Promise<AgentBotJobWithOutputs | null> {
  const job = await getJobById(id);
  if (!job) return null;

  const db = await getDb();

  const outputRows = await db
    .selectFrom('agent_bot_job_outputs')
    .selectAll()
    .where('job_id', '=', id)
    .orderBy('created_at', 'asc')
    .execute();

  const fileRows = await db
    .selectFrom('agent_bot_job_files')
    .selectAll()
    .where('job_id', '=', id)
    .orderBy('created_at', 'asc')
    .execute();

  return {
    ...job,
    outputs: outputRows.map((r) => rowToOutput(r as AgentBotJobOutputRow)),
    input_files: fileRows.map((r) => rowToFile(r as AgentBotJobFileRow)),
  };
}

export async function createJob(params: {
  agentBotId: string;
  versionId: string;
  apiKeyId: string;
  inputJson: Record<string, unknown>;
  outputType: OutputType;
  webhookUrl?: string;
  webhookSecret?: string;
  priority?: number;
  expiresInHours?: number;
}): Promise<AgentBotJob> {
  const db = await getDb();
  const id = uuidv4();

  // Calculate expiration
  let expiresAt: string | null = null;
  if (params.expiresInHours) {
    const expireDate = new Date();
    expireDate.setHours(expireDate.getHours() + params.expiresInHours);
    expiresAt = expireDate.toISOString();
  }

  await db
    .insertInto('agent_bot_jobs')
    .values({
      id,
      agent_bot_id: params.agentBotId,
      version_id: params.versionId,
      api_key_id: params.apiKeyId,
      status: 'pending',
      input_json: JSON.stringify(params.inputJson),
      output_type: params.outputType,
      webhook_url: params.webhookUrl || null,
      webhook_secret: params.webhookSecret || null,
      priority: params.priority ?? 100,
      expires_at: expiresAt,
    })
    .execute();

  return (await getJobById(id))!;
}

export async function startJob(id: string): Promise<AgentBotJob | null> {
  const db = await getDb();
  await db
    .updateTable('agent_bot_jobs')
    .set({ status: 'running', started_at: sql`NOW()` })
    .where('id', '=', id)
    .where('status', '=', 'pending')
    .execute();

  return getJobById(id);
}

export async function completeJob(
  id: string,
  tokenUsage?: TokenUsage,
  processingTimeMs?: number
): Promise<AgentBotJob | null> {
  const db = await getDb();
  await db
    .updateTable('agent_bot_jobs')
    .set({
      status: 'completed',
      completed_at: sql`NOW()`,
      token_usage_json: tokenUsage ? JSON.stringify(tokenUsage) : null,
      processing_time_ms: processingTimeMs ?? null,
    })
    .where('id', '=', id)
    .execute();

  return getJobById(id);
}

export async function failJob(
  id: string,
  errorMessage: string,
  errorCode: string,
  tokenUsage?: TokenUsage,
  processingTimeMs?: number
): Promise<AgentBotJob | null> {
  const db = await getDb();
  await db
    .updateTable('agent_bot_jobs')
    .set({
      status: 'failed',
      completed_at: sql`NOW()`,
      error_message: errorMessage,
      error_code: errorCode,
      token_usage_json: tokenUsage ? JSON.stringify(tokenUsage) : null,
      processing_time_ms: processingTimeMs ?? null,
    })
    .where('id', '=', id)
    .execute();

  return getJobById(id);
}

export async function cancelJob(id: string): Promise<AgentBotJob | null> {
  const job = await getJobById(id);
  if (!job || job.status !== 'pending') return null;

  const db = await getDb();
  await db
    .updateTable('agent_bot_jobs')
    .set({ status: 'cancelled', completed_at: sql`NOW()` })
    .where('id', '=', id)
    .where('status', '=', 'pending')
    .execute();

  return getJobById(id);
}

export async function listJobs(
  agentBotId: string,
  options?: {
    status?: JobStatus;
    limit?: number;
    offset?: number;
  }
): Promise<AgentBotJob[]> {
  const db = await getDb();
  let query = db
    .selectFrom('agent_bot_jobs')
    .selectAll()
    .where('agent_bot_id', '=', agentBotId);

  if (options?.status) {
    query = query.where('status', '=', options.status);
  }

  query = query.orderBy('created_at', 'desc');

  if (options?.limit) {
    query = query.limit(options.limit);
    if (options?.offset) {
      query = query.offset(options.offset);
    }
  }

  const rows = await query.execute();
  return rows.map((r) => rowToJob(r as AgentBotJobRow));
}

export async function listPendingJobs(limit = 10): Promise<AgentBotJob[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent_bot_jobs')
    .selectAll()
    .where('status', '=', 'pending')
    .orderBy('priority', 'desc')
    .orderBy('created_at', 'asc')
    .limit(limit)
    .execute();

  return rows.map((r) => rowToJob(r as AgentBotJobRow));
}

export async function getJobCountsByStatus(agentBotId: string): Promise<Record<JobStatus, number>> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent_bot_jobs')
    .select(['status', db.fn.count<number>('id').as('count')])
    .where('agent_bot_id', '=', agentBotId)
    .groupBy('status')
    .execute();

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

export async function listJobsForAgentBot(agentBotId: string, limit = 50): Promise<AgentBotJob[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent_bot_jobs')
    .selectAll()
    .where('agent_bot_id', '=', agentBotId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map((r) => rowToJob(r as AgentBotJobRow));
}

// ============ Job Outputs ============

export async function addJobOutput(params: {
  jobId: string;
  outputType: OutputType;
  content?: string;
  filename?: string;
  filepath?: string;
  fileSize?: number;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}): Promise<AgentBotJobOutput> {
  const db = await getDb();
  const id = uuidv4();

  await db
    .insertInto('agent_bot_job_outputs')
    .values({
      id,
      job_id: params.jobId,
      output_type: params.outputType,
      content: params.content || null,
      filename: params.filename || null,
      filepath: params.filepath || null,
      file_size: params.fileSize || null,
      mime_type: params.mimeType || null,
      metadata_json: params.metadata ? JSON.stringify(params.metadata) : null,
    })
    .execute();

  const row = await db
    .selectFrom('agent_bot_job_outputs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return rowToOutput(row as AgentBotJobOutputRow);
}

export async function getJobOutputs(jobId: string): Promise<AgentBotJobOutput[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent_bot_job_outputs')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'asc')
    .execute();

  return rows.map((r) => rowToOutput(r as AgentBotJobOutputRow));
}

export async function getOutputById(id: string): Promise<AgentBotJobOutput | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('agent_bot_job_outputs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? rowToOutput(row as AgentBotJobOutputRow) : null;
}

// ============ Job Input Files ============

export async function addJobFile(params: {
  jobId: string;
  originalFilename: string;
  storedFilepath: string;
  fileSize: number;
  mimeType: string;
}): Promise<AgentBotJobFile> {
  const db = await getDb();
  const id = uuidv4();

  await db
    .insertInto('agent_bot_job_files')
    .values({
      id,
      job_id: params.jobId,
      original_filename: params.originalFilename,
      stored_filepath: params.storedFilepath,
      file_size: params.fileSize,
      mime_type: params.mimeType,
      extraction_status: 'pending',
    })
    .execute();

  const row = await db
    .selectFrom('agent_bot_job_files')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return rowToFile(row as AgentBotJobFileRow);
}

export async function getJobFiles(jobId: string): Promise<AgentBotJobFile[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent_bot_job_files')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'asc')
    .execute();

  return rows.map((r) => rowToFile(r as AgentBotJobFileRow));
}

export async function updateFileExtractionStatus(
  id: string,
  status: FileExtractionStatus,
  extractedText?: string
): Promise<AgentBotJobFile | null> {
  const db = await getDb();
  await db
    .updateTable('agent_bot_job_files')
    .set({ extraction_status: status, extracted_text: extractedText || null })
    .where('id', '=', id)
    .execute();

  const row = await db
    .selectFrom('agent_bot_job_files')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? rowToFile(row as AgentBotJobFileRow) : null;
}

export async function getFileById(id: string): Promise<AgentBotJobFile | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('agent_bot_job_files')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? rowToFile(row as AgentBotJobFileRow) : null;
}

export async function updateJobInputFiles(jobId: string, fileIds: string[]): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('agent_bot_jobs')
    .set({ input_files_json: JSON.stringify(fileIds) })
    .where('id', '=', jobId)
    .execute();
}

// ============ Analytics & Cleanup ============

export async function getJobStats(
  agentBotId: string,
  startDate: string,
  endDate: string
): Promise<{
  total: number;
  completed: number;
  failed: number;
  avgProcessingTimeMs: number;
  totalTokens: number;
}> {
  const db = await getDb();

  const stats = await db
    .selectFrom('agent_bot_jobs')
    .select([
      db.fn.count<number>('id').as('total'),
      sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`.as('completed'),
      sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`.as('failed'),
      db.fn.avg<number>('processing_time_ms').as('avg_processing_time'),
    ])
    .where('agent_bot_id', '=', agentBotId)
    .where(sql`DATE(created_at)`, '>=', startDate)
    .where(sql`DATE(created_at)`, '<=', endDate)
    .executeTakeFirst();

  const tokenResult = await db
    .selectFrom('agent_bot_jobs')
    .select(sql<number>`SUM((token_usage_json::jsonb->>'totalTokens')::int)`.as('total_tokens'))
    .where('agent_bot_id', '=', agentBotId)
    .where(sql`DATE(created_at)`, '>=', startDate)
    .where(sql`DATE(created_at)`, '<=', endDate)
    .where('status', '=', 'completed')
    .where('token_usage_json', 'is not', null)
    .executeTakeFirst();

  return {
    total: stats?.total || 0,
    completed: stats?.completed || 0,
    failed: stats?.failed || 0,
    avgProcessingTimeMs: Math.round(stats?.avg_processing_time || 0),
    totalTokens: tokenResult?.total_tokens || 0,
  };
}

export async function getUsageStats(
  agentBotId: string,
  days = 30
): Promise<{
  totalRequests: number;
  totalTokens: number;
  totalErrors: number;
  dailyStats: Array<{
    date: string;
    requests: number;
    tokens: number;
    errors: number;
  }>;
}> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoff = cutoffDate.toISOString().split('T')[0];

  const db = await getDb();

  // Get totals
  const totals = await db
    .selectFrom('agent_bot_jobs')
    .select([
      db.fn.count<number>('id').as('total_requests'),
      sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`.as('total_errors'),
    ])
    .where('agent_bot_id', '=', agentBotId)
    .where(sql`DATE(created_at)`, '>=', cutoff)
    .executeTakeFirst();

  // Get total tokens
  const tokenResult = await db
    .selectFrom('agent_bot_jobs')
    .select(sql<number>`SUM((token_usage_json::jsonb->>'totalTokens')::int)`.as('total_tokens'))
    .where('agent_bot_id', '=', agentBotId)
    .where(sql`DATE(created_at)`, '>=', cutoff)
    .where('token_usage_json', 'is not', null)
    .executeTakeFirst();

  // Get daily breakdown
  const dailyRows = await db
    .selectFrom('agent_bot_jobs')
    .select([
      sql<string>`DATE(created_at)`.as('date'),
      db.fn.count<number>('id').as('requests'),
      sql<number>`COALESCE(SUM((token_usage_json::jsonb->>'totalTokens')::int), 0)`.as('tokens'),
      sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`.as('errors'),
    ])
    .where('agent_bot_id', '=', agentBotId)
    .where(sql`DATE(created_at)`, '>=', cutoff)
    .groupBy(sql`DATE(created_at)`)
    .orderBy(sql`DATE(created_at)`, 'desc')
    .execute();

  return {
    totalRequests: totals?.total_requests || 0,
    totalTokens: tokenResult?.total_tokens || 0,
    totalErrors: totals?.total_errors || 0,
    dailyStats: dailyRows.map((r) => ({
      date: r.date,
      requests: r.requests,
      tokens: r.tokens,
      errors: r.errors,
    })),
  };
}

export async function getOutputTypeDistribution(
  agentBotId: string,
  startDate: string,
  endDate: string
): Promise<{ type: OutputType; count: number }[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent_bot_jobs')
    .select(['output_type', db.fn.count<number>('id').as('count')])
    .where('agent_bot_id', '=', agentBotId)
    .where(sql`DATE(created_at)`, '>=', startDate)
    .where(sql`DATE(created_at)`, '<=', endDate)
    .where('status', '=', 'completed')
    .groupBy('output_type')
    .orderBy(db.fn.count('id'), 'desc')
    .execute();

  return rows.map((r) => ({
    type: r.output_type as OutputType,
    count: r.count,
  }));
}

export async function cleanupExpiredJobs(): Promise<number> {
  const db = await getDb();
  const result = await db
    .deleteFrom('agent_bot_jobs')
    .where('expires_at', 'is not', null)
    .where('expires_at', '<', new Date().toISOString())
    .where('status', 'in', ['completed', 'failed', 'cancelled'])
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0);
}

export async function cleanupOldJobs(daysToKeep = 30): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoff = cutoffDate.toISOString();

  const db = await getDb();
  const result = await db
    .deleteFrom('agent_bot_jobs')
    .where('created_at', '<', cutoff)
    .where('status', 'in', ['completed', 'failed', 'cancelled'])
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0);
}

export async function getJobsNeedingWebhookDelivery(): Promise<AgentBotJob[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('agent_bot_jobs')
    .selectAll()
    .where('status', 'in', ['completed', 'failed'])
    .where('webhook_url', 'is not', null)
    .where('completed_at', 'is not', null)
    .orderBy('completed_at', 'asc')
    .limit(100)
    .execute();

  return rows.map((r) => rowToJob(r as AgentBotJobRow));
}

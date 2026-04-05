/**
 * Thread Database Operations
 *
 * Uses Kysely query builder for PostgreSQL.
 */

import { getDb, transaction } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'kysely';
import type { Source, ToolCall, GeneratedDocumentInfo, MessageVisualization, GeneratedImageInfo, PodcastHint, DiagramHint } from '@/types';

// Re-export types
export type {
  DbThread,
  DbMessage,
  DbThreadUpload,
  DbThreadOutput,
  ThreadWithDetails,
  ParsedMessage,
} from '../threads';

import type {
  DbThread,
  DbMessage,
  DbThreadUpload,
  DbThreadOutput,
  ThreadWithDetails,
  ParsedMessage,
} from '../threads';

// ============ Helper Functions ============

function parseMessage(msg: DbMessage): ParsedMessage {
  return {
    id: msg.id,
    threadId: msg.thread_id,
    role: msg.role,
    content: msg.content,
    sources: msg.sources_json ? JSON.parse(msg.sources_json) : null,
    attachments: msg.attachments_json ? JSON.parse(msg.attachments_json) : null,
    toolCalls: msg.tool_calls_json ? JSON.parse(msg.tool_calls_json) : null,
    toolCallId: msg.tool_call_id,
    toolName: msg.tool_name,
    generatedDocuments: msg.generated_documents_json ? JSON.parse(msg.generated_documents_json) : null,
    visualizations: msg.visualizations_json ? JSON.parse(msg.visualizations_json) : null,
    generatedImages: msg.generated_images_json ? JSON.parse(msg.generated_images_json) : null,
    generatedDiagrams: msg.generated_diagrams_json ? JSON.parse(msg.generated_diagrams_json) : null,
    generatedPodcasts: msg.generated_podcasts_json ? JSON.parse(msg.generated_podcasts_json) : null,
    metadata: msg.metadata_json ? JSON.parse(msg.metadata_json) : null,
    createdAt: new Date(msg.created_at),
  };
}

// ============ Thread CRUD ============

export async function createThread(
  userId: number,
  title: string = 'New Conversation',
  categoryIds: number[] = []
): Promise<DbThread> {
  const threadId = uuidv4();

  return transaction(async (trx) => {
    await trx
      .insertInto('threads')
      .values({
        id: threadId,
        user_id: userId,
        title,
      })
      .execute();

    if (categoryIds.length > 0) {
      await trx
        .insertInto('thread_categories')
        .values(categoryIds.map(cid => ({ thread_id: threadId, category_id: cid })))
        .execute();
    }

    const thread = await trx
      .selectFrom('threads')
      .select(['id', 'user_id', 'title', 'selected_model', 'created_at', 'updated_at', 'is_summarized', 'total_tokens', 'is_pinned'])
      .where('id', '=', threadId)
      .executeTakeFirstOrThrow();

    return thread as DbThread;
  });
}

export async function getThreadById(threadId: string): Promise<DbThread | undefined> {
  const db = await getDb();
  return db
    .selectFrom('threads')
    .select(['id', 'user_id', 'title', 'selected_model', 'created_at', 'updated_at', 'is_summarized', 'total_tokens', 'is_pinned'])
    .where('id', '=', threadId)
    .executeTakeFirst() as Promise<DbThread | undefined>;
}

export async function getThreadWithDetails(threadId: string): Promise<ThreadWithDetails | undefined> {
  const thread = await getThreadById(threadId);
  if (!thread) return undefined;

  const db = await getDb();

  const [messageCountResult, uploadCountResult, categories] = await Promise.all([
    db
      .selectFrom('messages')
      .select(db.fn.count<number>('id').as('count'))
      .where('thread_id', '=', threadId)
      .executeTakeFirst(),
    db
      .selectFrom('thread_uploads')
      .select(db.fn.count<number>('id').as('count'))
      .where('thread_id', '=', threadId)
      .executeTakeFirst(),
    db
      .selectFrom('categories as c')
      .innerJoin('thread_categories as tc', 'c.id', 'tc.category_id')
      .select(['c.id', 'c.name', 'c.slug'])
      .where('tc.thread_id', '=', threadId)
      .orderBy('c.name')
      .execute(),
  ]);

  return {
    ...thread,
    messageCount: messageCountResult?.count ?? 0,
    uploadCount: uploadCountResult?.count ?? 0,
    categories: categories as { id: number; name: string; slug: string }[],
  };
}

export async function getThreadsForUser(
  userId: number,
  limit: number = 50,
  offset: number = 0
): Promise<ThreadWithDetails[]> {
  const db = await getDb();
  const threads = await db
    .selectFrom('threads')
    .select(['id', 'user_id', 'title', 'selected_model', 'created_at', 'updated_at', 'is_summarized', 'total_tokens', 'is_pinned'])
    .where('user_id', '=', userId)
    .orderBy('is_pinned', 'desc')
    .orderBy('updated_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  const result: ThreadWithDetails[] = [];
  for (const thread of threads) {
    const [messageCountResult, uploadCountResult, categories] = await Promise.all([
      db
        .selectFrom('messages')
        .select(db.fn.count<number>('id').as('count'))
        .where('thread_id', '=', thread.id)
        .executeTakeFirst(),
      db
        .selectFrom('thread_uploads')
        .select(db.fn.count<number>('id').as('count'))
        .where('thread_id', '=', thread.id)
        .executeTakeFirst(),
      db
        .selectFrom('categories as c')
        .innerJoin('thread_categories as tc', 'c.id', 'tc.category_id')
        .select(['c.id', 'c.name', 'c.slug'])
        .where('tc.thread_id', '=', thread.id)
        .orderBy('c.name')
        .execute(),
    ]);

    result.push({
      ...thread as DbThread,
      messageCount: messageCountResult?.count ?? 0,
      uploadCount: uploadCountResult?.count ?? 0,
      categories: categories as { id: number; name: string; slug: string }[],
    });
  }

  return result;
}

export async function getThreadCountForUser(userId: number): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('threads')
    .select(db.fn.count<number>('id').as('count'))
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return result?.count ?? 0;
}

export async function updateThreadTitle(threadId: string, title: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .updateTable('threads')
    .set({ title })
    .where('id', '=', threadId)
    .executeTakeFirst();
  return (result.numUpdatedRows ?? BigInt(0)) > BigInt(0);
}

export async function toggleThreadPin(threadId: string): Promise<boolean> {
  const thread = await getThreadById(threadId);
  if (!thread) return false;

  const newPinStatus = thread.is_pinned ? 0 : 1;
  const db = await getDb();
  const result = await db
    .updateTable('threads')
    .set({ is_pinned: newPinStatus })
    .where('id', '=', threadId)
    .executeTakeFirst();

  return (result.numUpdatedRows ?? BigInt(0)) > BigInt(0);
}

export async function updateThreadModel(threadId: string, selectedModel: string | null): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .updateTable('threads')
    .set({
      selected_model: selectedModel,
      updated_at: sql`NOW()`,
    })
    .where('id', '=', threadId)
    .executeTakeFirst();
  return (result.numUpdatedRows ?? BigInt(0)) > BigInt(0);
}

export async function getEffectiveModelForThread(threadId: string): Promise<string | null> {
  // Check thread for model override, then fall back to global default
  const db = await getDb();
  const thread = await db
    .selectFrom('threads')
    .select('selected_model')
    .where('id', '=', threadId)
    .executeTakeFirst();

  if (thread?.selected_model) {
    return thread.selected_model as string;
  }

  // No override — get default model from enabled_models
  const { getDefaultModel } = await import('./enabled-models');
  const defaultModel = await getDefaultModel();
  return defaultModel?.id || null;
}

export async function deleteThread(threadId: string): Promise<{ messageCount: number; uploadCount: number }> {
  return transaction(async (trx) => {
    const [messageCountResult, uploadCountResult] = await Promise.all([
      trx
        .selectFrom('messages')
        .select(trx.fn.count<number>('id').as('count'))
        .where('thread_id', '=', threadId)
        .executeTakeFirst(),
      trx
        .selectFrom('thread_uploads')
        .select(trx.fn.count<number>('id').as('count'))
        .where('thread_id', '=', threadId)
        .executeTakeFirst(),
    ]);

    // Delete cascade will handle messages, uploads, outputs, and categories
    await trx.deleteFrom('threads').where('id', '=', threadId).execute();

    return {
      messageCount: messageCountResult?.count ?? 0,
      uploadCount: uploadCountResult?.count ?? 0,
    };
  });
}

export async function userOwnsThread(userId: number, threadId: string): Promise<boolean> {
  const thread = await getThreadById(threadId);
  return thread?.user_id === userId;
}

export async function getThreadOwner(threadId: string): Promise<{ user_id: number } | undefined> {
  const db = await getDb();
  return db
    .selectFrom('threads')
    .select('user_id')
    .where('id', '=', threadId)
    .executeTakeFirst();
}

// ============ Thread Categories ============

export async function getThreadCategories(threadId: string): Promise<number[]> {
  const db = await getDb();
  const results = await db
    .selectFrom('thread_categories')
    .select('category_id')
    .where('thread_id', '=', threadId)
    .execute();
  return results.map((r) => r.category_id);
}

export async function getThreadCategorySlugs(threadId: string): Promise<string[]> {
  const db = await getDb();
  const results = await db
    .selectFrom('categories as c')
    .innerJoin('thread_categories as tc', 'c.id', 'tc.category_id')
    .select('c.slug')
    .where('tc.thread_id', '=', threadId)
    .execute();
  const slugs = results.map((r) => r.slug);
  console.log('[DB] getThreadCategorySlugs:', { threadId, slugs, resultCount: results.length });
  return slugs;
}

export async function setThreadCategories(threadId: string, categoryIds: number[]): Promise<void> {
  await transaction(async (trx) => {
    await trx.deleteFrom('thread_categories').where('thread_id', '=', threadId).execute();

    if (categoryIds.length > 0) {
      await trx
        .insertInto('thread_categories')
        .values(categoryIds.map(cid => ({ thread_id: threadId, category_id: cid })))
        .execute();
    }
  });
}

// ============ Messages ============

export async function addMessage(
  threadId: string,
  role: 'user' | 'assistant' | 'tool',
  content: string,
  options?: {
    messageId?: string;
    sources?: Source[];
    attachments?: string[];
    toolCalls?: ToolCall[];
    toolCallId?: string;
    toolName?: string;
    generatedDocuments?: GeneratedDocumentInfo[];
    visualizations?: MessageVisualization[];
    generatedImages?: GeneratedImageInfo[];
    generatedDiagrams?: DiagramHint[];
    generatedPodcasts?: PodcastHint[];
    metadataJson?: string;
  }
): Promise<ParsedMessage> {
  const messageId = options?.messageId || uuidv4();
  const db = await getDb();

  await db
    .insertInto('messages')
    .values({
      id: messageId,
      thread_id: threadId,
      role,
      content,
      sources_json: options?.sources ? JSON.stringify(options.sources) : null,
      attachments_json: options?.attachments ? JSON.stringify(options.attachments) : null,
      tool_calls_json: options?.toolCalls ? JSON.stringify(options.toolCalls) : null,
      tool_call_id: options?.toolCallId || null,
      tool_name: options?.toolName || null,
      generated_documents_json: options?.generatedDocuments ? JSON.stringify(options.generatedDocuments) : null,
      visualizations_json: options?.visualizations ? JSON.stringify(options.visualizations) : null,
      generated_images_json: options?.generatedImages ? JSON.stringify(options.generatedImages) : null,
      generated_diagrams_json: options?.generatedDiagrams ? JSON.stringify(options.generatedDiagrams) : null,
      generated_podcasts_json: options?.generatedPodcasts ? JSON.stringify(options.generatedPodcasts) : null,
      metadata_json: options?.metadataJson || null,
    })
    .execute();

  const msg = await getMessageById(messageId);
  return msg!;
}

export async function getMessageById(messageId: string): Promise<ParsedMessage | undefined> {
  const db = await getDb();
  const msg = await db
    .selectFrom('messages')
    .select([
      'id',
      'thread_id',
      'role',
      'content',
      'sources_json',
      'attachments_json',
      'tool_calls_json',
      'tool_call_id',
      'tool_name',
      'generated_documents_json',
      'visualizations_json',
      'generated_images_json',
      'generated_diagrams_json',
      'generated_podcasts_json',
      'metadata_json',
      'created_at',
    ])
    .where('id', '=', messageId)
    .executeTakeFirst();

  if (!msg) return undefined;
  return parseMessage(msg as DbMessage);
}

export async function getMessagesForThread(threadId: string): Promise<ParsedMessage[]> {
  const db = await getDb();
  const messages = await db
    .selectFrom('messages')
    .select([
      'id',
      'thread_id',
      'role',
      'content',
      'sources_json',
      'attachments_json',
      'tool_calls_json',
      'tool_call_id',
      'tool_name',
      'generated_documents_json',
      'visualizations_json',
      'generated_images_json',
      'generated_diagrams_json',
      'generated_podcasts_json',
      'metadata_json',
      'created_at',
    ])
    .where('thread_id', '=', threadId)
    .orderBy('created_at', 'asc')
    .execute();

  return messages.map((msg) => parseMessage(msg as DbMessage));
}

// ============ Thread Uploads ============

export async function addThreadUpload(
  threadId: string,
  filename: string,
  filepath: string,
  fileSize: number
): Promise<DbThreadUpload> {
  const db = await getDb();
  const result = await db
    .insertInto('thread_uploads')
    .values({
      thread_id: threadId,
      filename,
      filepath,
      file_size: fileSize,
    })
    .returning(['id', 'thread_id', 'filename', 'filepath', 'file_size', 'uploaded_at'])
    .executeTakeFirstOrThrow();

  return result as DbThreadUpload;
}

export async function getThreadUploadById(uploadId: number): Promise<DbThreadUpload | undefined> {
  const db = await getDb();
  return db
    .selectFrom('thread_uploads')
    .select(['id', 'thread_id', 'filename', 'filepath', 'file_size', 'uploaded_at'])
    .where('id', '=', uploadId)
    .executeTakeFirst() as Promise<DbThreadUpload | undefined>;
}

export async function getThreadUploads(threadId: string): Promise<DbThreadUpload[]> {
  const db = await getDb();
  return db
    .selectFrom('thread_uploads')
    .select(['id', 'thread_id', 'filename', 'filepath', 'file_size', 'uploaded_at'])
    .where('thread_id', '=', threadId)
    .orderBy('uploaded_at', 'asc')
    .execute() as Promise<DbThreadUpload[]>;
}

export async function getThreadUploadCount(threadId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('thread_uploads')
    .select(db.fn.count<number>('id').as('count'))
    .where('thread_id', '=', threadId)
    .executeTakeFirst();
  return result?.count ?? 0;
}

export async function deleteThreadUpload(uploadId: number): Promise<boolean> {
  const db = await getDb();
  const result = await db.deleteFrom('thread_uploads').where('id', '=', uploadId).executeTakeFirst();
  return (result.numDeletedRows ?? BigInt(0)) > BigInt(0);
}

// ============ Thread Outputs ============

export async function addThreadOutput(
  threadId: string,
  messageId: string | null,
  filename: string,
  filepath: string,
  fileType: 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'md' | 'mp3' | 'wav',
  fileSize: number,
  generationConfig?: string,
  expiresAt?: string | null
): Promise<DbThreadOutput> {
  const db = await getDb();
  const result = await db
    .insertInto('thread_outputs')
    .values({
      thread_id: threadId,
      message_id: messageId,
      filename,
      filepath,
      file_type: fileType,
      file_size: fileSize,
      generation_config: generationConfig ?? null,
      expires_at: expiresAt ?? null,
    })
    .returning(['id', 'thread_id', 'message_id', 'filename', 'filepath', 'file_type', 'file_size', 'created_at'])
    .executeTakeFirstOrThrow();

  return result as DbThreadOutput;
}

export async function getThreadOutputById(outputId: number): Promise<DbThreadOutput | undefined> {
  const db = await getDb();
  return db
    .selectFrom('thread_outputs')
    .select(['id', 'thread_id', 'message_id', 'filename', 'filepath', 'file_type', 'file_size', 'created_at'])
    .where('id', '=', outputId)
    .executeTakeFirst() as Promise<DbThreadOutput | undefined>;
}

export async function getThreadOutputs(threadId: string): Promise<DbThreadOutput[]> {
  const db = await getDb();
  return db
    .selectFrom('thread_outputs')
    .select(['id', 'thread_id', 'message_id', 'filename', 'filepath', 'file_type', 'file_size', 'created_at'])
    .where('thread_id', '=', threadId)
    .orderBy('created_at', 'asc')
    .execute() as Promise<DbThreadOutput[]>;
}

export async function linkOutputsToMessage(threadId: string, messageId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .updateTable('thread_outputs')
    .set({ message_id: messageId })
    .where('thread_id', '=', threadId)
    .where('message_id', 'is', null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? BigInt(0));
}

// ============ Cleanup ============

export async function getThreadsOlderThan(days: number): Promise<DbThread[]> {
  const db = await getDb();
  // Compute cutoff date in JavaScript for PostgreSQL compatibility
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  return db
    .selectFrom('threads')
    .select(['id', 'user_id', 'title', 'selected_model', 'created_at', 'updated_at', 'is_summarized', 'total_tokens', 'is_pinned'])
    .where('updated_at', '<', cutoffDate.toISOString())
    .orderBy('updated_at', 'asc')
    .execute() as Promise<DbThread[]>;
}

export async function deleteThreadsOlderThan(days: number): Promise<number> {
  const threads = await getThreadsOlderThan(days);
  for (const thread of threads) {
    await deleteThread(thread.id);
  }
  return threads.length;
}

export async function getThreadUploadsStorageSize(): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('thread_uploads')
    .select(sql<number>`COALESCE(SUM(file_size), 0)`.as('total'))
    .executeTakeFirst();
  return result?.total ?? 0;
}

export async function getThreadOutputsStorageSize(): Promise<number> {
  const db = await getDb();
  const result = await db
    .selectFrom('thread_outputs')
    .select(sql<number>`COALESCE(SUM(file_size), 0)`.as('total'))
    .executeTakeFirst();
  return result?.total ?? 0;
}

// ============ Thread Context (for image generation) ============

export interface ThreadContext {
  exists: boolean;
  isWorkspace: boolean;
  workspaceId?: string;
  sessionId?: string;
  actualThreadId?: string;
}

/**
 * Get thread context for image generation
 * Checks if the thread exists in main threads, workspace threads, or workspace sessions
 */
export async function getThreadContext(threadId: string): Promise<ThreadContext> {
  const db = await getDb();

  // Check main threads table
  const mainThread = await db
    .selectFrom('threads')
    .select('id')
    .where('id', '=', threadId)
    .executeTakeFirst();

  if (mainThread) {
    return { exists: true, isWorkspace: false };
  }

  // Check workspace_threads table
  const workspaceThread = await db
    .selectFrom('workspace_threads')
    .select(['id', 'workspace_id', 'session_id'])
    .where('id', '=', threadId)
    .executeTakeFirst();

  if (workspaceThread) {
    return {
      exists: true,
      isWorkspace: true,
      workspaceId: workspaceThread.workspace_id,
      sessionId: workspaceThread.session_id,
      actualThreadId: workspaceThread.id,
    };
  }

  // Check workspace_sessions table (threadId might be a session ID)
  const workspaceSession = await db
    .selectFrom('workspace_sessions')
    .select(['id', 'workspace_id'])
    .where('id', '=', threadId)
    .executeTakeFirst();

  if (workspaceSession) {
    return {
      exists: true,
      isWorkspace: true,
      workspaceId: workspaceSession.workspace_id,
      sessionId: workspaceSession.id,
    };
  }

  return { exists: false, isWorkspace: false };
}

// ============ Workspace Outputs ============

export interface WorkspaceOutputResult {
  id: number;
}

/**
 * Add an output file to workspace_outputs table
 */
export async function addWorkspaceOutput(
  workspaceId: string,
  sessionId: string,
  threadId: string | null,
  filename: string,
  filepath: string,
  fileType: 'pdf' | 'docx' | 'image' | 'chart' | 'md' | 'xlsx' | 'pptx',
  fileSize: number,
  generationConfig?: string,
  expiresAt?: string | null
): Promise<WorkspaceOutputResult> {
  const db = await getDb();
  const result = await db
    .insertInto('workspace_outputs')
    .values({
      workspace_id: workspaceId,
      session_id: sessionId,
      thread_id: threadId,
      filename,
      filepath,
      file_type: fileType,
      file_size: fileSize,
      generation_config: generationConfig ?? null,
      expires_at: expiresAt ?? null,
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();

  return { id: result.id as number };
}

/**
 * Workspace output interface for queries
 */
export interface WorkspaceOutput {
  id: number;
  workspace_id: string;
  session_id: string;
  thread_id: string | null;
  filename: string;
  filepath: string;
  file_type: string;
  file_size: number;
  generation_config: string | null;
  expires_at: string | null;
  download_count: number;
  created_at: string;
}

/**
 * Get a workspace output by ID
 */
export async function getWorkspaceOutputById(outputId: number): Promise<WorkspaceOutput | undefined> {
  const db = await getDb();
  const result = await db
    .selectFrom('workspace_outputs')
    .selectAll()
    .where('id', '=', outputId)
    .executeTakeFirst();

  return result as WorkspaceOutput | undefined;
}

/**
 * Increment download count for a workspace output
 */
export async function incrementWorkspaceOutputDownloadCount(outputId: number): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('workspace_outputs')
    .set({ download_count: sql`download_count + 1` })
    .where('id', '=', outputId)
    .execute();
}

// ============ Thread Output Helpers (for docgen) ============

/**
 * Get expired thread outputs
 */
export async function getExpiredThreadOutputs(): Promise<DbThreadOutput[]> {
  const db = await getDb();
  const now = new Date().toISOString();
  return db
    .selectFrom('thread_outputs')
    .selectAll()
    .where('expires_at', 'is not', null)
    .where('expires_at', '<', now)
    .orderBy('expires_at', 'asc')
    .execute() as unknown as DbThreadOutput[];
}

/**
 * Delete a thread output by ID
 */
export async function deleteThreadOutput(outputId: number): Promise<void> {
  const db = await getDb();
  await db.deleteFrom('thread_outputs').where('id', '=', outputId).execute();
}

/**
 * Increment download count for a thread output
 */
export async function incrementThreadOutputDownloadCount(outputId: number): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('thread_outputs')
    .set({ download_count: sql`download_count + 1` })
    .where('id', '=', outputId)
    .execute();
}

/**
 * Get download count for a thread output
 */
export async function getThreadOutputDownloadCount(outputId: number): Promise<number> {
  const db = await getDb();
  const row = await db
    .selectFrom('thread_outputs')
    .select('download_count')
    .where('id', '=', outputId)
    .executeTakeFirst();
  return (row?.download_count as number) ?? 0;
}

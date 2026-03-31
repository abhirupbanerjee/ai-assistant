/**
 * Thread Database Operations
 *
 * CRUD operations for threads, messages, and thread file uploads
 */

import { execute, queryAll, queryOne, transaction } from './index';
import { v4 as uuidv4 } from 'uuid';
import type { Source, ToolCall, GeneratedDocumentInfo, MessageVisualization, GeneratedImageInfo, PodcastHint, DiagramHint, MessageMetadata } from '@/types';

// ============ Types ============

export interface DbThread {
  id: string;
  user_id: number;
  title: string;
  selected_model: string | null;  // NULL = use global default, otherwise model ID override
  created_at: string;
  updated_at: string;
  is_summarized: number;
  total_tokens: number;
  is_pinned: number;
}

export interface DbMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  sources_json: string | null;
  attachments_json: string | null;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  generated_documents_json: string | null;
  visualizations_json: string | null;
  generated_images_json: string | null;
  generated_diagrams_json: string | null;
  generated_podcasts_json: string | null;
  metadata_json: string | null;
  created_at: string;
}

export interface DbThreadUpload {
  id: number;
  thread_id: string;
  filename: string;
  filepath: string;
  file_size: number;
  uploaded_at: string;
}

export interface DbThreadOutput {
  id: number;
  thread_id: string;
  message_id: string | null;
  filename: string;
  filepath: string;
  file_type: 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx';
  file_size: number;
  generation_config?: string | null;
  expires_at?: string | null;
  download_count?: number;
  created_at: string;
}

export interface ThreadWithDetails extends DbThread {
  messageCount: number;
  uploadCount: number;
  categories: { id: number; name: string; slug: string }[];
}

export interface ParsedMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  sources: Source[] | null;
  attachments: string[] | null;
  toolCalls: ToolCall[] | null;
  toolCallId: string | null;
  toolName: string | null;
  generatedDocuments: GeneratedDocumentInfo[] | null;
  visualizations: MessageVisualization[] | null;
  generatedImages: GeneratedImageInfo[] | null;
  generatedDiagrams: DiagramHint[] | null;
  generatedPodcasts: PodcastHint[] | null;
  metadata: MessageMetadata | null;
  createdAt: Date;
}

// ============ Thread CRUD ============

/**
 * Create a new thread
 */
export function createThread(
  userId: number,
  title: string = 'New Conversation',
  categoryIds: number[] = []
): DbThread {
  const threadId = uuidv4();

  return transaction(() => {
    execute(`
      INSERT INTO threads (id, user_id, title)
      VALUES (?, ?, ?)
    `, [threadId, userId, title]);

    // Add category associations
    for (const categoryId of categoryIds) {
      execute(`
        INSERT INTO thread_categories (thread_id, category_id)
        VALUES (?, ?)
      `, [threadId, categoryId]);
    }

    return getThreadById(threadId)!;
  });
}

/**
 * Get thread by ID
 */
export function getThreadById(threadId: string): DbThread | undefined {
  return queryOne<DbThread>(`
    SELECT id, user_id, title, selected_model, created_at, updated_at, is_summarized, total_tokens, is_pinned
    FROM threads
    WHERE id = ?
  `, [threadId]);
}

/**
 * Get thread owner (user_id only) for ownership checks
 */
export function getThreadOwner(threadId: string): { user_id: number } | undefined {
  return queryOne<{ user_id: number }>(`
    SELECT user_id FROM threads WHERE id = ?
  `, [threadId]);
}

/**
 * Get thread with details (message count, upload count, categories)
 */
export function getThreadWithDetails(threadId: string): ThreadWithDetails | undefined {
  const thread = getThreadById(threadId);
  if (!thread) return undefined;

  const messageCount = queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM messages WHERE thread_id = ?
  `, [threadId])?.count ?? 0;

  const uploadCount = queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM thread_uploads WHERE thread_id = ?
  `, [threadId])?.count ?? 0;

  const categories = queryAll<{ id: number; name: string; slug: string }>(`
    SELECT c.id, c.name, c.slug
    FROM categories c
    JOIN thread_categories tc ON c.id = tc.category_id
    WHERE tc.thread_id = ?
    ORDER BY c.name
  `, [threadId]);

  return {
    ...thread,
    messageCount,
    uploadCount,
    categories,
  };
}

/**
 * Get threads for a user
 */
export function getThreadsForUser(
  userId: number,
  limit: number = 50,
  offset: number = 0
): ThreadWithDetails[] {
  const threads = queryAll<DbThread>(`
    SELECT id, user_id, title, selected_model, created_at, updated_at, is_summarized, total_tokens, is_pinned
    FROM threads
    WHERE user_id = ?
    ORDER BY is_pinned DESC, updated_at DESC
    LIMIT ? OFFSET ?
  `, [userId, limit, offset]);

  return threads.map(thread => {
    const messageCount = queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM messages WHERE thread_id = ?
    `, [thread.id])?.count ?? 0;

    const uploadCount = queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM thread_uploads WHERE thread_id = ?
    `, [thread.id])?.count ?? 0;

    const categories = queryAll<{ id: number; name: string; slug: string }>(`
      SELECT c.id, c.name, c.slug
      FROM categories c
      JOIN thread_categories tc ON c.id = tc.category_id
      WHERE tc.thread_id = ?
      ORDER BY c.name
    `, [thread.id]);

    return {
      ...thread,
      messageCount,
      uploadCount,
      categories,
    };
  });
}

/**
 * Get total thread count for a user
 */
export function getThreadCountForUser(userId: number): number {
  const result = queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM threads WHERE user_id = ?
  `, [userId]);
  return result?.count ?? 0;
}

/**
 * Update thread title
 */
export function updateThreadTitle(threadId: string, title: string): boolean {
  const result = execute(`
    UPDATE threads SET title = ? WHERE id = ?
  `, [title, threadId]);
  return result.changes > 0;
}

/**
 * Toggle thread pin status
 */
export function toggleThreadPin(threadId: string): boolean {
  const thread = getThreadById(threadId);
  if (!thread) return false;

  const newPinStatus = thread.is_pinned ? 0 : 1;
  const result = execute(`
    UPDATE threads SET is_pinned = ? WHERE id = ?
  `, [newPinStatus, threadId]);

  return result.changes > 0;
}

/**
 * Update thread's selected model
 * @param threadId - Thread ID
 * @param selectedModel - Model ID to use, or null to use global default
 */
export function updateThreadModel(threadId: string, selectedModel: string | null): boolean {
  const result = execute(`
    UPDATE threads
    SET selected_model = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [selectedModel, threadId]);
  return result.changes > 0;
}

/**
 * Get effective model for a thread (resolves thread override → global default)
 * @param threadId - Thread ID
 * @returns Model ID to use for this thread
 */
export function getEffectiveModelForThread(threadId: string): string | null {
  const thread = getThreadById(threadId);

  // If thread has a selected model override, use it
  if (thread?.selected_model) {
    return thread.selected_model;
  }

  // Otherwise use global default from enabled_models
  // Import dynamically to avoid circular dependency
  const { getDefaultModel } = require('./enabled-models');
  const defaultModel = getDefaultModel();
  return defaultModel?.id || null;
}

/**
 * Delete thread and all associated data
 */
export function deleteThread(threadId: string): { messageCount: number; uploadCount: number } {
  return transaction(() => {
    const messageCount = queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM messages WHERE thread_id = ?
    `, [threadId])?.count ?? 0;

    const uploadCount = queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM thread_uploads WHERE thread_id = ?
    `, [threadId])?.count ?? 0;

    // Delete cascades will handle messages, uploads, outputs, and categories
    execute('DELETE FROM threads WHERE id = ?', [threadId]);

    return { messageCount, uploadCount };
  });
}

/**
 * Check if user owns thread
 */
export function userOwnsThread(userId: number, threadId: string): boolean {
  const thread = getThreadById(threadId);
  return thread?.user_id === userId;
}

// ============ Thread Categories ============

/**
 * Get categories for a thread
 */
export function getThreadCategories(threadId: string): number[] {
  const results = queryAll<{ category_id: number }>(`
    SELECT category_id FROM thread_categories WHERE thread_id = ?
  `, [threadId]);
  return results.map(r => r.category_id);
}

/**
 * Get category slugs for a thread
 */
export function getThreadCategorySlugs(threadId: string): string[] {
  const results = queryAll<{ slug: string }>(`
    SELECT c.slug
    FROM categories c
    JOIN thread_categories tc ON c.id = tc.category_id
    WHERE tc.thread_id = ?
  `, [threadId]);
  const slugs = results.map(r => r.slug);
  console.log('[DB] getThreadCategorySlugs:', { threadId, slugs, resultCount: results.length });
  return slugs;
}

/**
 * Set thread categories (replace all)
 */
export function setThreadCategories(threadId: string, categoryIds: number[]): void {
  transaction(() => {
    execute('DELETE FROM thread_categories WHERE thread_id = ?', [threadId]);

    for (const categoryId of categoryIds) {
      execute(`
        INSERT INTO thread_categories (thread_id, category_id)
        VALUES (?, ?)
      `, [threadId, categoryId]);
    }
  });
}

// ============ Messages ============

/**
 * Add a message to a thread
 */
export function addMessage(
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
    generatedPodcasts?: PodcastHint[];
  }
): ParsedMessage {
  const messageId = options?.messageId || uuidv4();

  execute(`
    INSERT INTO messages (id, thread_id, role, content, sources_json, attachments_json, tool_calls_json, tool_call_id, tool_name, generated_documents_json, visualizations_json, generated_images_json, generated_podcasts_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    messageId,
    threadId,
    role,
    content,
    options?.sources ? JSON.stringify(options.sources) : null,
    options?.attachments ? JSON.stringify(options.attachments) : null,
    options?.toolCalls ? JSON.stringify(options.toolCalls) : null,
    options?.toolCallId || null,
    options?.toolName || null,
    options?.generatedDocuments ? JSON.stringify(options.generatedDocuments) : null,
    options?.visualizations ? JSON.stringify(options.visualizations) : null,
    options?.generatedImages ? JSON.stringify(options.generatedImages) : null,
    options?.generatedPodcasts ? JSON.stringify(options.generatedPodcasts) : null,
  ]);

  return getMessageById(messageId)!;
}

/**
 * Get message by ID
 */
export function getMessageById(messageId: string): ParsedMessage | undefined {
  const msg = queryOne<DbMessage>(`
    SELECT id, thread_id, role, content, sources_json, attachments_json, tool_calls_json, tool_call_id, tool_name, generated_documents_json, visualizations_json, generated_images_json, generated_podcasts_json, created_at
    FROM messages
    WHERE id = ?
  `, [messageId]);

  if (!msg) return undefined;

  return parseMessage(msg);
}

/**
 * Get messages for a thread
 */
export function getMessagesForThread(threadId: string): ParsedMessage[] {
  const messages = queryAll<DbMessage>(`
    SELECT id, thread_id, role, content, sources_json, attachments_json, tool_calls_json, tool_call_id, tool_name, generated_documents_json, visualizations_json, generated_images_json, generated_podcasts_json, created_at
    FROM messages
    WHERE thread_id = ?
    ORDER BY created_at ASC
  `, [threadId]);

  return messages.map(parseMessage);
}

/**
 * Parse a database message into a typed object
 */
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

// ============ Thread Uploads ============

/**
 * Add an upload to a thread
 */
export function addThreadUpload(
  threadId: string,
  filename: string,
  filepath: string,
  fileSize: number
): DbThreadUpload {
  const result = execute(`
    INSERT INTO thread_uploads (thread_id, filename, filepath, file_size)
    VALUES (?, ?, ?, ?)
  `, [threadId, filename, filepath, fileSize]);

  return getThreadUploadById(result.lastInsertRowid as number)!;
}

/**
 * Get upload by ID
 */
export function getThreadUploadById(uploadId: number): DbThreadUpload | undefined {
  return queryOne<DbThreadUpload>(`
    SELECT id, thread_id, filename, filepath, file_size, uploaded_at
    FROM thread_uploads
    WHERE id = ?
  `, [uploadId]);
}

/**
 * Get uploads for a thread
 */
export function getThreadUploads(threadId: string): DbThreadUpload[] {
  return queryAll<DbThreadUpload>(`
    SELECT id, thread_id, filename, filepath, file_size, uploaded_at
    FROM thread_uploads
    WHERE thread_id = ?
    ORDER BY uploaded_at ASC
  `, [threadId]);
}

/**
 * Get upload count for a thread
 */
export function getThreadUploadCount(threadId: string): number {
  const result = queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM thread_uploads WHERE thread_id = ?
  `, [threadId]);
  return result?.count ?? 0;
}

/**
 * Delete an upload
 */
export function deleteThreadUpload(uploadId: number): boolean {
  const result = execute('DELETE FROM thread_uploads WHERE id = ?', [uploadId]);
  return result.changes > 0;
}

// ============ Thread Outputs ============

/**
 * Add an AI-generated output file
 */
export function addThreadOutput(
  threadId: string,
  messageId: string | null,
  filename: string,
  filepath: string,
  fileType: 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'md' | 'mp3' | 'wav',
  fileSize: number,
  generationConfig?: string,
  expiresAt?: string | null
): DbThreadOutput {
  const result = execute(`
    INSERT INTO thread_outputs (thread_id, message_id, filename, filepath, file_type, file_size, generation_config, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [threadId, messageId, filename, filepath, fileType, fileSize, generationConfig ?? null, expiresAt ?? null]);

  return getThreadOutputById(result.lastInsertRowid as number)!;
}

/**
 * Get output by ID
 */
export function getThreadOutputById(outputId: number): DbThreadOutput | undefined {
  return queryOne<DbThreadOutput>(`
    SELECT id, thread_id, message_id, filename, filepath, file_type, file_size, created_at
    FROM thread_outputs
    WHERE id = ?
  `, [outputId]);
}

/**
 * Get outputs for a thread
 */
export function getThreadOutputs(threadId: string): DbThreadOutput[] {
  return queryAll<DbThreadOutput>(`
    SELECT id, thread_id, message_id, filename, filepath, file_type, file_size, created_at
    FROM thread_outputs
    WHERE thread_id = ?
    ORDER BY created_at ASC
  `, [threadId]);
}

/**
 * Link unlinked outputs to a message
 * Called after assistant message is saved to associate outputs generated during tool execution
 * with the message that produced them.
 */
export function linkOutputsToMessage(threadId: string, messageId: string): number {
  const result = execute(`
    UPDATE thread_outputs
    SET message_id = ?
    WHERE thread_id = ? AND message_id IS NULL
  `, [messageId, threadId]);
  return result.changes;
}

// ============ Thread Output Helpers (for docgen) ============

/**
 * Get expired thread outputs (expires_at < now)
 */
export function getExpiredThreadOutputs(): DbThreadOutput[] {
  return queryAll<DbThreadOutput>(
    `SELECT * FROM thread_outputs WHERE expires_at IS NOT NULL AND expires_at < datetime('now') ORDER BY expires_at ASC`,
    []
  );
}

/**
 * Delete a thread output by ID
 */
export function deleteThreadOutput(outputId: number): void {
  execute('DELETE FROM thread_outputs WHERE id = ?', [outputId]);
}

/**
 * Increment download count for a thread output
 */
export function incrementThreadOutputDownloadCount(outputId: number): void {
  execute('UPDATE thread_outputs SET download_count = download_count + 1 WHERE id = ?', [outputId]);
}

/**
 * Get download count for a thread output
 */
export function getThreadOutputDownloadCount(outputId: number): number {
  const row = queryOne<{ download_count: number }>(
    'SELECT download_count FROM thread_outputs WHERE id = ?',
    [outputId]
  );
  return row?.download_count ?? 0;
}

// ============ Cleanup ============

/**
 * Get threads older than a certain number of days
 */
export function getThreadsOlderThan(days: number): DbThread[] {
  return queryAll<DbThread>(`
    SELECT id, user_id, title, selected_model, created_at, updated_at, is_summarized, total_tokens, is_pinned
    FROM threads
    WHERE updated_at < datetime('now', '-' || ? || ' days')
    ORDER BY updated_at ASC
  `, [days]);
}

/**
 * Delete threads older than a certain number of days
 * Returns the number of threads deleted
 */
export function deleteThreadsOlderThan(days: number): number {
  const threads = getThreadsOlderThan(days);
  for (const thread of threads) {
    deleteThread(thread.id);
  }
  return threads.length;
}

/**
 * Get total storage used by thread uploads
 */
export function getThreadUploadsStorageSize(): number {
  const result = queryOne<{ total: number }>(`
    SELECT COALESCE(SUM(file_size), 0) as total FROM thread_uploads
  `);
  return result?.total ?? 0;
}

/**
 * Get total storage used by thread outputs
 */
export function getThreadOutputsStorageSize(): number {
  const result = queryOne<{ total: number }>(`
    SELECT COALESCE(SUM(file_size), 0) as total FROM thread_outputs
  `);
  return result?.total ?? 0;
}

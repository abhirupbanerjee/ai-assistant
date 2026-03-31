/**
 * Thread Management Module
 *
 * Now uses SQLite database for metadata storage.
 * File uploads remain on filesystem, only metadata tracked in SQLite.
 * Supports category-based organization.
 */

import path from 'path';
import type { Thread, ThreadWithMessages, Message, ThreadCategory } from '@/types';
import {
  getThreadUploadsDir,
  ensureDir,
  deleteDir,
  listFiles,
  deleteFile,
  writeFileBuffer,
} from './storage';
import { isSupportedExtension, getMimeTypeFromFilename, isImage } from './document-extractor';
import { getUserId } from './users';
import { getUploadLimits } from './db/compat/config';
import { invalidateThreadEmbeddingCache } from './redis';
import {
  createThread as dbCreateThread,
  getThreadById as dbGetThreadById,
  getThreadWithDetails,
  getThreadsForUser as dbGetThreadsForUser,
  deleteThread as dbDeleteThread,
  updateThreadTitle as dbUpdateThreadTitle,
  toggleThreadPin as dbToggleThreadPin,
  userOwnsThread as dbUserOwnsThread,
  addMessage as dbAddMessage,
  getMessagesForThread as dbGetMessagesForThread,
  addThreadUpload as dbAddThreadUpload,
  deleteThreadUpload as dbDeleteThreadUpload,
  getThreadUploads as dbGetThreadUploads,
  getThreadUploadCount as dbGetThreadUploadCount,
  getThreadCategories,
  setThreadCategories as dbSetThreadCategories,
  getThreadCategorySlugs,
  type ParsedMessage,
} from './db/compat/threads';

// Get upload directory path (still file-based)
function getThreadUploadPath(userEmail: string, threadId: string): string {
  return getThreadUploadsDir(userEmail, threadId);
}

// Resolve thread categories via the compat layer so they match admin settings.
// In hybrid mode, categories may live in Postgres while threads are in SQLite.
// When the thread-category mapping isn't in Postgres, falls back to SQLite category IDs
// but still resolves names from the compat category map to stay consistent.
// Accepts an optional pre-fetched categoryMap to avoid repeated DB queries in loops.
async function resolveCategories(
  threadId: string,
  sqliteCategories?: ThreadCategory[],
  categoryMap?: Map<number, ThreadCategory>
): Promise<ThreadCategory[]> {
  const categoryIds = await getThreadCategories(threadId);

  // Build category map if not provided
  if (!categoryMap) {
    const { getAllCategories } = await import('./db/compat/categories');
    const allCategories = await getAllCategories();
    categoryMap = new Map(allCategories.map(c => [c.id, { id: c.id, name: c.name, slug: c.slug }]));
  }

  // If compat has the thread-category mapping, use those IDs
  if (categoryIds.length > 0) {
    return categoryIds.map(id => categoryMap!.get(id)).filter(Boolean) as ThreadCategory[];
  }

  // Fallback: use SQLite category IDs but resolve names from compat map
  // so renamed categories show the correct (Postgres) name
  if (sqliteCategories && sqliteCategories.length > 0) {
    return sqliteCategories
      .map(sc => categoryMap!.get(sc.id) || sc)
      .filter(Boolean);
  }

  return [];
}

// Convert db thread format to API Thread format
function toThread(
  dbThread: {
    id: string;
    user_id: number;
    title: string;
    created_at: string;
    updated_at: string;
    is_pinned?: number;
  },
  userEmail: string,
  uploadCount: number,
  categories?: ThreadCategory[]
): Thread {
  return {
    id: dbThread.id,
    userId: userEmail, // Keep email for API compatibility
    title: dbThread.title,
    createdAt: new Date(dbThread.created_at),
    updatedAt: new Date(dbThread.updated_at),
    uploadCount,
    categories,
    isPinned: Boolean(dbThread.is_pinned),
  };
}

// Convert ParsedMessage to Message
function toMessage(parsed: ParsedMessage): Message {
  return {
    id: parsed.id,
    role: parsed.role,
    content: parsed.content,
    sources: parsed.sources || undefined,
    attachments: parsed.attachments || undefined,
    tool_calls: parsed.toolCalls || undefined,
    tool_call_id: parsed.toolCallId || undefined,
    name: parsed.toolName || undefined,
    generatedDocuments: parsed.generatedDocuments || undefined,
    visualizations: parsed.visualizations || undefined,
    generatedImages: parsed.generatedImages || undefined,
    generatedDiagrams: parsed.generatedDiagrams || undefined,
    generatedPodcasts: parsed.generatedPodcasts || undefined,
    metadata: parsed.metadata || undefined,
    timestamp: parsed.createdAt,
  };
}

/**
 * Create a new thread
 */
export async function createThread(
  userId: string, // email
  title?: string,
  categoryIds?: number[]
): Promise<Thread> {
  const numericUserId = await getUserId(userId);
  if (!numericUserId) {
    throw new Error('User not found');
  }

  const dbThread = await dbCreateThread(numericUserId, title || 'New Thread', categoryIds || []);

  // Sync categories to Postgres compat layer (already written by dbCreateThread in compat mode)
  // No need for separate compat sync since we now import from compat directly

  // Create uploads directory on filesystem
  const uploadsDir = getThreadUploadPath(userId, dbThread.id);
  await ensureDir(uploadsDir);

  // Get categories for the response
  const categories = categoryIds && categoryIds.length > 0
    ? (await getThreadWithDetails(dbThread.id))?.categories
    : undefined;

  return toThread(dbThread, userId, 0, categories);
}

/**
 * Get thread with messages
 */
export async function getThread(
  userId: string, // email
  threadId: string
): Promise<ThreadWithMessages | null> {
  const numericUserId = await getUserId(userId);
  if (!numericUserId) {
    return null;
  }

  // Verify ownership
  if (!(await dbUserOwnsThread(numericUserId, threadId))) {
    return null;
  }

  const threadDetails = await getThreadWithDetails(threadId);
  if (!threadDetails) {
    return null;
  }

  // Get messages
  const dbMessages = await dbGetMessagesForThread(threadId);
  const messages = dbMessages.map(toMessage);

  // Get uploads from filesystem
  const uploadsDir = getThreadUploadPath(userId, threadId);
  const uploadFiles = await listFiles(uploadsDir);
  const uploads = uploadFiles.filter(f => isSupportedExtension(f));

  const categories = await resolveCategories(threadId, threadDetails.categories);

  return {
    id: threadDetails.id,
    userId: userId, // Keep email for API compatibility
    title: threadDetails.title,
    createdAt: new Date(threadDetails.created_at),
    updatedAt: new Date(threadDetails.updated_at),
    uploadCount: threadDetails.uploadCount,
    categories,
    messages,
    uploads,
  };
}

/**
 * List threads for a user
 */
export async function listThreads(userId: string): Promise<Thread[]> {
  const numericUserId = await getUserId(userId);
  if (!numericUserId) {
    return [];
  }

  const dbThreads = await dbGetThreadsForUser(numericUserId);

  // Pre-fetch category map once to avoid N+1 queries
  const { getAllCategories } = await import('./db/compat/categories');
  const allCategories = await getAllCategories();
  const categoryMap = new Map(allCategories.map(c => [c.id, { id: c.id, name: c.name, slug: c.slug }]));

  return Promise.all(dbThreads.map(async t => ({
    id: t.id,
    userId: userId, // Keep email for API compatibility
    title: t.title,
    createdAt: new Date(t.created_at),
    updatedAt: new Date(t.updated_at),
    uploadCount: t.uploadCount,
    categories: await resolveCategories(t.id, t.categories, categoryMap),
    isSummarized: Boolean(t.is_summarized),
    totalTokens: t.total_tokens || 0,
    isPinned: Boolean(t.is_pinned),
  })));
}

/**
 * Delete a thread
 */
export async function deleteThread(
  userId: string,
  threadId: string
): Promise<{ messageCount: number; uploadCount: number } | null> {
  const numericUserId = await getUserId(userId);
  if (!numericUserId) {
    return null;
  }

  // Verify ownership
  if (!(await dbUserOwnsThread(numericUserId, threadId))) {
    return null;
  }

  // Delete from database (cascades to messages, uploads metadata, etc.)
  const result = await dbDeleteThread(threadId);

  // Delete uploads directory from filesystem
  const uploadsDir = getThreadUploadPath(userId, threadId);
  await deleteDir(uploadsDir);

  return result;
}

/**
 * Update thread title
 */
export async function updateThreadTitle(
  userId: string,
  threadId: string,
  title: string
): Promise<Thread | null> {
  const numericUserId = await getUserId(userId);
  if (!numericUserId) {
    return null;
  }

  // Verify ownership
  if (!(await dbUserOwnsThread(numericUserId, threadId))) {
    return null;
  }

  const truncatedTitle = title.substring(0, 100); // Max 100 characters
  const success = await dbUpdateThreadTitle(threadId, truncatedTitle);
  if (!success) {
    return null;
  }

  const threadDetails = await getThreadWithDetails(threadId);
  if (!threadDetails) {
    return null;
  }

  return {
    id: threadDetails.id,
    userId: userId,
    title: threadDetails.title,
    createdAt: new Date(threadDetails.created_at),
    updatedAt: new Date(threadDetails.updated_at),
    uploadCount: threadDetails.uploadCount,
    categories: threadDetails.categories,
  };
}

/**
 * Toggle thread pin status
 */
export async function toggleThreadPin(
  userId: string,
  threadId: string
): Promise<Thread | null> {
  const numericUserId = await getUserId(userId);
  if (!numericUserId) {
    return null;
  }

  // Verify ownership
  if (!(await dbUserOwnsThread(numericUserId, threadId))) {
    return null;
  }

  const success = await dbToggleThreadPin(threadId);
  if (!success) {
    return null;
  }

  const threadDetails = await getThreadWithDetails(threadId);
  if (!threadDetails) {
    return null;
  }

  return {
    id: threadDetails.id,
    userId: userId,
    title: threadDetails.title,
    createdAt: new Date(threadDetails.created_at),
    updatedAt: new Date(threadDetails.updated_at),
    uploadCount: threadDetails.uploadCount,
    categories: threadDetails.categories,
    isPinned: Boolean(threadDetails.is_pinned),
  };
}

/**
 * Add a message to a thread
 */
export async function addMessage(
  userId: string,
  threadId: string,
  message: Message
): Promise<void> {
  const numericUserId = await getUserId(userId);
  if (!numericUserId) {
    throw new Error('User not found');
  }

  // Verify ownership
  if (!(await dbUserOwnsThread(numericUserId, threadId))) {
    throw new Error('Thread not found');
  }

  // Get current message count to check if this is the first message
  const existingMessages = await dbGetMessagesForThread(threadId);
  const isFirstMessage = existingMessages.length === 0;

  // Add the message
  await dbAddMessage(threadId, message.role, message.content, {
    messageId: message.id,
    sources: message.sources,
    attachments: message.attachments,
    toolCalls: message.tool_calls,
    toolCallId: message.tool_call_id,
    toolName: message.name,
    generatedDocuments: message.generatedDocuments,
    visualizations: message.visualizations,
    generatedImages: message.generatedImages,
    generatedDiagrams: message.generatedDiagrams,
    generatedPodcasts: message.generatedPodcasts,
    metadataJson: message.metadata ? JSON.stringify(message.metadata) : undefined,
  });

  // Update title if this is the first user message and title is default
  if (isFirstMessage && message.role === 'user') {
    const thread = await dbGetThreadById(threadId);
    if (thread && thread.title === 'New Thread') {
      const newTitle = message.content.substring(0, 50) + (message.content.length > 50 ? '...' : '');
      await dbUpdateThreadTitle(threadId, newTitle);
    }
  }
}

/**
 * Get messages for a thread
 */
export async function getMessages(
  userId: string,
  threadId: string,
  limit?: number
): Promise<Message[]> {
  const numericUserId = await getUserId(userId);
  if (!numericUserId) {
    return [];
  }

  // Verify ownership
  if (!(await dbUserOwnsThread(numericUserId, threadId))) {
    return [];
  }

  const dbMessages = await dbGetMessagesForThread(threadId);
  const messages = dbMessages.map(toMessage);

  if (limit && limit > 0) {
    return messages.slice(-limit);
  }

  return messages;
}

/**
 * Save an uploaded file
 */
export async function saveUpload(
  userId: string,
  threadId: string,
  filename: string,
  buffer: Buffer
): Promise<{ filename: string; uploadCount: number }> {
  const numericUserId = await getUserId(userId);
  if (!numericUserId) {
    throw new Error('User not found');
  }

  // Verify ownership
  if (!(await dbUserOwnsThread(numericUserId, threadId))) {
    throw new Error('Thread not found');
  }

  // Get configurable limits
  const limits = await getUploadLimits();
  const maxFileSizeBytes = limits.maxFileSizeMB * 1024 * 1024;

  // Check file size
  if (buffer.length > maxFileSizeBytes) {
    throw new Error(`File too large (max ${limits.maxFileSizeMB}MB)`);
  }

  // Sanitize filename
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uploadsDir = getThreadUploadPath(userId, threadId);
  await ensureDir(uploadsDir);
  const filePath = path.join(uploadsDir, safeFilename);

  // Write file to filesystem
  await writeFileBuffer(filePath, buffer);

  // Record upload in database
  await dbAddThreadUpload(threadId, safeFilename, filePath, buffer.length);

  // Invalidate embedding cache for this file (in case of re-upload with same name)
  await invalidateThreadEmbeddingCache(threadId, safeFilename);

  const newCount = await dbGetThreadUploadCount(threadId);

  return {
    filename: safeFilename,
    uploadCount: newCount,
  };
}

/**
 * Delete an uploaded file
 */
export async function deleteUpload(
  userId: string,
  threadId: string,
  filename: string
): Promise<number> {
  const numericUserId = await getUserId(userId);
  if (!numericUserId) {
    throw new Error('User not found');
  }

  // Verify ownership
  if (!(await dbUserOwnsThread(numericUserId, threadId))) {
    throw new Error('Thread not found');
  }

  // Find the upload record
  const uploads = await dbGetThreadUploads(threadId);
  const upload = uploads.find(u => u.filename === filename);
  if (!upload) {
    throw new Error('Upload not found');
  }

  // Delete from filesystem
  const uploadsDir = getThreadUploadPath(userId, threadId);
  const filePath = path.join(uploadsDir, filename);
  await deleteFile(filePath);

  // Delete from database
  await dbDeleteThreadUpload(upload.id);

  // Invalidate embedding cache for this file
  await invalidateThreadEmbeddingCache(threadId, filename);

  return await dbGetThreadUploadCount(threadId);
}

/**
 * Get paths to all uploaded files
 */
export async function getUploadPaths(
  userId: string,
  threadId: string
): Promise<string[]> {
  const numericUserId = await getUserId(userId);
  if (!numericUserId) {
    return [];
  }

  // Verify ownership
  if (!(await dbUserOwnsThread(numericUserId, threadId))) {
    return [];
  }

  const uploads = await dbGetThreadUploads(threadId);
  return uploads
    .filter(u => isSupportedExtension(u.filename))
    .map(u => u.filepath);
}

/**
 * Upload details with type information for multimodal processing
 */
export interface UploadDetail {
  filepath: string;
  filename: string;
  mimeType: string;
  isImage: boolean;
  fileSize: number;
}

/**
 * Get detailed information about all uploaded files
 * Separates images from documents for multimodal LLM processing
 */
export async function getUploadDetails(
  userId: string,
  threadId: string
): Promise<{ images: UploadDetail[]; documents: UploadDetail[] }> {
  const numericUserId = await getUserId(userId);
  if (!numericUserId) {
    return { images: [], documents: [] };
  }

  // Verify ownership
  if (!(await dbUserOwnsThread(numericUserId, threadId))) {
    return { images: [], documents: [] };
  }

  const uploads = await dbGetThreadUploads(threadId);
  const images: UploadDetail[] = [];
  const documents: UploadDetail[] = [];

  for (const upload of uploads) {
    if (!isSupportedExtension(upload.filename)) {
      continue;
    }

    const mimeType = getMimeTypeFromFilename(upload.filename);
    const detail: UploadDetail = {
      filepath: upload.filepath,
      filename: upload.filename,
      mimeType,
      isImage: isImage(mimeType),
      fileSize: upload.file_size,
    };

    if (detail.isImage) {
      images.push(detail);
    } else {
      documents.push(detail);
    }
  }

  return { images, documents };
}

/**
 * Get the number of uploads in a thread
 */
export async function getThreadUploadCount(threadId: string): Promise<number> {
  return await dbGetThreadUploadCount(threadId);
}

// ============ Category Operations ============

/**
 * Get categories for a thread
 */
export async function getThreadCategoryIds(threadId: string): Promise<number[]> {
  return await getThreadCategories(threadId);
}

/**
 * Get category slugs for a thread (for vector store queries)
 */
export async function getThreadCategorySlugsForQuery(threadId: string): Promise<string[]> {
  return await getThreadCategorySlugs(threadId);
}

/**
 * Set categories for a thread
 */
export async function setThreadCategories(
  userId: string,
  threadId: string,
  categoryIds: number[]
): Promise<void> {
  const numericUserId = await getUserId(userId);
  if (!numericUserId) {
    throw new Error('User not found');
  }

  // Verify ownership
  if (!(await dbUserOwnsThread(numericUserId, threadId))) {
    throw new Error('Thread not found');
  }

  // Write to compat layer (routes to Postgres or SQLite based on provider)
  await dbSetThreadCategories(threadId, categoryIds);
}

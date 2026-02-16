/**
 * Storage Monitoring Module
 *
 * Provides system statistics for admin dashboard:
 * - Database statistics (users, threads, documents)
 * - ChromaDB collection stats
 * - File storage usage
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getDataDir, getGlobalDocsDir, getThreadsDir } from './storage';
import { queryOne, queryAll } from './db';
import {
  getChromaClient,
  getCollectionCount,
} from './chroma';

// ============ Types ============

export interface DatabaseStats {
  users: {
    total: number;
    admins: number;
    superUsers: number;
    regularUsers: number;
  };
  categories: {
    total: number;
    withDocuments: number;
    totalSubscriptions: number;
  };
  threads: {
    total: number;
    totalMessages: number;
    totalUploads: number;
  };
  documents: {
    total: number;
    globalDocuments: number;
    categoryDocuments: number;
    totalChunks: number;
    byStatus: {
      processing: number;
      ready: number;
      error: number;
    };
  };
}

export interface ChromaStats {
  connected: boolean;
  collections: {
    name: string;
    documentCount: number;
  }[];
  totalVectors: number;
  legacyCollectionCount: number;
  globalCollectionCount: number;
}

export interface FileStorageStats {
  globalDocsDir: {
    path: string;
    exists: boolean;
    fileCount: number;
    totalSizeBytes: number;
    totalSizeMB: number;
  };
  threadsDir: {
    path: string;
    exists: boolean;
    userCount: number;
    totalUploadSizeBytes: number;
    totalUploadSizeMB: number;
  };
  dataDir: {
    path: string;
    exists: boolean;
    totalSizeBytes: number;
    totalSizeMB: number;
  };
}

export interface SystemStats {
  timestamp: string;
  database: DatabaseStats;
  chroma: ChromaStats;
  storage: FileStorageStats;
}

// ============ Database Statistics ============

export function getDatabaseStats(): DatabaseStats {
  // User stats
  const userCounts = queryOne<{
    total: number;
    admins: number;
    superUsers: number;
    regularUsers: number;
  }>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
      SUM(CASE WHEN role = 'superuser' THEN 1 ELSE 0 END) as superUsers,
      SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as regularUsers
    FROM users
  `);

  // Category stats
  const categoryStats = queryOne<{
    total: number;
    withDocuments: number;
    totalSubscriptions: number;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM categories) as total,
      (SELECT COUNT(DISTINCT category_id) FROM document_categories) as withDocuments,
      (SELECT COUNT(*) FROM user_subscriptions WHERE is_active = 1) as totalSubscriptions
  `);

  // Thread stats
  const threadStats = queryOne<{
    total: number;
    totalMessages: number;
    totalUploads: number;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM threads) as total,
      (SELECT COUNT(*) FROM messages) as totalMessages,
      (SELECT COUNT(*) FROM thread_uploads) as totalUploads
  `);

  // Document stats
  const documentStats = queryOne<{
    total: number;
    globalDocs: number;
    categoryDocs: number;
    totalChunks: number;
    processingCount: number;
    readyCount: number;
    errorCount: number;
  }>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_global = 1 THEN 1 ELSE 0 END) as globalDocs,
      SUM(CASE WHEN is_global = 0 THEN 1 ELSE 0 END) as categoryDocs,
      SUM(chunk_count) as totalChunks,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processingCount,
      SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as readyCount,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errorCount
    FROM documents
  `);

  return {
    users: {
      total: userCounts?.total || 0,
      admins: userCounts?.admins || 0,
      superUsers: userCounts?.superUsers || 0,
      regularUsers: userCounts?.regularUsers || 0,
    },
    categories: {
      total: categoryStats?.total || 0,
      withDocuments: categoryStats?.withDocuments || 0,
      totalSubscriptions: categoryStats?.totalSubscriptions || 0,
    },
    threads: {
      total: threadStats?.total || 0,
      totalMessages: threadStats?.totalMessages || 0,
      totalUploads: threadStats?.totalUploads || 0,
    },
    documents: {
      total: documentStats?.total || 0,
      globalDocuments: documentStats?.globalDocs || 0,
      categoryDocuments: documentStats?.categoryDocs || 0,
      totalChunks: documentStats?.totalChunks || 0,
      byStatus: {
        processing: documentStats?.processingCount || 0,
        ready: documentStats?.readyCount || 0,
        error: documentStats?.errorCount || 0,
      },
    },
  };
}

// ============ ChromaDB Statistics ============

export async function getChromaStats(): Promise<ChromaStats> {
  try {
    const client = await getChromaClient();
    const collections = await client.listCollections();

    // Get counts for each collection
    const collectionStats: { name: string; documentCount: number }[] = [];
    let totalVectors = 0;
    let legacyCount = 0;
    let globalCount = 0;

    for (const name of collections as string[]) {
      try {
        const count = await getCollectionCount(name);
        collectionStats.push({ name, documentCount: count });
        totalVectors += count;

        if (name === 'organizational_documents') {
          legacyCount = count;
        } else if (name === 'global_documents') {
          globalCount = count;
        }
      } catch {
        collectionStats.push({ name, documentCount: 0 });
      }
    }

    return {
      connected: true,
      collections: collectionStats,
      totalVectors,
      legacyCollectionCount: legacyCount,
      globalCollectionCount: globalCount,
    };
  } catch (error) {
    console.error('Failed to get ChromaDB stats:', error);
    return {
      connected: false,
      collections: [],
      totalVectors: 0,
      legacyCollectionCount: 0,
      globalCollectionCount: 0,
    };
  }
}

// ============ File Storage Statistics ============

async function getDirSize(dirPath: string): Promise<{ fileCount: number; totalSize: number }> {
  let fileCount = 0;
  let totalSize = 0;

  async function walkDir(currentPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.isFile()) {
          fileCount++;
          try {
            const stats = await fs.stat(fullPath);
            totalSize += stats.size;
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  await walkDir(dirPath);
  return { fileCount, totalSize };
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function countSubdirs(dirPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

export async function getFileStorageStats(): Promise<FileStorageStats> {
  const dataDir = getDataDir();
  const globalDocsDir = getGlobalDocsDir();
  const threadsDir = getThreadsDir();

  // Global docs stats
  const globalDocsExists = await dirExists(globalDocsDir);
  const globalDocsSize = globalDocsExists ? await getDirSize(globalDocsDir) : { fileCount: 0, totalSize: 0 };

  // Threads dir stats
  const threadsDirExists = await dirExists(threadsDir);
  const userCount = threadsDirExists ? await countSubdirs(threadsDir) : 0;
  const threadsSize = threadsDirExists ? await getDirSize(threadsDir) : { fileCount: 0, totalSize: 0 };

  // Total data dir stats
  const dataDirExists = await dirExists(dataDir);
  const dataDirSize = dataDirExists ? await getDirSize(dataDir) : { fileCount: 0, totalSize: 0 };

  return {
    globalDocsDir: {
      path: globalDocsDir,
      exists: globalDocsExists,
      fileCount: globalDocsSize.fileCount,
      totalSizeBytes: globalDocsSize.totalSize,
      totalSizeMB: Math.round((globalDocsSize.totalSize / (1024 * 1024)) * 100) / 100,
    },
    threadsDir: {
      path: threadsDir,
      exists: threadsDirExists,
      userCount,
      totalUploadSizeBytes: threadsSize.totalSize,
      totalUploadSizeMB: Math.round((threadsSize.totalSize / (1024 * 1024)) * 100) / 100,
    },
    dataDir: {
      path: dataDir,
      exists: dataDirExists,
      totalSizeBytes: dataDirSize.totalSize,
      totalSizeMB: Math.round((dataDirSize.totalSize / (1024 * 1024)) * 100) / 100,
    },
  };
}

// ============ Combined System Stats ============

export async function getSystemStats(): Promise<SystemStats> {
  const [database, chroma, storage] = await Promise.all([
    Promise.resolve(getDatabaseStats()),
    getChromaStats(),
    getFileStorageStats(),
  ]);

  return {
    timestamp: new Date().toISOString(),
    database,
    chroma,
    storage,
  };
}

// ============ Category-Filtered Database Statistics (for Superusers) ============

export function getDatabaseStatsForCategories(categoryIds: number[]): DatabaseStats {
  if (categoryIds.length === 0) {
    return {
      users: { total: 0, admins: 0, superUsers: 0, regularUsers: 0 },
      categories: { total: 0, withDocuments: 0, totalSubscriptions: 0 },
      threads: { total: 0, totalMessages: 0, totalUploads: 0 },
      documents: { total: 0, globalDocuments: 0, categoryDocuments: 0, totalChunks: 0, byStatus: { processing: 0, ready: 0, error: 0 } },
    };
  }

  const placeholders = categoryIds.map(() => '?').join(', ');

  // User stats - count subscribers to assigned categories
  const userCounts = queryOne<{
    total: number;
  }>(`
    SELECT COUNT(DISTINCT u.id) as total
    FROM users u
    JOIN user_subscriptions us ON u.id = us.user_id
    WHERE us.category_id IN (${placeholders}) AND us.is_active = 1
  `, categoryIds);

  // Category stats - only assigned categories
  const categoryStats = queryOne<{
    total: number;
    withDocuments: number;
    totalSubscriptions: number;
  }>(`
    SELECT
      ? as total,
      (SELECT COUNT(DISTINCT dc.category_id) FROM document_categories dc WHERE dc.category_id IN (${placeholders})) as withDocuments,
      (SELECT COUNT(*) FROM user_subscriptions us WHERE us.category_id IN (${placeholders}) AND us.is_active = 1) as totalSubscriptions
  `, [categoryIds.length, ...categoryIds, ...categoryIds]);

  // Thread stats - threads from users subscribed to assigned categories
  const threadStats = queryOne<{
    total: number;
    totalMessages: number;
    totalUploads: number;
  }>(`
    SELECT
      COUNT(DISTINCT t.id) as total,
      (SELECT COUNT(*) FROM messages m WHERE m.thread_id IN (
        SELECT DISTINCT t2.id FROM threads t2
        JOIN users u ON t2.user_id = u.id
        JOIN user_subscriptions us ON u.id = us.user_id
        WHERE us.category_id IN (${placeholders}) AND us.is_active = 1
      )) as totalMessages,
      (SELECT COUNT(*) FROM thread_uploads tu WHERE tu.thread_id IN (
        SELECT DISTINCT t2.id FROM threads t2
        JOIN users u ON t2.user_id = u.id
        JOIN user_subscriptions us ON u.id = us.user_id
        WHERE us.category_id IN (${placeholders}) AND us.is_active = 1
      )) as totalUploads
    FROM threads t
    JOIN users u ON t.user_id = u.id
    JOIN user_subscriptions us ON u.id = us.user_id
    WHERE us.category_id IN (${placeholders}) AND us.is_active = 1
  `, [...categoryIds, ...categoryIds, ...categoryIds]);

  // Document stats - documents in assigned categories
  const documentStats = queryOne<{
    total: number;
    totalChunks: number;
    processingCount: number;
    readyCount: number;
    errorCount: number;
  }>(`
    SELECT
      COUNT(DISTINCT d.id) as total,
      SUM(d.chunk_count) as totalChunks,
      SUM(CASE WHEN d.status = 'processing' THEN 1 ELSE 0 END) as processingCount,
      SUM(CASE WHEN d.status = 'ready' THEN 1 ELSE 0 END) as readyCount,
      SUM(CASE WHEN d.status = 'error' THEN 1 ELSE 0 END) as errorCount
    FROM documents d
    JOIN document_categories dc ON d.id = dc.document_id
    WHERE dc.category_id IN (${placeholders})
  `, categoryIds);

  return {
    users: {
      total: userCounts?.total || 0,
      admins: 0,
      superUsers: 0,
      regularUsers: userCounts?.total || 0,
    },
    categories: {
      total: categoryStats?.total || 0,
      withDocuments: categoryStats?.withDocuments || 0,
      totalSubscriptions: categoryStats?.totalSubscriptions || 0,
    },
    threads: {
      total: threadStats?.total || 0,
      totalMessages: threadStats?.totalMessages || 0,
      totalUploads: threadStats?.totalUploads || 0,
    },
    documents: {
      total: documentStats?.total || 0,
      globalDocuments: 0,
      categoryDocuments: documentStats?.total || 0,
      totalChunks: documentStats?.totalChunks || 0,
      byStatus: {
        processing: documentStats?.processingCount || 0,
        ready: documentStats?.readyCount || 0,
        error: documentStats?.errorCount || 0,
      },
    },
  };
}

// ============ Recent Activity ============

export interface RecentActivity {
  recentThreads: {
    id: string;
    title: string;
    userEmail: string;
    messageCount: number;
    createdAt: string;
  }[];
  recentDocuments: {
    id: number;
    filename: string;
    uploadedBy: string;
    status: string;
    createdAt: string;
  }[];
  recentUsers: {
    id: number;
    email: string;
    role: string;
    createdAt: string;
  }[];
}

export function getRecentActivity(limit: number = 10): RecentActivity {
  const recentThreads = queryAll<{
    id: string;
    title: string;
    userEmail: string;
    messageCount: number;
    createdAt: string;
  }>(`
    SELECT
      t.id,
      t.title,
      u.email as userEmail,
      (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) as messageCount,
      t.created_at as createdAt
    FROM threads t
    JOIN users u ON t.user_id = u.id
    ORDER BY t.created_at DESC
    LIMIT ?
  `, [limit]);

  const recentDocuments = queryAll<{
    id: number;
    filename: string;
    uploadedBy: string;
    status: string;
    createdAt: string;
  }>(`
    SELECT id, filename, uploaded_by as uploadedBy, status, created_at as createdAt
    FROM documents
    ORDER BY created_at DESC
    LIMIT ?
  `, [limit]);

  const recentUsers = queryAll<{
    id: number;
    email: string;
    role: string;
    createdAt: string;
  }>(`
    SELECT id, email, role, created_at as createdAt
    FROM users
    ORDER BY created_at DESC
    LIMIT ?
  `, [limit]);

  return {
    recentThreads,
    recentDocuments,
    recentUsers,
  };
}

export function getRecentActivityForCategories(categoryIds: number[], limit: number = 10): RecentActivity {
  if (categoryIds.length === 0) {
    return { recentThreads: [], recentDocuments: [], recentUsers: [] };
  }

  const placeholders = categoryIds.map(() => '?').join(', ');

  // Recent threads from users subscribed to assigned categories
  const recentThreads = queryAll<{
    id: string;
    title: string;
    userEmail: string;
    messageCount: number;
    createdAt: string;
  }>(`
    SELECT DISTINCT
      t.id,
      t.title,
      u.email as userEmail,
      (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) as messageCount,
      t.created_at as createdAt
    FROM threads t
    JOIN users u ON t.user_id = u.id
    JOIN user_subscriptions us ON u.id = us.user_id
    WHERE us.category_id IN (${placeholders}) AND us.is_active = 1
    ORDER BY t.created_at DESC
    LIMIT ?
  `, [...categoryIds, limit]);

  // Recent documents in assigned categories
  const recentDocuments = queryAll<{
    id: number;
    filename: string;
    uploadedBy: string;
    status: string;
    createdAt: string;
  }>(`
    SELECT DISTINCT d.id, d.filename, d.uploaded_by as uploadedBy, d.status, d.created_at as createdAt
    FROM documents d
    JOIN document_categories dc ON d.id = dc.document_id
    WHERE dc.category_id IN (${placeholders})
    ORDER BY d.created_at DESC
    LIMIT ?
  `, [...categoryIds, limit]);

  // Recent users who subscribed to assigned categories
  const recentUsers = queryAll<{
    id: number;
    email: string;
    role: string;
    createdAt: string;
  }>(`
    SELECT DISTINCT u.id, u.email, u.role, u.created_at as createdAt
    FROM users u
    JOIN user_subscriptions us ON u.id = us.user_id
    WHERE us.category_id IN (${placeholders}) AND us.is_active = 1
    ORDER BY us.subscribed_at DESC
    LIMIT ?
  `, [...categoryIds, limit]);

  return {
    recentThreads,
    recentDocuments,
    recentUsers,
  };
}

/**
 * Storage Monitoring Module
 *
 * Provides system statistics for admin dashboard:
 * - Database statistics (users, threads, documents)
 * - Vector store collection stats (Qdrant)
 * - File storage usage
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getDataDir, getGlobalDocsDir, getThreadsDir } from './storage';
import { getDb } from './db/kysely';
import { sql } from 'kysely';
import {
  getVectorStore,
  getVectorStoreProvider,
  getCollectionNames,
  checkVectorStoreHealth,
} from './vector-store';

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

export interface VectorStoreStats {
  provider: string;
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
  vectorStore: VectorStoreStats;
  storage: FileStorageStats;
}

// ============ Database Statistics ============

export async function getDatabaseStats(): Promise<DatabaseStats> {
  const db = await getDb();

  // User stats
  const userCounts = await db.selectFrom('users')
    .select([
      db.fn.countAll().as('total'),
      sql<number>`SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END)`.as('admins'),
      sql<number>`SUM(CASE WHEN role = 'superuser' THEN 1 ELSE 0 END)`.as('super_users'),
      sql<number>`SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END)`.as('regular_users'),
    ])
    .executeTakeFirst();

  // Category stats
  const catTotal = await db.selectFrom('categories').select(db.fn.countAll().as('count')).executeTakeFirst();
  const withDocs = await db.selectFrom('document_categories').select(db.fn.count('category_id').distinct().as('count')).executeTakeFirst();
  const totalSubs = await db.selectFrom('user_subscriptions').select(db.fn.countAll().as('count')).where('is_active', '=', 1).executeTakeFirst();

  // Thread stats
  const threadTotal = await db.selectFrom('threads').select(db.fn.countAll().as('count')).executeTakeFirst();
  const msgTotal = await db.selectFrom('messages').select(db.fn.countAll().as('count')).executeTakeFirst();
  const uploadTotal = await db.selectFrom('thread_uploads').select(db.fn.countAll().as('count')).executeTakeFirst();

  // Document stats
  const docStats = await db.selectFrom('documents')
    .select([
      db.fn.countAll().as('total'),
      sql<number>`SUM(CASE WHEN is_global = 1 THEN 1 ELSE 0 END)`.as('global_docs'),
      sql<number>`SUM(CASE WHEN is_global = 0 THEN 1 ELSE 0 END)`.as('category_docs'),
      sql<number>`COALESCE(SUM(chunk_count), 0)`.as('total_chunks'),
      sql<number>`SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END)`.as('processing_count'),
      sql<number>`SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END)`.as('ready_count'),
      sql<number>`SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)`.as('error_count'),
    ])
    .executeTakeFirst();

  return {
    users: {
      total: Number(userCounts?.total) || 0,
      admins: Number(userCounts?.admins) || 0,
      superUsers: Number(userCounts?.super_users) || 0,
      regularUsers: Number(userCounts?.regular_users) || 0,
    },
    categories: {
      total: Number(catTotal?.count) || 0,
      withDocuments: Number(withDocs?.count) || 0,
      totalSubscriptions: Number(totalSubs?.count) || 0,
    },
    threads: {
      total: Number(threadTotal?.count) || 0,
      totalMessages: Number(msgTotal?.count) || 0,
      totalUploads: Number(uploadTotal?.count) || 0,
    },
    documents: {
      total: Number(docStats?.total) || 0,
      globalDocuments: Number(docStats?.global_docs) || 0,
      categoryDocuments: Number(docStats?.category_docs) || 0,
      totalChunks: Number(docStats?.total_chunks) || 0,
      byStatus: {
        processing: Number(docStats?.processing_count) || 0,
        ready: Number(docStats?.ready_count) || 0,
        error: Number(docStats?.error_count) || 0,
      },
    },
  };
}

// ============ Vector Store Statistics ============

export async function getVectorStats(): Promise<VectorStoreStats> {
  const provider = getVectorStoreProvider();
  const collNames = getCollectionNames();

  try {
    const healthResult = await checkVectorStoreHealth();
    if (!healthResult.healthy) {
      return {
        provider,
        connected: false,
        collections: [],
        totalVectors: 0,
        legacyCollectionCount: 0,
        globalCollectionCount: 0,
      };
    }

    const store = await getVectorStore();
    const collections = await store.listCollections();

    // Get counts for each collection
    const collectionStats: { name: string; documentCount: number }[] = [];
    let totalVectors = 0;
    let legacyCount = 0;
    let globalCount = 0;

    for (const name of collections) {
      try {
        const count = await store.getCollectionCount(name);
        collectionStats.push({ name, documentCount: count });
        totalVectors += count;

        if (name === collNames.legacy) {
          legacyCount = count;
        } else if (name === collNames.global) {
          globalCount = count;
        }
      } catch {
        collectionStats.push({ name, documentCount: 0 });
      }
    }

    return {
      provider,
      connected: true,
      collections: collectionStats,
      totalVectors,
      legacyCollectionCount: legacyCount,
      globalCollectionCount: globalCount,
    };
  } catch (error) {
    console.error(`Failed to get ${provider} stats:`, error);
    return {
      provider,
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
  const [database, vectorStore, storage] = await Promise.all([
    getDatabaseStats(),
    getVectorStats(),
    getFileStorageStats(),
  ]);

  return {
    timestamp: new Date().toISOString(),
    database,
    vectorStore,
    storage,
  };
}

// ============ Category-Filtered Database Statistics (for Superusers) ============

export async function getDatabaseStatsForCategories(categoryIds: number[]): Promise<DatabaseStats> {
  if (categoryIds.length === 0) {
    return {
      users: { total: 0, admins: 0, superUsers: 0, regularUsers: 0 },
      categories: { total: 0, withDocuments: 0, totalSubscriptions: 0 },
      threads: { total: 0, totalMessages: 0, totalUploads: 0 },
      documents: { total: 0, globalDocuments: 0, categoryDocuments: 0, totalChunks: 0, byStatus: { processing: 0, ready: 0, error: 0 } },
    };
  }

  const db = await getDb();

  // User stats - count subscribers to assigned categories
  const userCounts = await db.selectFrom('users as u')
    .innerJoin('user_subscriptions as us', 'u.id', 'us.user_id')
    .where('us.category_id', 'in', categoryIds)
    .where('us.is_active', '=', 1)
    .select(sql<number>`COUNT(DISTINCT u.id)`.as('total'))
    .executeTakeFirst();

  // Category stats - only assigned categories
  const withDocuments = await db.selectFrom('document_categories as dc')
    .where('dc.category_id', 'in', categoryIds)
    .select(sql<number>`COUNT(DISTINCT dc.category_id)`.as('count'))
    .executeTakeFirst();

  const totalSubscriptions = await db.selectFrom('user_subscriptions as us')
    .where('us.category_id', 'in', categoryIds)
    .where('us.is_active', '=', 1)
    .select(db.fn.countAll().as('count'))
    .executeTakeFirst();

  // Thread stats - threads from users subscribed to assigned categories
  // Build a subquery for thread IDs belonging to users in these categories
  const threadIdsSubquery = db.selectFrom('threads as t2')
    .innerJoin('users as u', 't2.user_id', 'u.id')
    .innerJoin('user_subscriptions as us', 'u.id', 'us.user_id')
    .where('us.category_id', 'in', categoryIds)
    .where('us.is_active', '=', 1)
    .select('t2.id');

  const threadTotal = await db.selectFrom('threads as t')
    .innerJoin('users as u', 't.user_id', 'u.id')
    .innerJoin('user_subscriptions as us', 'u.id', 'us.user_id')
    .where('us.category_id', 'in', categoryIds)
    .where('us.is_active', '=', 1)
    .select(sql<number>`COUNT(DISTINCT t.id)`.as('count'))
    .executeTakeFirst();

  const msgTotal = await db.selectFrom('messages as m')
    .where('m.thread_id', 'in', threadIdsSubquery)
    .select(db.fn.countAll().as('count'))
    .executeTakeFirst();

  const uploadTotal = await db.selectFrom('thread_uploads as tu')
    .where('tu.thread_id', 'in', threadIdsSubquery)
    .select(db.fn.countAll().as('count'))
    .executeTakeFirst();

  // Document stats - documents in assigned categories
  const documentStats = await db.selectFrom('documents as d')
    .innerJoin('document_categories as dc', 'd.id', 'dc.document_id')
    .where('dc.category_id', 'in', categoryIds)
    .select([
      sql<number>`COUNT(DISTINCT d.id)`.as('total'),
      sql<number>`COALESCE(SUM(d.chunk_count), 0)`.as('total_chunks'),
      sql<number>`SUM(CASE WHEN d.status = 'processing' THEN 1 ELSE 0 END)`.as('processing_count'),
      sql<number>`SUM(CASE WHEN d.status = 'ready' THEN 1 ELSE 0 END)`.as('ready_count'),
      sql<number>`SUM(CASE WHEN d.status = 'error' THEN 1 ELSE 0 END)`.as('error_count'),
    ])
    .executeTakeFirst();

  return {
    users: {
      total: Number(userCounts?.total) || 0,
      admins: 0,
      superUsers: 0,
      regularUsers: Number(userCounts?.total) || 0,
    },
    categories: {
      total: categoryIds.length,
      withDocuments: Number(withDocuments?.count) || 0,
      totalSubscriptions: Number(totalSubscriptions?.count) || 0,
    },
    threads: {
      total: Number(threadTotal?.count) || 0,
      totalMessages: Number(msgTotal?.count) || 0,
      totalUploads: Number(uploadTotal?.count) || 0,
    },
    documents: {
      total: Number(documentStats?.total) || 0,
      globalDocuments: 0,
      categoryDocuments: Number(documentStats?.total) || 0,
      totalChunks: Number(documentStats?.total_chunks) || 0,
      byStatus: {
        processing: Number(documentStats?.processing_count) || 0,
        ready: Number(documentStats?.ready_count) || 0,
        error: Number(documentStats?.error_count) || 0,
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

export async function getRecentActivity(limit: number = 10): Promise<RecentActivity> {
  const db = await getDb();

  const recentThreads = await db.selectFrom('threads as t')
    .innerJoin('users as u', 't.user_id', 'u.id')
    .select([
      't.id',
      't.title',
      'u.email as userEmail',
      sql<number>`(SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id)`.as('messageCount'),
      't.created_at as createdAt',
    ])
    .orderBy('t.created_at', 'desc')
    .limit(limit)
    .execute();

  const recentDocuments = await db.selectFrom('documents')
    .select([
      'id',
      'filename',
      'uploaded_by as uploadedBy',
      'status',
      'created_at as createdAt',
    ])
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

  const recentUsers = await db.selectFrom('users')
    .select([
      'id',
      'email',
      'role',
      'created_at as createdAt',
    ])
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

  return {
    recentThreads: recentThreads.map(t => ({
      id: t.id,
      title: t.title,
      userEmail: t.userEmail,
      messageCount: Number(t.messageCount) || 0,
      createdAt: t.createdAt,
    })),
    recentDocuments: recentDocuments.map(d => ({
      id: d.id,
      filename: d.filename,
      uploadedBy: d.uploadedBy,
      status: d.status,
      createdAt: d.createdAt,
    })),
    recentUsers: recentUsers.map(u => ({
      id: u.id,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
    })),
  };
}

export async function getRecentActivityForCategories(categoryIds: number[], limit: number = 10): Promise<RecentActivity> {
  if (categoryIds.length === 0) {
    return { recentThreads: [], recentDocuments: [], recentUsers: [] };
  }

  const db = await getDb();

  // Recent threads from users subscribed to assigned categories
  const recentThreads = await db.selectFrom('threads as t')
    .innerJoin('users as u', 't.user_id', 'u.id')
    .innerJoin('user_subscriptions as us', 'u.id', 'us.user_id')
    .where('us.category_id', 'in', categoryIds)
    .where('us.is_active', '=', 1)
    .select([
      't.id',
      't.title',
      'u.email as userEmail',
      sql<number>`(SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id)`.as('messageCount'),
      't.created_at as createdAt',
    ])
    .groupBy(['t.id', 't.title', 'u.email', 't.created_at'])
    .orderBy('t.created_at', 'desc')
    .limit(limit)
    .execute();

  // Recent documents in assigned categories
  const recentDocuments = await db.selectFrom('documents as d')
    .innerJoin('document_categories as dc', 'd.id', 'dc.document_id')
    .where('dc.category_id', 'in', categoryIds)
    .select([
      'd.id',
      'd.filename',
      'd.uploaded_by as uploadedBy',
      'd.status',
      'd.created_at as createdAt',
    ])
    .groupBy(['d.id', 'd.filename', 'd.uploaded_by', 'd.status', 'd.created_at'])
    .orderBy('d.created_at', 'desc')
    .limit(limit)
    .execute();

  // Recent users who subscribed to assigned categories
  const recentUsers = await db.selectFrom('users as u')
    .innerJoin('user_subscriptions as us', 'u.id', 'us.user_id')
    .where('us.category_id', 'in', categoryIds)
    .where('us.is_active', '=', 1)
    .select([
      'u.id',
      'u.email',
      'u.role',
      'u.created_at as createdAt',
      'us.subscribed_at',
    ])
    .groupBy(['u.id', 'u.email', 'u.role', 'u.created_at', 'us.subscribed_at'])
    .orderBy('us.subscribed_at', 'desc')
    .limit(limit)
    .execute();

  return {
    recentThreads: recentThreads.map(t => ({
      id: t.id,
      title: t.title,
      userEmail: t.userEmail,
      messageCount: Number(t.messageCount) || 0,
      createdAt: t.createdAt,
    })),
    recentDocuments: recentDocuments.map(d => ({
      id: d.id,
      filename: d.filename,
      uploadedBy: d.uploadedBy,
      status: d.status,
      createdAt: d.createdAt,
    })),
    recentUsers: recentUsers.map(u => ({
      id: u.id,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
    })),
  };
}

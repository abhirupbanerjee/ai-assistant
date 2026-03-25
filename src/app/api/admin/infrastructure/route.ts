/**
 * Admin Infrastructure API
 *
 * GET /api/admin/infrastructure
 * Returns infrastructure configuration and health status:
 * - Database provider (SQLite/PostgreSQL) with connection status
 * - Vector store provider (Qdrant) with connection status
 * - Build-time configuration info
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/kysely';
import {
  getVectorStoreProvider,
  checkVectorStoreHealth,
  getVectorStoreStats,
} from '@/lib/vector-store';
import type { ApiError } from '@/types';

interface DatabaseInfo {
  provider: 'postgres';
  connected: boolean;
  connectionString?: string; // Masked for security
  version?: string;
  error?: string;
}

interface VectorStoreInfo {
  provider: 'qdrant';
  connected: boolean;
  host?: string;
  collections: number;
  totalVectors: number;
  error?: string;
}

interface InfrastructureStatus {
  timestamp: string;
  database: DatabaseInfo;
  vectorStore: VectorStoreInfo;
  environment: {
    nodeEnv: string;
    maxUploadSize: string;
  };
}

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Authentication required', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    // Get database info
    let dbInfo: DatabaseInfo = {
      provider: 'postgres',
      connected: false,
    };

    try {
      const db = await getDb();
      // Test connection with a simple query
      await db.selectFrom('users').select('id').limit(1).execute();
      dbInfo.connected = true;
      // Mask connection string for security
      const dbUrl = process.env.DATABASE_URL || '';
      if (dbUrl) {
        const match = dbUrl.match(/@([^/]+)/);
        dbInfo.connectionString = match ? `***@${match[1]}` : '***';
      }
    } catch (error) {
      dbInfo.error = error instanceof Error ? error.message : 'Connection failed';
    }

    // Get vector store info
    const vsProvider = getVectorStoreProvider();
    let vsInfo: VectorStoreInfo = {
      provider: vsProvider,
      connected: false,
      collections: 0,
      totalVectors: 0,
    };

    try {
      const health = await checkVectorStoreHealth();
      vsInfo.connected = health.healthy;

      if (health.healthy) {
        const stats = await getVectorStoreStats();
        vsInfo.collections = stats.collections.length;
        vsInfo.totalVectors = stats.totalVectors;
      }

      // Add host info
      const host = process.env.QDRANT_HOST || 'localhost';
      const port = process.env.QDRANT_PORT || '6333';
      vsInfo.host = `${host}:${port}`;

      if (health.error) {
        vsInfo.error = health.error;
      }
    } catch (error) {
      vsInfo.error = error instanceof Error ? error.message : 'Connection failed';
    }

    const response: InfrastructureStatus = {
      timestamp: new Date().toISOString(),
      database: dbInfo,
      vectorStore: vsInfo,
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        maxUploadSize: process.env.MAX_UPLOAD_SIZE || '500mb',
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Failed to fetch infrastructure status:', error);
    return NextResponse.json<ApiError>(
      { error: 'Failed to fetch infrastructure status', code: 'SERVICE_ERROR' },
      { status: 500 }
    );
  }
}

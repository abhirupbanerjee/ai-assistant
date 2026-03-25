/**
 * Admin Stats API
 *
 * GET /api/admin/stats
 * Returns system statistics for the admin dashboard:
 * - Database stats (users, threads, documents)
 * - Vector store stats (collections, vector counts)
 * - File storage stats (disk usage)
 * - Recent activity
 *
 * For superusers: returns category-scoped stats for their assigned categories
 * For admins: returns global system-wide stats
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getSystemStats,
  getRecentActivity,
  getDatabaseStatsForCategories,
  getRecentActivityForCategories,
  getVectorStats,
  getFileStorageStats,
} from '@/lib/monitoring';
import { getUserId } from '@/lib/users';
import { getSuperUserWithAssignments } from '@/lib/db/compat';
import type { ApiError } from '@/types';

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' } as ApiError,
        { status: 401 }
      );
    }

    // Allow both admin and superuser roles
    if (user.role !== 'admin' && user.role !== 'superuser') {
      return NextResponse.json(
        { error: 'Admin or superuser access required' } as ApiError,
        { status: 403 }
      );
    }

    // For superusers, return category-scoped stats
    if (user.role === 'superuser') {
      const userId = await getUserId(user.email);
      if (!userId) {
        return NextResponse.json(
          { error: 'User not found' } as ApiError,
          { status: 404 }
        );
      }

      const superUserData = await getSuperUserWithAssignments(userId);
      const categoryIds = superUserData?.assignedCategories.map(c => c.categoryId) || [];

      // Get filtered database stats and global system stats
      const [database, vectorStore, storage, recentActivity] = await Promise.all([
        getDatabaseStatsForCategories(categoryIds),
        getVectorStats(),
        getFileStorageStats(),
        getRecentActivityForCategories(categoryIds, 10),
      ]);

      return NextResponse.json({
        timestamp: new Date().toISOString(),
        database,
        vectorStore,
        storage,
        recentActivity,
        // Include info about the scope for UI display
        scope: {
          type: 'categories',
          categoryIds,
          categoryCount: categoryIds.length,
        },
      });
    }

    // For admins, return global system-wide stats (unchanged behavior)
    const [systemStats, recentActivity] = await Promise.all([
      getSystemStats(),
      getRecentActivity(10),
    ]);

    return NextResponse.json({
      ...systemStats,
      recentActivity,
      scope: { type: 'global' },
    });
  } catch (error) {
    console.error('Failed to fetch system stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch system stats' } as ApiError,
      { status: 500 }
    );
  }
}

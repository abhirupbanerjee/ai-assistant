/**
 * Super User Stats API
 *
 * GET /api/superuser/stats
 * Returns statistics for super user's assigned categories:
 * - Document counts and status
 * - User/subscriber counts
 * - Recent activity in their categories
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments, getUsersSubscribedToCategory } from '@/lib/db/compat';
import { getDb } from '@/lib/db/kysely';
import { getCategoryPrompt } from '@/lib/db/compat/category-prompts';
import { sql } from 'kysely';

interface CategoryStats {
  categoryId: number;
  categoryName: string;
  categorySlug: string;
  documentCount: number;
  readyDocuments: number;
  processingDocuments: number;
  errorDocuments: number;
  totalChunks: number;
  subscriberCount: number;
  activeSubscribers: number;
  hasCustomPrompt: boolean;
}

interface SuperUserStats {
  timestamp: string;
  assignedCategories: number;
  totalDocuments: number;
  totalSubscribers: number;
  categories: CategoryStats[];
  recentDocuments: {
    id: number;
    filename: string;
    categoryName: string;
    status: string;
    uploadedBy: string;
    uploadedAt: string;
  }[];
  recentSubscriptions: {
    userEmail: string;
    categoryName: string;
    subscribedAt: string;
    isActive: boolean;
  }[];
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Super user access required' }, { status: 403 });
    }

    const userId = await getUserId(user.email);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get super user's assigned categories
    const superUserData = await getSuperUserWithAssignments(userId);
    if (!superUserData || superUserData.assignedCategories.length === 0) {
      return NextResponse.json({
        timestamp: new Date().toISOString(),
        assignedCategories: 0,
        totalDocuments: 0,
        totalSubscribers: 0,
        categories: [],
        recentDocuments: [],
        recentSubscriptions: [],
      } as SuperUserStats);
    }

    const categoryIds = superUserData.assignedCategories.map(c => c.categoryId);
    const db = await getDb();

    // Get document stats per category
    const categoryDocStats = await db
      .selectFrom('document_categories as dc')
      .innerJoin('documents as d', 'dc.document_id', 'd.id')
      .select([
        'dc.category_id',
        sql<number>`COUNT(DISTINCT dc.document_id)`.as('documentCount'),
        sql<number>`SUM(CASE WHEN d.status = 'ready' THEN 1 ELSE 0 END)`.as('readyCount'),
        sql<number>`SUM(CASE WHEN d.status = 'processing' THEN 1 ELSE 0 END)`.as('processingCount'),
        sql<number>`SUM(CASE WHEN d.status = 'error' THEN 1 ELSE 0 END)`.as('errorCount'),
        sql<number>`COALESCE(SUM(d.chunk_count), 0)`.as('totalChunks'),
      ])
      .where('dc.category_id', 'in', categoryIds)
      .groupBy('dc.category_id')
      .execute();

    // Build category stats
    const categories: CategoryStats[] = [];
    let totalDocuments = 0;
    let totalSubscribers = 0;

    for (const cat of superUserData.assignedCategories) {
      const docStats = categoryDocStats.find(s => s.category_id === cat.categoryId);
      const subscribers = await getUsersSubscribedToCategory(cat.categoryId);
      const activeSubscribers = subscribers.filter(s => s.isActive).length;
      const hasCustomPrompt = !!(await getCategoryPrompt(cat.categoryId));

      const catStats: CategoryStats = {
        categoryId: cat.categoryId,
        categoryName: cat.categoryName,
        categorySlug: cat.categorySlug,
        documentCount: docStats?.documentCount || 0,
        readyDocuments: docStats?.readyCount || 0,
        processingDocuments: docStats?.processingCount || 0,
        errorDocuments: docStats?.errorCount || 0,
        totalChunks: docStats?.totalChunks || 0,
        subscriberCount: subscribers.length,
        activeSubscribers,
        hasCustomPrompt,
      };

      categories.push(catStats);
      totalDocuments += catStats.documentCount;
      totalSubscribers += activeSubscribers;
    }

    // Get recent documents in super user's categories
    const recentDocuments = await db
      .selectFrom('documents as d')
      .innerJoin('document_categories as dc', 'd.id', 'dc.document_id')
      .innerJoin('categories as c', 'dc.category_id', 'c.id')
      .select([
        'd.id',
        'd.filename',
        'c.name as categoryName',
        'd.status',
        'd.uploaded_by as uploadedBy',
        'd.created_at as uploadedAt',
      ])
      .where('dc.category_id', 'in', categoryIds)
      .orderBy('d.created_at', 'desc')
      .limit(10)
      .execute();

    // Get recent subscriptions in super user's categories
    const recentSubscriptions = await db
      .selectFrom('user_subscriptions as us')
      .innerJoin('users as u', 'us.user_id', 'u.id')
      .innerJoin('categories as c', 'us.category_id', 'c.id')
      .select([
        'u.email as userEmail',
        'c.name as categoryName',
        'us.subscribed_at as subscribedAt',
        'us.is_active as isActive',
      ])
      .where('us.category_id', 'in', categoryIds)
      .orderBy('us.subscribed_at', 'desc')
      .limit(10)
      .execute();

    const stats: SuperUserStats = {
      timestamp: new Date().toISOString(),
      assignedCategories: superUserData.assignedCategories.length,
      totalDocuments,
      totalSubscribers,
      categories,
      recentDocuments,
      recentSubscriptions: recentSubscriptions.map(s => ({
        ...s,
        isActive: Boolean(s.isActive),
      })),
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching super user stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}

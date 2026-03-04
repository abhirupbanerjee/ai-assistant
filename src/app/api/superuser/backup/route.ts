/**
 * Super User Backup API
 *
 * POST /api/superuser/backup
 * Exports threads and messages from categories assigned to the superuser.
 * Returns JSON file with thread data scoped to their assigned categories.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments } from '@/lib/db/compat';
import { getDb } from '@/lib/db/kysely';
import type { ApiError } from '@/types';

interface ThreadExport {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  categories: {
    id: number;
    name: string;
    slug: string;
  }[];
  messages: {
    id: string;
    role: string;
    content: string;
    createdAt: string;
  }[];
}

interface BackupData {
  exportedAt: string;
  exportedBy: string;
  version: string;
  categories: {
    id: number;
    name: string;
    slug: string;
  }[];
  threads: ThreadExport[];
}

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json<ApiError>(
        { error: 'Super user access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const userId = await getUserId(user.email);
    if (!userId) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get super user's assigned categories
    const superUserData = await getSuperUserWithAssignments(userId);
    if (!superUserData || superUserData.assignedCategories.length === 0) {
      // Return empty backup if no categories assigned
      const emptyBackup: BackupData = {
        exportedAt: new Date().toISOString(),
        exportedBy: user.email,
        version: '1.0',
        categories: [],
        threads: [],
      };
      return new Response(JSON.stringify(emptyBackup, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="threads-backup-${new Date().toISOString().split('T')[0]}.json"`,
        },
      });
    }

    const categoryIds = superUserData.assignedCategories.map(c => c.categoryId);
    const db = await getDb();

    // Get threads that have at least one category in the superuser's assigned categories
    const threads = await db
      .selectFrom('threads as t')
      .innerJoin('thread_categories as tc', 't.id', 'tc.thread_id')
      .select(['t.id', 't.title', 't.created_at', 't.updated_at'])
      .where('tc.category_id', 'in', categoryIds)
      .distinct()
      .orderBy('t.updated_at', 'desc')
      .execute();

    // Build thread exports with messages
    const threadExports: ThreadExport[] = [];

    for (const thread of threads) {
      // Get categories for this thread (only the ones superuser has access to)
      const threadCategories = await db
        .selectFrom('categories as c')
        .innerJoin('thread_categories as tc', 'c.id', 'tc.category_id')
        .select(['c.id', 'c.name', 'c.slug'])
        .where('tc.thread_id', '=', thread.id)
        .where('c.id', 'in', categoryIds)
        .execute();

      // Get messages for this thread
      const messages = await db
        .selectFrom('messages')
        .select(['id', 'role', 'content', 'created_at'])
        .where('thread_id', '=', thread.id)
        .orderBy('created_at', 'asc')
        .execute();

      threadExports.push({
        id: thread.id,
        title: thread.title as string,
        createdAt: thread.created_at as string,
        updatedAt: thread.updated_at as string,
        categories: threadCategories,
        messages: messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.created_at as string,
        })),
      });
    }

    const backup: BackupData = {
      exportedAt: new Date().toISOString(),
      exportedBy: user.email,
      version: '1.0',
      categories: superUserData.assignedCategories.map(c => ({
        id: c.categoryId,
        name: c.categoryName,
        slug: c.categorySlug,
      })),
      threads: threadExports,
    };

    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="threads-backup-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (error) {
    console.error('Superuser backup error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to create backup',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail, getCategoriesByIds } from '@/lib/db/compat';
import {
  getAllMemoriesForUser,
  clearMemory,
  getMemoryForUser,
  deleteFact,
} from '@/lib/memory';
import type { ApiError } from '@/types';

/**
 * GET /api/user/memory
 * Get all memories for the current user
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get all memories for the user
    const memories = await getAllMemoriesForUser(dbUser.id);

    // Get category information for each memory
    const categoryIds = memories
      .map((m) => m.categoryId)
      .filter((id): id is number => id !== null);

    const categories = categoryIds.length > 0
      ? await getCategoriesByIds(categoryIds)
      : [];

    // Map memories with category info
    const memoriesWithCategories = memories.map((memory) => {
      const category = memory.categoryId
        ? categories.find((c) => c.id === memory.categoryId)
        : null;

      return {
        id: memory.id,
        categoryId: memory.categoryId,
        categoryName: category?.name || (memory.categoryId === null ? 'Global' : 'Unknown'),
        categorySlug: category?.slug || null,
        // Extract text from FactEntry[] for backward-compatible string[] response
        facts: memory.facts.map(f => typeof f === 'string' ? f : f.text),
        updatedAt: memory.updatedAt,
      };
    });

    return NextResponse.json({
      memories: memoriesWithCategories,
      totalFacts: memories.reduce((sum, m) => sum + m.facts.length, 0),
    });
  } catch (error) {
    console.error('Get user memory error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to get memories',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/user/memory
 * Clear memories for the current user
 * Query params:
 *   - categoryId: Optional category ID to clear (omit to clear all)
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const categoryIdParam = searchParams.get('categoryId');

    if (categoryIdParam) {
      // Clear specific category memory
      const categoryId = categoryIdParam === 'global' ? null : parseInt(categoryIdParam, 10);
      if (categoryIdParam !== 'global' && isNaN(categoryId as number)) {
        return NextResponse.json<ApiError>(
          { error: 'Invalid category ID', code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }

      // Check memory exists before clearing
      const memory = await getMemoryForUser(dbUser.id, categoryId);
      if (!memory) {
        return NextResponse.json<ApiError>(
          { error: 'Memory not found for this category', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }

      await clearMemory(dbUser.id, categoryId);
      return NextResponse.json({
        success: true,
        message: `Cleared memory for ${categoryIdParam === 'global' ? 'global context' : `category ${categoryId}`}`,
      });
    } else {
      // Clear all memories
      await clearMemory(dbUser.id);
      return NextResponse.json({
        success: true,
        message: 'Cleared all memories',
      });
    }
  } catch (error) {
    console.error('Clear user memory error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to clear memories',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/user/memory
 * Delete a single fact from memory
 * Body: { categoryId: number | null, factText: string }
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json<ApiError>(
        { error: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { categoryId, factText } = body;

    if (!factText || typeof factText !== 'string') {
      return NextResponse.json<ApiError>(
        { error: 'factText is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // categoryId can be null (global), a number, or omitted (defaults to null)
    const resolvedCategoryId = body.categoryId === undefined ? null : categoryId;

    await deleteFact(dbUser.id, resolvedCategoryId, factText);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete fact error:', error);
    return NextResponse.json<ApiError>(
      {
        error: error instanceof Error ? error.message : 'Failed to delete fact',
        code: 'SERVICE_ERROR',
      },
      { status: 500 }
    );
  }
}

/**
 * Super User - Text Content Upload API
 *
 * POST /api/superuser/documents/text - Upload text content to one of super user's assigned categories
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments, getCategoryById, getDocumentsByCategory } from '@/lib/db/compat';
import { ingestTextContent } from '@/lib/ingest';

const MAX_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB
const MIN_CONTENT_LENGTH = 10; // Minimum 10 characters
const MAX_NAME_LENGTH = 255;

export async function POST(request: NextRequest) {
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
      return NextResponse.json(
        { error: 'No categories assigned to you' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, content, categoryId } = body as {
      name?: string;
      content?: string;
      categoryId?: number;
    };

    // Validate name
    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Document name is required' },
        { status: 400 }
      );
    }

    if (name.length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Document name must be ${MAX_NAME_LENGTH} characters or less` },
        { status: 400 }
      );
    }

    // Validate content
    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      );
    }

    if (content.length < MIN_CONTENT_LENGTH) {
      return NextResponse.json(
        { error: `Content must be at least ${MIN_CONTENT_LENGTH} characters` },
        { status: 400 }
      );
    }

    const contentSize = Buffer.byteLength(content, 'utf-8');
    if (contentSize > MAX_CONTENT_SIZE) {
      return NextResponse.json(
        { error: `Content too large (max ${MAX_CONTENT_SIZE / 1024 / 1024}MB)` },
        { status: 413 }
      );
    }

    // Validate category ID
    if (!categoryId || typeof categoryId !== 'number') {
      return NextResponse.json(
        { error: 'Category ID is required' },
        { status: 400 }
      );
    }

    // Verify super user has access to this category
    const hasAccess = superUserData.assignedCategories.some(c => c.categoryId === categoryId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'You do not have access to upload to this category' },
        { status: 403 }
      );
    }

    // Verify category exists
    const category = await getCategoryById(categoryId);
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    // Check for duplicate filename in this category
    const filename = name.endsWith('.txt') ? name : `${name}.txt`;
    const categoryDocs = await getDocumentsByCategory(categoryId);
    if (categoryDocs.some(d => d.filename.toLowerCase() === filename.toLowerCase())) {
      return NextResponse.json(
        { error: 'Document with this name already exists in this category' },
        { status: 409 }
      );
    }

    // Ingest text content (super users cannot upload global documents)
    const doc = await ingestTextContent(content, name, user.email, {
      categoryIds: [categoryId],
      isGlobal: false,
    });

    return NextResponse.json(
      {
        id: doc.id,
        filename: doc.filename,
        size: doc.size,
        status: 'processing',
        message: 'Document is being processed',
        category: {
          categoryId: category.id,
          categoryName: category.name,
        },
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('Error uploading text content:', error);
    return NextResponse.json(
      {
        error: 'Failed to upload text content',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

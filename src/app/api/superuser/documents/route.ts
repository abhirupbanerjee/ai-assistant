/**
 * Super User - Document Management API
 *
 * GET  /api/superuser/documents - Get documents in super user's assigned categories
 * POST /api/superuser/documents - Upload document to one of super user's assigned categories
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments, getCategoryById, getDocumentsByCategory } from '@/lib/db/compat';
import { ingestDocument } from '@/lib/ingest';
import { isSupportedMimeType } from '@/lib/document-extractor';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

interface DocumentResponse {
  id: number;
  filename: string;
  size: number;
  status: string;
  uploadedBy: string;
  uploadedAt: string;
  categories: Array<{ categoryId: number; categoryName: string }>;
}

// GET - Get documents in super user's assigned categories
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
        assignedCategories: [],
        documents: [],
      });
    }

    // Get documents for each assigned category
    const documentsMap = new Map<number, DocumentResponse>();

    for (const category of superUserData.assignedCategories) {
      const docs = await getDocumentsByCategory(category.categoryId);

      for (const doc of docs) {
        if (!documentsMap.has(doc.id)) {
          documentsMap.set(doc.id, {
            id: doc.id,
            filename: doc.filename,
            size: doc.file_size,
            status: doc.status,
            uploadedBy: doc.uploaded_by,
            uploadedAt: doc.created_at,
            categories: [],
          });
        }

        const docEntry = documentsMap.get(doc.id)!;
        docEntry.categories.push({
          categoryId: category.categoryId,
          categoryName: category.categoryName,
        });
      }
    }

    return NextResponse.json({
      assignedCategories: superUserData.assignedCategories,
      documents: Array.from(documentsMap.values()),
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
  }
}

// POST - Upload document to one of super user's assigned categories
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

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const categoryIdStr = formData.get('categoryId') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!categoryIdStr) {
      return NextResponse.json({ error: 'Category ID is required' }, { status: 400 });
    }

    const categoryId = parseInt(categoryIdStr, 10);
    if (isNaN(categoryId)) {
      return NextResponse.json({ error: 'Invalid category ID' }, { status: 400 });
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

    // Validate file type (PDF, images, DOCX, XLSX, PPTX, TXT, MD)
    if (!isSupportedMimeType(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: PDF, DOCX, XLSX, PPTX, TXT, MD, JSON, PNG, JPG, WEBP, GIF` },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` },
        { status: 413 }
      );
    }

    // Convert to buffer and ingest
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Super users can only upload to their assigned categories, NOT global
    const doc = await ingestDocument(buffer, file.name, user.email, {
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
    console.error('Error uploading document:', error);
    return NextResponse.json(
      {
        error: 'Failed to upload document',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

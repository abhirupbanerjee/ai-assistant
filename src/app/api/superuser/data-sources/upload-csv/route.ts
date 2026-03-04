/**
 * Superuser CSV Upload API
 *
 * POST /api/superuser/data-sources/upload-csv - Upload and create a CSV data source
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments } from '@/lib/db/compat';
import { parseCSVBuffer, storeCSVFile } from '@/lib/data-sources/csv-handler';
import { createDataCSV } from '@/lib/db/compat/data-sources';

/**
 * POST /api/superuser/data-sources/upload-csv
 * Upload a CSV file and create a data source (for assigned categories only)
 *
 * Body: FormData with 'file', 'name', 'description', 'categoryIds'
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Superuser access required' }, { status: 403 });
    }

    const userId = await getUserId(user.email);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get superuser's assigned categories
    const superUserData = await getSuperUserWithAssignments(userId);
    if (!superUserData) {
      return NextResponse.json({ error: 'Superuser data not found' }, { status: 404 });
    }

    const assignedCategoryIds = superUserData.assignedCategories.map(c => c.categoryId);

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const name = formData.get('name') as string | null;
    const description = formData.get('description') as string || '';
    const categoryIdsStr = formData.get('categoryIds') as string | null;

    // Validate required fields
    if (!file) {
      return NextResponse.json(
        { error: 'CSV file is required' },
        { status: 400 }
      );
    }
    if (!name) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }

    // Check file type
    if (!file.name.toLowerCase().endsWith('.csv')) {
      return NextResponse.json(
        { error: 'File must be a CSV file' },
        { status: 400 }
      );
    }

    // Check file size (max 50MB)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File size must be less than 50MB' },
        { status: 400 }
      );
    }

    // Parse category IDs
    let categoryIds: number[] = [];
    if (categoryIdsStr) {
      try {
        categoryIds = JSON.parse(categoryIdsStr);
        if (!Array.isArray(categoryIds)) {
          categoryIds = [];
        }
      } catch {
        // Try parsing as comma-separated
        categoryIds = categoryIdsStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      }
    }

    // Validate category access - ensure all requested categories are assigned
    const unauthorizedCategories = categoryIds.filter(
      id => !assignedCategoryIds.includes(id)
    );

    if (unauthorizedCategories.length > 0) {
      return NextResponse.json(
        { error: 'You can only add data sources to your assigned categories' },
        { status: 403 }
      );
    }

    // Ensure at least one assigned category
    if (categoryIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one category is required' },
        { status: 400 }
      );
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse the CSV to validate and infer schema
    let parseResult;
    try {
      parseResult = parseCSVBuffer(buffer);
    } catch (parseError) {
      return NextResponse.json(
        {
          error: 'Failed to parse CSV file',
          details: parseError instanceof Error ? parseError.message : 'Parse error',
        },
        { status: 400 }
      );
    }

    // Check if CSV has data
    if (parseResult.rowCount === 0) {
      return NextResponse.json(
        { error: 'CSV file is empty or contains no valid data rows' },
        { status: 400 }
      );
    }

    // Store the file
    const { filePath, fileSize } = storeCSVFile(buffer, file.name);

    // Create the data source
    const csvConfig = {
      name,
      description,
      filePath,
      originalFilename: file.name,
      columns: parseResult.columns,
      sampleData: parseResult.sampleData,
      rowCount: parseResult.rowCount,
      fileSize,
      categoryIds,
    };

    const created = await createDataCSV(csvConfig, user.email);

    return NextResponse.json({
      success: true,
      dataSource: created,
      parseResult: {
        columns: parseResult.columns,
        sampleData: parseResult.sampleData,
        rowCount: parseResult.rowCount,
      },
    });
  } catch (error) {
    console.error('Failed to upload CSV:', error);

    // Handle duplicate name error
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      return NextResponse.json(
        { error: 'A data source with this name already exists' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to upload CSV file' },
      { status: 500 }
    );
  }
}

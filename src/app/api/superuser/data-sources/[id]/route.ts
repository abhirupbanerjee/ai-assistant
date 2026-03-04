/**
 * Superuser Individual Data Source API
 *
 * GET /api/superuser/data-sources/[id]
 * PUT /api/superuser/data-sources/[id]
 * DELETE /api/superuser/data-sources/[id]
 *
 * Manages individual data sources for superuser's assigned categories.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments } from '@/lib/db/compat';
import {
  getDataAPI,
  getDataCSV,
  updateDataAPI,
  updateDataCSV,
  deleteDataAPI,
  deleteDataCSV,
} from '@/lib/db/compat/data-sources';
import { maskSensitiveValue } from '@/lib/encryption';
import type { DataAPIConfig } from '@/types/data-sources';

/**
 * Mask sensitive fields in API config
 */
function maskAPIConfig(config: DataAPIConfig): DataAPIConfig {
  const masked = { ...config };

  if (masked.authentication.credentials) {
    const creds = { ...masked.authentication.credentials };
    if (creds.apiKey) {
      creds.apiKey = maskSensitiveValue(creds.apiKey);
    }
    if (creds.password) {
      creds.password = maskSensitiveValue(creds.password);
    }
    if (creds.token) {
      creds.token = maskSensitiveValue(creds.token);
    }
    masked.authentication = { ...masked.authentication, credentials: creds };
  }

  return masked;
}

/**
 * Check if superuser has access to a data source
 */
function hasAccessToDataSource(
  dataSourceCategoryIds: number[],
  assignedCategoryIds: number[]
): boolean {
  return dataSourceCategoryIds.some(id => assignedCategoryIds.includes(id));
}

/**
 * GET /api/superuser/data-sources/[id]
 * Get a specific data source
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;

    // Try to find as API first, then CSV
    const api = await getDataAPI(id);
    if (api) {
      if (!hasAccessToDataSource(api.categoryIds, assignedCategoryIds)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      return NextResponse.json({
        type: 'api',
        dataSource: maskAPIConfig(api),
      });
    }

    const csv = await getDataCSV(id);
    if (csv) {
      if (!hasAccessToDataSource(csv.categoryIds, assignedCategoryIds)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      return NextResponse.json({
        type: 'csv',
        dataSource: csv,
      });
    }

    return NextResponse.json({ error: 'Data source not found' }, { status: 404 });
  } catch (error) {
    console.error('Failed to fetch data source:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data source' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/superuser/data-sources/[id]
 * Update a data source
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;
    const body = await request.json();

    // Check if updating categories - ensure all are assigned
    if (body.categoryIds) {
      const unauthorizedCategories = body.categoryIds.filter(
        (catId: number) => !assignedCategoryIds.includes(catId)
      );

      if (unauthorizedCategories.length > 0) {
        return NextResponse.json(
          { error: 'You can only assign data sources to your categories' },
          { status: 403 }
        );
      }
    }

    // Try to find and update as API first
    const api = await getDataAPI(id);
    if (api) {
      if (!hasAccessToDataSource(api.categoryIds, assignedCategoryIds)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }

      const updated = await updateDataAPI(id, body, user.email);
      if (updated) {
        return NextResponse.json({
          success: true,
          dataSource: maskAPIConfig(updated),
        });
      }
    }

    // Try CSV
    const csv = await getDataCSV(id);
    if (csv) {
      if (!hasAccessToDataSource(csv.categoryIds, assignedCategoryIds)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }

      const updated = await updateDataCSV(id, body, user.email);
      if (updated) {
        return NextResponse.json({
          success: true,
          dataSource: updated,
        });
      }
    }

    return NextResponse.json({ error: 'Data source not found' }, { status: 404 });
  } catch (error) {
    console.error('Failed to update data source:', error);
    return NextResponse.json(
      { error: 'Failed to update data source' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/superuser/data-sources/[id]
 * Delete a data source
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;

    // Try to find and delete as API first
    const api = await getDataAPI(id);
    if (api) {
      if (!hasAccessToDataSource(api.categoryIds, assignedCategoryIds)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }

      await deleteDataAPI(id, user.email);
      return NextResponse.json({ success: true });
    }

    // Try CSV
    const csv = await getDataCSV(id);
    if (csv) {
      if (!hasAccessToDataSource(csv.categoryIds, assignedCategoryIds)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }

      await deleteDataCSV(id, user.email);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Data source not found' }, { status: 404 });
  } catch (error) {
    console.error('Failed to delete data source:', error);
    return NextResponse.json(
      { error: 'Failed to delete data source' },
      { status: 500 }
    );
  }
}

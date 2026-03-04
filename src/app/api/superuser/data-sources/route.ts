/**
 * Superuser Data Sources API
 *
 * GET /api/superuser/data-sources
 * Returns data sources for the superuser's assigned categories only.
 *
 * POST /api/superuser/data-sources
 * Create a new API data source for assigned categories.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments } from '@/lib/db/compat';
import {
  getAllDataAPIs,
  getAllDataCSVs,
  createDataAPI,
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
 * GET /api/superuser/data-sources
 * List data sources for superuser's assigned categories
 */
export async function GET() {
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

    // Get all data sources
    const allApis = await getAllDataAPIs();
    const allCsvs = await getAllDataCSVs();

    // Filter to only show data sources that have at least one assigned category
    const apis = allApis
      .filter(api => api.categoryIds.some(id => assignedCategoryIds.includes(id)))
      .map(maskAPIConfig);

    const csvs = allCsvs
      .filter(csv => csv.categoryIds.some(id => assignedCategoryIds.includes(id)));

    return NextResponse.json({
      apis,
      csvs,
      assignedCategories: superUserData.assignedCategories.map(c => ({
        id: c.categoryId,
        name: c.categoryName,
        slug: c.categorySlug,
      })),
    });
  } catch (error) {
    console.error('Failed to fetch superuser data sources:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data sources' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/superuser/data-sources
 * Create a new API data source (only for assigned categories)
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

    const body = await request.json();

    // Validate required fields
    if (!body.name) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }
    if (!body.endpoint) {
      return NextResponse.json(
        { error: 'Endpoint URL is required' },
        { status: 400 }
      );
    }

    // Validate category access - ensure all requested categories are assigned
    const requestedCategoryIds = body.categoryIds || [];
    const unauthorizedCategories = requestedCategoryIds.filter(
      (id: number) => !assignedCategoryIds.includes(id)
    );

    if (unauthorizedCategories.length > 0) {
      return NextResponse.json(
        { error: 'You can only add data sources to your assigned categories' },
        { status: 403 }
      );
    }

    // Ensure at least one assigned category
    if (requestedCategoryIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one category is required' },
        { status: 400 }
      );
    }

    // Build the API config
    const apiConfig: Omit<DataAPIConfig, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'status' | 'lastTested' | 'lastError'> = {
      name: body.name,
      description: body.description || '',
      endpoint: body.endpoint,
      method: body.method || 'GET',
      responseFormat: body.responseFormat || 'json',
      authentication: body.authentication || { type: 'none' },
      headers: body.headers,
      parameters: body.parameters || [],
      responseStructure: body.responseStructure || {
        jsonPath: '$',
        dataIsArray: false,
        fields: [],
      },
      sampleResponse: body.sampleResponse,
      openApiSpec: body.openApiSpec,
      configMethod: body.configMethod || 'manual',
      categoryIds: requestedCategoryIds,
    };

    // Create the data source
    const created = await createDataAPI(apiConfig, user.email);

    // Return masked config
    return NextResponse.json({
      success: true,
      dataSource: maskAPIConfig(created),
    });
  } catch (error) {
    console.error('Failed to create data source:', error);
    return NextResponse.json(
      { error: 'Failed to create data source' },
      { status: 500 }
    );
  }
}

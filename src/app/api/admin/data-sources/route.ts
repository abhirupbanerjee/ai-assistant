/**
 * Admin Data Sources API - List and create data sources
 *
 * GET  /api/admin/data-sources - Get all data sources (APIs and CSVs)
 * POST /api/admin/data-sources - Create a new API data source
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
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

    if (creds.token) {
      creds.token = maskSensitiveValue(creds.token);
    }
    if (creds.apiKey) {
      creds.apiKey = maskSensitiveValue(creds.apiKey);
    }
    if (creds.password) {
      creds.password = maskSensitiveValue(creds.password);
    }

    masked.authentication = {
      ...masked.authentication,
      credentials: creds,
    };
  }

  return masked;
}

/**
 * GET /api/admin/data-sources
 * Returns all data sources (APIs and CSVs)
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get query params for filtering
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type'); // 'api' | 'csv' | null (all)
    const categoryId = searchParams.get('categoryId');

    // Get data sources
    const apis = type === 'csv' ? [] : await getAllDataAPIs();
    const csvs = type === 'api' ? [] : await getAllDataCSVs();

    // Filter by category if specified
    let filteredAPIs = apis;
    let filteredCSVs = csvs;

    if (categoryId) {
      const catId = parseInt(categoryId, 10);
      filteredAPIs = apis.filter(api => api.categoryIds.includes(catId));
      filteredCSVs = csvs.filter(csv => csv.categoryIds.includes(catId));
    }

    // Mask sensitive data in API configs
    const maskedAPIs = filteredAPIs.map(maskAPIConfig);

    return NextResponse.json({
      apis: maskedAPIs,
      csvs: filteredCSVs,
      counts: {
        apis: maskedAPIs.length,
        csvs: filteredCSVs.length,
        total: maskedAPIs.length + filteredCSVs.length,
      },
    });
  } catch (error) {
    console.error('Failed to fetch data sources:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data sources' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/data-sources
 * Create a new API data source
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

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

    // Build the API config (createDataAPI will set id, createdAt, updatedAt, createdBy, status, lastTested, lastError)
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
      categoryIds: body.categoryIds || [],
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

    // Handle duplicate name error
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      return NextResponse.json(
        { error: 'A data source with this name already exists' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create data source' },
      { status: 500 }
    );
  }
}

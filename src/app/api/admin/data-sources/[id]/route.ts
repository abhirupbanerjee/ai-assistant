/**
 * Admin Data Source API - Individual data source operations
 *
 * GET    /api/admin/data-sources/[id] - Get a specific data source
 * PUT    /api/admin/data-sources/[id] - Update a data source
 * DELETE /api/admin/data-sources/[id] - Delete a data source
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
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

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/data-sources/[id]
 * Get a specific data source by ID
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await context.params;

    // Try to find as API first
    const api = await getDataAPI(id);
    if (api) {
      return NextResponse.json({
        type: 'api',
        dataSource: maskAPIConfig(api),
      });
    }

    // Try as CSV
    const csv = await getDataCSV(id);
    if (csv) {
      return NextResponse.json({
        type: 'csv',
        dataSource: csv,
      });
    }

    return NextResponse.json(
      { error: 'Data source not found' },
      { status: 404 }
    );
  } catch (error) {
    console.error('Failed to fetch data source:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data source' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/data-sources/[id]
 * Update a data source
 */
export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const sourceType = body.type || 'api';

    if (sourceType === 'api') {
      // Check if exists
      const existing = await getDataAPI(id);
      if (!existing) {
        return NextResponse.json(
          { error: 'API data source not found' },
          { status: 404 }
        );
      }

      // Handle credential updates - only update if not masked
      let authentication = body.authentication;
      if (authentication?.credentials) {
        const creds = authentication.credentials;

        // If credential looks masked (starts with visible chars then dots), keep existing
        if (creds.token && creds.token.includes('••')) {
          creds.token = existing.authentication.credentials?.token;
        }
        if (creds.apiKey && creds.apiKey.includes('••')) {
          creds.apiKey = existing.authentication.credentials?.apiKey;
        }
        if (creds.password && creds.password.includes('••')) {
          creds.password = existing.authentication.credentials?.password;
        }

        authentication = { ...authentication, credentials: creds };
      }

      // Build updates
      const updates: Partial<DataAPIConfig> = {
        ...(body.name && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.endpoint && { endpoint: body.endpoint }),
        ...(body.method && { method: body.method }),
        ...(body.responseFormat && { responseFormat: body.responseFormat }),
        ...(authentication && { authentication }),
        ...(body.headers !== undefined && { headers: body.headers }),
        ...(body.parameters && { parameters: body.parameters }),
        ...(body.responseStructure && { responseStructure: body.responseStructure }),
        ...(body.sampleResponse !== undefined && { sampleResponse: body.sampleResponse }),
        ...(body.categoryIds && { categoryIds: body.categoryIds }),
        ...(body.status && { status: body.status }),
      };

      const updated = await updateDataAPI(id, updates, user.email);
      if (!updated) {
        return NextResponse.json(
          { error: 'Failed to update data source' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        dataSource: maskAPIConfig(updated),
      });
    } else {
      // CSV update
      const existing = await getDataCSV(id);
      if (!existing) {
        return NextResponse.json(
          { error: 'CSV data source not found' },
          { status: 404 }
        );
      }

      const updates = {
        ...(body.name && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.columns && { columns: body.columns }),
        ...(body.categoryIds && { categoryIds: body.categoryIds }),
      };

      const updated = await updateDataCSV(id, updates, user.email);
      if (!updated) {
        return NextResponse.json(
          { error: 'Failed to update data source' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        dataSource: updated,
      });
    }
  } catch (error) {
    console.error('Failed to update data source:', error);

    // Handle duplicate name error
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      return NextResponse.json(
        { error: 'A data source with this name already exists' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update data source' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/data-sources/[id]
 * Delete a data source
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id } = await context.params;
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || 'api';

    let deleted = false;

    if (type === 'api') {
      deleted = await deleteDataAPI(id, user.email);
    } else {
      deleted = await deleteDataCSV(id, user.email);
    }

    if (!deleted) {
      return NextResponse.json(
        { error: 'Data source not found or could not be deleted' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Data source deleted successfully',
    });
  } catch (error) {
    console.error('Failed to delete data source:', error);
    return NextResponse.json(
      { error: 'Failed to delete data source' },
      { status: 500 }
    );
  }
}

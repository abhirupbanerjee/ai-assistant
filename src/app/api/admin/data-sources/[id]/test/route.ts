/**
 * Admin Data Source Test API
 *
 * POST /api/admin/data-sources/[id]/test - Test a data source connection
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDataAPI, updateDataAPI } from '@/lib/db/compat/data-sources';
import { testAPIConnection } from '@/lib/data-sources/api-caller';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/data-sources/[id]/test
 * Test an API data source connection
 */
export async function POST(
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

    // Get the API config
    const api = await getDataAPI(id);
    if (!api) {
      return NextResponse.json(
        { error: 'API data source not found' },
        { status: 404 }
      );
    }

    // Test the connection
    const testResult = await testAPIConnection(api);

    // Update the API status based on test result
    const updateData = testResult.success
      ? {
          status: 'active' as const,
          lastTested: new Date().toISOString(),
          lastError: undefined,
        }
      : {
          status: 'error' as const,
          lastTested: new Date().toISOString(),
          lastError: testResult.message,
        };

    await updateDataAPI(id, updateData, user.email);

    return NextResponse.json({
      success: testResult.success,
      message: testResult.message,
      sampleData: testResult.sampleData,
      status: updateData.status,
    });
  } catch (error) {
    console.error('Failed to test data source:', error);
    return NextResponse.json(
      { error: 'Failed to test data source' },
      { status: 500 }
    );
  }
}

/**
 * Superuser Data Source Test API
 *
 * POST /api/superuser/data-sources/[id]/test
 * Test connection to an API data source.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments } from '@/lib/db/compat';
import { getDataAPI, updateDataAPI } from '@/lib/db/compat/data-sources';
import { testAPIConnection } from '@/lib/data-sources/api-caller';

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
 * POST /api/superuser/data-sources/[id]/test
 * Test API data source connection
 */
export async function POST(
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

    const api = await getDataAPI(id);
    if (!api) {
      return NextResponse.json({ error: 'API data source not found' }, { status: 404 });
    }

    // Check access
    if (!hasAccessToDataSource(api.categoryIds, assignedCategoryIds)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const startTime = Date.now();

    // Test the API connection
    const result = await testAPIConnection(api);
    const latency = Date.now() - startTime;

    // Update status based on result
    await updateDataAPI(id, {
      status: result.success ? 'active' : 'error',
      lastTested: new Date().toISOString(),
      lastError: result.success ? undefined : result.message,
    }, user.email);

    return NextResponse.json({
      success: result.success,
      message: result.success ? `${result.message} (${latency}ms)` : result.message,
      latency,
      testedAt: new Date().toISOString(),
      testedBy: user.email,
    });
  } catch (error) {
    console.error('Failed to test data source:', error);
    return NextResponse.json(
      { error: 'Failed to test data source' },
      { status: 500 }
    );
  }
}

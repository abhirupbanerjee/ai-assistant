/**
 * Admin Tool Routing Test API
 *
 * POST /api/admin/tool-routing/test - Test routing with a message
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { testToolRouting } from '@/lib/tool-routing';

/**
 * POST /api/admin/tool-routing/test
 * Test routing rules against a message
 *
 * Request body:
 * {
 *   message: string,
 *   categoryIds?: number[]
 * }
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
    const { message, categoryIds = [] } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'message is required and must be a string' },
        { status: 400 }
      );
    }

    if (!Array.isArray(categoryIds)) {
      return NextResponse.json(
        { error: 'categoryIds must be an array' },
        { status: 400 }
      );
    }

    const result = await testToolRouting(message, categoryIds);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to test routing:', error);
    return NextResponse.json(
      { error: 'Failed to test routing' },
      { status: 500 }
    );
  }
}

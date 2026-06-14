import { NextResponse } from 'next/server';
import { getCurrentUser, isAdminRole } from '@/lib/auth';
import { getAllToolDependencyStatuses, getToolDependencySummary } from '@/lib/tools/dependencies';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdminRole(user.role)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const [tools, summary] = await Promise.all([
      getAllToolDependencyStatuses(),
      getToolDependencySummary()
    ]);

    return NextResponse.json({ tools, summary });
  } catch (error) {
    console.error('[API] Tool dependencies error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tool dependencies' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole } from '@/lib/users';
import { getRecentResults, getTestStats, cleanupOldResults } from '@/lib/db/compat';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');

    const [results, stats] = await Promise.all([
      getRecentResults(limit),
      getTestStats(),
    ]);

    return NextResponse.json({
      results,
      stats,
    });
  } catch (error) {
    console.error('[API] RAG results error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch RAG test results' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const keepRecent = parseInt(searchParams.get('keepRecent') || '50');

    const deleted = await cleanupOldResults(keepRecent);

    return NextResponse.json({
      success: true,
      deletedCount: deleted,
    });
  } catch (error) {
    console.error('[API] RAG cleanup error:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup RAG test results' },
      { status: 500 }
    );
  }
}

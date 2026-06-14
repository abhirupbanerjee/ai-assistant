import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdminRole } from '@/lib/auth';
import {
  getTrendData,
  getKpiSummary,
  getHourlyDistribution,
  getSettingsImpactAnalysis,
} from '@/lib/db/rag-profiling';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdminRole(user.role)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30');
    const includeHourly = searchParams.get('hourly') === 'true';
    const includeSettings = searchParams.get('settings') === 'true';

    const [dailyTrends, kpiSummary] = await Promise.all([
      getTrendData(days),
      getKpiSummary(),
    ]);

    const result: Record<string, unknown> = {
      dailyTrends,
      kpiSummary,
    };

    if (includeHourly) {
      result.hourlyDistribution = getHourlyDistribution(Math.min(days, 7));
    }

    if (includeSettings) {
      result.settingsImpact = getSettingsImpactAnalysis();
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] RAG trends error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch RAG trends', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

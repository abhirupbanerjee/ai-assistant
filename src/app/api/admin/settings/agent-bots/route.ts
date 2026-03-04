/**
 * Admin Agent Bots Settings API
 *
 * GET /api/admin/settings/agent-bots - Get agent bots settings
 * POST /api/admin/settings/agent-bots - Update agent bots settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentBotsSettings, updateAgentBotsSettings } from '@/lib/db/compat';
import { requireElevated } from '@/lib/auth';

// ============================================================================
// GET - Get Settings
// ============================================================================

export async function GET(): Promise<NextResponse> {
  try {
    await requireElevated();
    const settings = await getAgentBotsSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error getting agent bots settings:', error);
    return NextResponse.json(
      { error: 'Failed to get settings' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Update Settings
// ============================================================================

interface UpdateSettingsRequest {
  enabled?: boolean;
  maxJobsPerMinute?: number;
  maxJobsPerDay?: number;
  defaultRateLimitRpm?: number;
  defaultRateLimitRpd?: number;
  maxOutputSizeMB?: number;
  jobRetentionDays?: number;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireElevated();
    const body: UpdateSettingsRequest = await request.json();

    // Validate settings
    if (body.maxJobsPerMinute !== undefined && (body.maxJobsPerMinute < 1 || body.maxJobsPerMinute > 1000)) {
      return NextResponse.json(
        { error: 'Max jobs per minute must be between 1 and 1000' },
        { status: 400 }
      );
    }

    if (body.maxJobsPerDay !== undefined && (body.maxJobsPerDay < 1 || body.maxJobsPerDay > 100000)) {
      return NextResponse.json(
        { error: 'Max jobs per day must be between 1 and 100000' },
        { status: 400 }
      );
    }

    if (body.maxOutputSizeMB !== undefined && (body.maxOutputSizeMB < 1 || body.maxOutputSizeMB > 100)) {
      return NextResponse.json(
        { error: 'Max output size must be between 1 and 100 MB' },
        { status: 400 }
      );
    }

    if (body.jobRetentionDays !== undefined && (body.jobRetentionDays < 1 || body.jobRetentionDays > 365)) {
      return NextResponse.json(
        { error: 'Job retention must be between 1 and 365 days' },
        { status: 400 }
      );
    }

    const settings = await updateAgentBotsSettings(body);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof Error && error.message.includes('access required')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('[Admin] Error updating agent bots settings:', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}

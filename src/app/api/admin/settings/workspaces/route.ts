/**
 * Admin Workspaces Settings API
 *
 * GET  /api/admin/settings/workspaces - Get workspaces feature settings
 * POST /api/admin/settings/workspaces - Update workspaces feature settings
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSetting, setSetting } from '@/lib/db/compat';

interface WorkspacesSettings {
  enabled: boolean;
}

export async function GET() {
  try {
    await requireAdmin();

    const settings = await getSetting<WorkspacesSettings>('workspaces-settings');

    return NextResponse.json({
      enabled: settings?.enabled ?? false,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error fetching workspaces settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();

    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 }
      );
    }

    await setSetting<WorkspacesSettings>('workspaces-settings', { enabled }, admin.email);

    return NextResponse.json({ enabled });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error updating workspaces settings:', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}

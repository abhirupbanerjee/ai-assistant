/**
 * Admin - Superuser Settings API
 *
 * GET  /api/admin/settings/superuser - Get superuser settings
 * PUT  /api/admin/settings/superuser - Update superuser settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSuperuserSettings, setSuperuserSettings, type SuperuserSettings } from '@/lib/db/compat';

// GET - Get superuser settings
export async function GET() {
  try {
    await requireAdmin();
    const settings = await getSuperuserSettings();
    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error fetching superuser settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// PUT - Update superuser settings
export async function PUT(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();

    const updates: Partial<SuperuserSettings> = {};

    // Validate maxCategoriesPerSuperuser
    if (body.maxCategoriesPerSuperuser !== undefined) {
      const limit = parseInt(body.maxCategoriesPerSuperuser, 10);
      if (isNaN(limit) || limit < 1 || limit > 100) {
        return NextResponse.json(
          { error: 'maxCategoriesPerSuperuser must be between 1 and 100' },
          { status: 400 }
        );
      }
      updates.maxCategoriesPerSuperuser = limit;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No valid settings to update' },
        { status: 400 }
      );
    }

    const updatedSettings = await setSuperuserSettings(updates, admin.email);

    return NextResponse.json({
      success: true,
      settings: updatedSettings,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error updating superuser settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}

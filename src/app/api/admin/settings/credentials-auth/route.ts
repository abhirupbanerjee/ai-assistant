/**
 * Admin - Credentials Authentication Settings API
 *
 * GET  /api/admin/settings/credentials-auth - Get credentials auth settings
 * PUT  /api/admin/settings/credentials-auth - Update credentials auth settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  getCredentialsAuthSettings,
  setCredentialsAuthSettings,
  type CredentialsAuthSettings,
} from '@/lib/db/compat';

// GET - Get credentials auth settings
export async function GET() {
  try {
    await requireAdmin();
    const settings = await getCredentialsAuthSettings();
    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error fetching credentials auth settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// PUT - Update credentials auth settings
export async function PUT(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();

    const updates: Partial<CredentialsAuthSettings> = {};

    // Validate enabled
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
      }
      updates.enabled = body.enabled;
    }

    // Validate minPasswordLength
    if (body.minPasswordLength !== undefined) {
      const length = parseInt(body.minPasswordLength, 10);
      if (isNaN(length) || length < 4 || length > 128) {
        return NextResponse.json(
          { error: 'minPasswordLength must be between 4 and 128' },
          { status: 400 }
        );
      }
      updates.minPasswordLength = length;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid settings to update' }, { status: 400 });
    }

    const updatedSettings = await setCredentialsAuthSettings(updates, admin.email);

    return NextResponse.json({
      success: true,
      settings: updatedSettings,
      message: updates.enabled === false
        ? 'Credentials authentication disabled. Changes take effect after server restart.'
        : 'Settings updated successfully. Changes take effect after server restart.',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error updating credentials auth settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}

/**
 * Admin - User Credentials Management API
 *
 * PUT    /api/admin/users/[userId]/credentials - Set/update password for user
 * PATCH  /api/admin/users/[userId]/credentials - Enable/disable credentials for user
 * DELETE /api/admin/users/[userId]/credentials - Remove credentials from user
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  getUserById,
  setUserPassword,
  setCredentialsEnabled,
  clearUserPassword,
} from '@/lib/db/compat';
import { hashPassword, validatePassword } from '@/lib/password';
import { getCredentialsAuthSettings } from '@/lib/db/compat';

interface RouteParams {
  params: Promise<{ userId: string }>;
}

// PUT - Set/update password for user
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();
    const { userId } = await params;
    const body = await request.json();

    const userIdNum = parseInt(userId, 10);
    if (isNaN(userIdNum)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const user = await getUserById(userIdNum);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { password } = body;
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }

    // Validate password
    const settings = await getCredentialsAuthSettings();
    const validation = validatePassword(password, settings.minPasswordLength);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Hash and store password
    const passwordHash = await hashPassword(password);
    const success = await setUserPassword(userIdNum, passwordHash);

    if (!success) {
      return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
    }

    // Enable credentials for this user
    await setCredentialsEnabled(userIdNum, true);

    return NextResponse.json({
      success: true,
      message: `Password set for ${user.email}`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error setting user password:', error);
    return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
  }
}

// PATCH - Enable/disable credentials for user
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();
    const { userId } = await params;
    const body = await request.json();

    const userIdNum = parseInt(userId, 10);
    if (isNaN(userIdNum)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const user = await getUserById(userIdNum);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { enabled } = body;
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }

    // Can only enable if user has a password
    if (enabled && !user.password_hash) {
      return NextResponse.json(
        { error: 'Cannot enable credentials login: user has no password set' },
        { status: 400 }
      );
    }

    const success = await setCredentialsEnabled(userIdNum, enabled);

    if (!success) {
      return NextResponse.json({ error: 'Failed to update credentials status' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: enabled
        ? `Credentials login enabled for ${user.email}`
        : `Credentials login disabled for ${user.email}`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error updating user credentials status:', error);
    return NextResponse.json({ error: 'Failed to update credentials status' }, { status: 500 });
  }
}

// DELETE - Remove credentials from user
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();
    const { userId } = await params;

    const userIdNum = parseInt(userId, 10);
    if (isNaN(userIdNum)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const user = await getUserById(userIdNum);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Clear password and disable credentials
    await clearUserPassword(userIdNum);
    await setCredentialsEnabled(userIdNum, false);

    return NextResponse.json({
      success: true,
      message: `Credentials removed for ${user.email}`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('Error removing user credentials:', error);
    return NextResponse.json({ error: 'Failed to remove credentials' }, { status: 500 });
  }
}

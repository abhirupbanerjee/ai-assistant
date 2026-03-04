/**
 * Tool Routing to Skills Migration API
 *
 * POST: Run migration to convert tool routing rules to skills
 * GET: Check migration status
 */

import { NextResponse } from 'next/server';
import { requireAdmin, getCurrentUser } from '@/lib/auth';
import {
  migrateToolRoutingToSkills,
  isToolRoutingMigrated,
} from '@/lib/db/compat/skills';

/**
 * GET: Check if migration has been completed
 */
export async function GET() {
  try {
    await requireAdmin();

    const isMigrated = await isToolRoutingMigrated();

    return NextResponse.json({
      success: true,
      isMigrated,
      message: isMigrated
        ? 'Tool routing rules have been migrated to skills'
        : 'Migration has not been run yet',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      );
    }
    throw error;
  }
}

/**
 * POST: Run the migration
 */
export async function POST() {
  try {
    await requireAdmin();
    const user = await getCurrentUser();

    const userEmail = user?.email || 'admin';
    const results = await migrateToolRoutingToSkills(userEmail);

    return NextResponse.json({
      success: true,
      results,
      message: `Migration complete: ${results.migrated} rules migrated, ${results.skipped} skipped`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      );
    }
    console.error('Migration failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Migration failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

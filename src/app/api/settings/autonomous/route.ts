/**
 * Public API: Autonomous Mode Availability
 *
 * Non-admin endpoint that returns whether autonomous mode is enabled.
 * Called by chat UI on mount to gate the ModeToggle component.
 */

import { NextResponse } from 'next/server';
import { getAutonomousModeEnabled } from '@/lib/db/compat';

export async function GET() {
  try {
    const enabled = await getAutonomousModeEnabled();
    return NextResponse.json({ enabled });
  } catch (error) {
    console.error('[Autonomous Settings] Error:', error);
    // Default to enabled on error to avoid blocking users
    return NextResponse.json({ enabled: true });
  }
}

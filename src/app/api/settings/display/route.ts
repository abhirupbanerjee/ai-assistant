/**
 * Public API: Display Settings
 *
 * Non-admin endpoint that returns whether sources and citation trajectory
 * are enabled globally. Called by chat and workspace UIs on mount.
 */

import { NextResponse } from 'next/server';
import { getDisplaySettings } from '@/lib/db/compat';

export async function GET() {
  try {
    const settings = await getDisplaySettings();
    return NextResponse.json(settings);
  } catch (error) {
    console.error('[Display Settings] Error:', error);
    // Default to enabled on error to avoid blocking users
    return NextResponse.json({
      sourcesEnabled: true,
      citationTrajectoryEnabled: true,
    });
  }
}

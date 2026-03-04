/**
 * API Route: Refresh Model Capabilities
 *
 * POST /api/admin/llm/models/refresh
 *
 * Refreshes capabilities (toolCapable, visionCapable, maxInputTokens)
 * for all enabled models using current detection patterns.
 */

import { NextResponse } from 'next/server';
import { refreshAllModelCapabilities } from '@/lib/db/compat/enabled-models';

export async function POST() {
  try {
    const result = await refreshAllModelCapabilities();

    return NextResponse.json({
      success: true,
      updated: result.updated,
      models: result.models,
    });
  } catch (error) {
    console.error('[API] Failed to refresh model capabilities:', error);
    return NextResponse.json(
      { error: 'Failed to refresh model capabilities' },
      { status: 500 }
    );
  }
}

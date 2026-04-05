/**
 * LLM Routes Settings API
 *
 * Manages primary/fallback routing between LiteLLM proxy and direct providers.
 * Route 1: LiteLLM proxy (OpenAI, Gemini, Mistral, DeepSeek, Ollama)
 * Route 2: Direct providers (Fireworks AI, Claude/Anthropic)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getRoutesSettings,
  setRoutesSettings,
  type RoutesSettings,
} from '@/lib/db/compat';

/**
 * GET - Retrieve current routes settings
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const settings = await getRoutesSettings();

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[Routes Settings API] Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch routes settings' },
      { status: 500 }
    );
  }
}

/**
 * PUT - Update routes settings
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { route1Enabled, route2Enabled, primaryRoute } = body;

    // Validate types
    if (route1Enabled !== undefined && typeof route1Enabled !== 'boolean') {
      return NextResponse.json({ error: 'route1Enabled must be a boolean' }, { status: 400 });
    }
    if (route2Enabled !== undefined && typeof route2Enabled !== 'boolean') {
      return NextResponse.json({ error: 'route2Enabled must be a boolean' }, { status: 400 });
    }
    if (primaryRoute !== undefined && primaryRoute !== 'route1' && primaryRoute !== 'route2') {
      return NextResponse.json({ error: 'primaryRoute must be "route1" or "route2"' }, { status: 400 });
    }

    // Cannot disable both
    const current = await getRoutesSettings();
    const newR1 = route1Enabled ?? current.route1Enabled;
    const newR2 = route2Enabled ?? current.route2Enabled;
    if (!newR1 && !newR2) {
      return NextResponse.json({ error: 'At least one route must be enabled' }, { status: 400 });
    }

    // Build update
    const updates: Partial<RoutesSettings> = {};
    if (route1Enabled !== undefined) updates.route1Enabled = route1Enabled;
    if (route2Enabled !== undefined) updates.route2Enabled = route2Enabled;
    if (primaryRoute !== undefined) updates.primaryRoute = primaryRoute;

    const updatedSettings = await setRoutesSettings(updates, user.email);

    return NextResponse.json({
      success: true,
      settings: updatedSettings,
    });
  } catch (error) {
    console.error('[Routes Settings API] Error saving settings:', error);
    return NextResponse.json(
      { error: 'Failed to save routes settings' },
      { status: 500 }
    );
  }
}

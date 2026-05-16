/**
 * LLM Routes Settings API
 *
 * Manages primary/fallback routing between LLM infrastructure paths.
 * Route 1: LiteLLM proxy (OpenAI, Gemini, Mistral, DeepSeek)
 * Route 2: Direct providers (Fireworks AI, Claude/Anthropic, Moonshot AI)
 * Route 3: Local / Ollama direct (air-gapped capable)
 * Route 4: Ollama Cloud direct (hosted models)
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

    // Check if user has admin or superuser role
    if (user.role !== 'admin' && user.role !== 'superuser') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
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

    // Check if user has admin role (only admins can modify settings)
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { route1Enabled, route2Enabled, route3Enabled, route4Enabled, primaryRoute } = body;

    // Validate types
    if (route1Enabled !== undefined && typeof route1Enabled !== 'boolean') {
      return NextResponse.json({ error: 'route1Enabled must be a boolean' }, { status: 400 });
    }
    if (route2Enabled !== undefined && typeof route2Enabled !== 'boolean') {
      return NextResponse.json({ error: 'route2Enabled must be a boolean' }, { status: 400 });
    }
    if (route3Enabled !== undefined && typeof route3Enabled !== 'boolean') {
      return NextResponse.json({ error: 'route3Enabled must be a boolean' }, { status: 400 });
    }
    if (route4Enabled !== undefined && typeof route4Enabled !== 'boolean') {
      return NextResponse.json({ error: 'route4Enabled must be a boolean' }, { status: 400 });
    }
    if (primaryRoute !== undefined && !['route1', 'route2', 'route3', 'route4'].includes(primaryRoute)) {
      return NextResponse.json({ error: 'primaryRoute must be "route1", "route2", "route3", or "route4"' }, { status: 400 });
    }

    // Cannot disable all routes
    const current = await getRoutesSettings();
    const newR1 = route1Enabled ?? current.route1Enabled;
    const newR2 = route2Enabled ?? current.route2Enabled;
    const newR3 = route3Enabled ?? current.route3Enabled;
    const newR4 = route4Enabled ?? current.route4Enabled;
    if (!newR1 && !newR2 && !newR3 && !newR4) {
      return NextResponse.json({ error: 'At least one route must be enabled' }, { status: 400 });
    }

    // Primary route must be enabled
    const newPrimary = primaryRoute ?? current.primaryRoute;
    const routeEnabled: Record<string, boolean> = {
      route1: newR1, route2: newR2, route3: newR3, route4: newR4,
    };
    if (!routeEnabled[newPrimary]) {
      return NextResponse.json({ error: 'Primary route must be enabled' }, { status: 400 });
    }

    // Build update
    const updates: Partial<RoutesSettings> = {};
    if (route1Enabled !== undefined) updates.route1Enabled = route1Enabled;
    if (route2Enabled !== undefined) updates.route2Enabled = route2Enabled;
    if (route3Enabled !== undefined) updates.route3Enabled = route3Enabled;
    if (route4Enabled !== undefined) updates.route4Enabled = route4Enabled;
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

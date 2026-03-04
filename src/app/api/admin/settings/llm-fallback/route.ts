/**
 * LLM Fallback Settings API
 *
 * Manages LLM fallback configuration:
 * - Universal fallback model (must have vision + tools capability)
 * - Max retry attempts
 * - Health cache duration
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getLlmFallbackSettings,
  setLlmFallbackSettings,
  type LlmFallbackSettings,
} from '@/lib/db/compat';
import {
  getEligibleFallbackModels,
  isEligibleFallbackModel,
  getUnhealthyModels,
  clearHealthCache,
} from '@/lib/llm-fallback';

/**
 * GET - Retrieve current fallback settings and eligible models
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const settings = await getLlmFallbackSettings();
    const eligibleModels = await getEligibleFallbackModels();
    const unhealthyModels = getUnhealthyModels();

    return NextResponse.json({
      settings,
      eligibleFallbackModels: eligibleModels.map(m => ({
        id: m.id,
        displayName: m.displayName,
        providerId: m.providerId,
      })),
      healthCache: {
        unhealthyModels,
        duration: settings.healthCacheDuration,
      },
    });
  } catch (error) {
    console.error('[LLM Fallback Settings API] Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch LLM fallback settings' },
      { status: 500 }
    );
  }
}

/**
 * PUT - Update fallback settings
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { universalFallback, maxRetryAttempts, healthCacheDuration } = body;

    // Validate universalFallback (if provided)
    if (universalFallback !== undefined && universalFallback !== null) {
      if (typeof universalFallback !== 'string') {
        return NextResponse.json(
          { error: 'universalFallback must be a string or null' },
          { status: 400 }
        );
      }

      // Check if the model is eligible (has vision + tools capability)
      if (!(await isEligibleFallbackModel(universalFallback))) {
        return NextResponse.json(
          {
            error: 'Selected model must have both vision and tool capabilities',
            code: 'INELIGIBLE_MODEL',
          },
          { status: 400 }
        );
      }
    }

    // Validate maxRetryAttempts
    if (maxRetryAttempts !== undefined) {
      if (typeof maxRetryAttempts !== 'number' || maxRetryAttempts < 1 || maxRetryAttempts > 3) {
        return NextResponse.json(
          { error: 'maxRetryAttempts must be between 1 and 3' },
          { status: 400 }
        );
      }
    }

    // Validate healthCacheDuration
    if (healthCacheDuration !== undefined) {
      const validDurations = ['hourly', 'daily', 'disabled'];
      if (!validDurations.includes(healthCacheDuration)) {
        return NextResponse.json(
          { error: 'healthCacheDuration must be one of: hourly, daily, disabled' },
          { status: 400 }
        );
      }
    }

    // Build update object with only provided fields
    const updates: Partial<LlmFallbackSettings> = {};
    if (universalFallback !== undefined) updates.universalFallback = universalFallback;
    if (maxRetryAttempts !== undefined) updates.maxRetryAttempts = maxRetryAttempts;
    if (healthCacheDuration !== undefined) updates.healthCacheDuration = healthCacheDuration;

    // Save settings
    const updatedSettings = await setLlmFallbackSettings(updates, user.email);

    return NextResponse.json({
      success: true,
      settings: updatedSettings,
      updatedAt: new Date().toISOString(),
      updatedBy: user.email,
    });
  } catch (error) {
    console.error('[LLM Fallback Settings API] Error saving settings:', error);
    return NextResponse.json(
      { error: 'Failed to save LLM fallback settings' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Clear health cache (marks all models as healthy)
 */
export async function DELETE() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    clearHealthCache();

    return NextResponse.json({
      success: true,
      message: 'Health cache cleared - all models marked as healthy',
      clearedAt: new Date().toISOString(),
      clearedBy: user.email,
    });
  } catch (error) {
    console.error('[LLM Fallback Settings API] Error clearing health cache:', error);
    return NextResponse.json(
      { error: 'Failed to clear health cache' },
      { status: 500 }
    );
  }
}

/**
 * Speech Settings API (STT + TTS)
 *
 * Manages provider selection, route defaults, and recording limits
 * for Speech-to-Text and Text-to-Speech features.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getSpeechSettings,
  setSpeechSettings,
} from '@/lib/db/compat';
import { ROUTE_STT_PROVIDERS, type SttProvider, type TtsProvider } from '@/lib/db/config';

const VALID_STT_PROVIDERS: SttProvider[] = ['openai', 'fireworks', 'mistral', 'gemini'];
const VALID_TTS_PROVIDERS: TtsProvider[] = ['openai', 'gemini'];

/**
 * GET - Retrieve current speech settings
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const settings = await getSpeechSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[Speech Settings API] Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch speech settings' },
      { status: 500 }
    );
  }
}

/**
 * PUT - Update speech settings
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Validate STT fields
    if (body.stt) {
      // Validate defaultRoute
      if (body.stt.defaultRoute && !['route1', 'route2'].includes(body.stt.defaultRoute)) {
        return NextResponse.json({ error: 'defaultRoute must be "route1" or "route2"' }, { status: 400 });
      }

      // Validate route configs: providers must belong to their route
      if (body.stt.routes) {
        for (const [routeId, routeConfig] of Object.entries(body.stt.routes) as [string, { default?: string; fallback?: string }][]) {
          const allowed = ROUTE_STT_PROVIDERS[routeId];
          if (!allowed) continue;

          if (routeConfig.default && !allowed.includes(routeConfig.default as SttProvider)) {
            return NextResponse.json(
              { error: `${routeId} default must be one of: ${allowed.join(', ')}` },
              { status: 400 }
            );
          }
          if (routeConfig.fallback && routeConfig.fallback !== 'none' && !allowed.includes(routeConfig.fallback as SttProvider)) {
            return NextResponse.json(
              { error: `${routeId} fallback must be "none" or one of: ${allowed.join(', ')}` },
              { status: 400 }
            );
          }
          if (routeConfig.default && routeConfig.fallback && routeConfig.default === routeConfig.fallback) {
            return NextResponse.json(
              { error: `${routeId} default and fallback must differ` },
              { status: 400 }
            );
          }
        }
      }

      // Validate provider configs
      if (body.stt.providers) {
        for (const key of Object.keys(body.stt.providers)) {
          if (!VALID_STT_PROVIDERS.includes(key as SttProvider)) {
            return NextResponse.json({ error: `Invalid STT provider: ${key}` }, { status: 400 });
          }
        }
      }

      // Validate recording bounds
      if (body.stt.recording) {
        const { minDurationSeconds, maxDurationSeconds } = body.stt.recording;
        if (minDurationSeconds !== undefined && (typeof minDurationSeconds !== 'number' || minDurationSeconds < 1 || minDurationSeconds > 60)) {
          return NextResponse.json({ error: 'minDurationSeconds must be 1-60' }, { status: 400 });
        }
        if (maxDurationSeconds !== undefined && (typeof maxDurationSeconds !== 'number' || maxDurationSeconds < 10 || maxDurationSeconds > 600)) {
          return NextResponse.json({ error: 'maxDurationSeconds must be 10-600' }, { status: 400 });
        }
        if (minDurationSeconds !== undefined && maxDurationSeconds !== undefined && minDurationSeconds >= maxDurationSeconds) {
          return NextResponse.json({ error: 'minDurationSeconds must be less than maxDurationSeconds' }, { status: 400 });
        }
      }
    }

    // Validate TTS fields
    if (body.tts) {
      if (body.tts.primaryProvider && !VALID_TTS_PROVIDERS.includes(body.tts.primaryProvider)) {
        return NextResponse.json({ error: `Invalid TTS primary provider: ${body.tts.primaryProvider}` }, { status: 400 });
      }
      if (body.tts.fallbackProvider && body.tts.fallbackProvider !== 'none' && !VALID_TTS_PROVIDERS.includes(body.tts.fallbackProvider)) {
        return NextResponse.json({ error: `Invalid TTS fallback provider: ${body.tts.fallbackProvider}` }, { status: 400 });
      }
      if (body.tts.primaryProvider && body.tts.fallbackProvider && body.tts.primaryProvider === body.tts.fallbackProvider) {
        return NextResponse.json({ error: 'TTS primary and fallback must differ' }, { status: 400 });
      }
    }

    const updatedSettings = await setSpeechSettings(body, user.email);

    return NextResponse.json({
      success: true,
      settings: updatedSettings,
    });
  } catch (error) {
    console.error('[Speech Settings API] Error saving settings:', error);
    return NextResponse.json(
      { error: 'Failed to save speech settings' },
      { status: 500 }
    );
  }
}

/**
 * Speech Settings API (STT + TTS)
 *
 * Manages provider selection, route defaults, and recording limits
 * for Speech-to-Text and Text-to-Speech features.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isAdminRole, isElevatedRole } from '@/lib/auth';
import {
  getSpeechSettings,
  setSpeechSettings,
} from '@/lib/db/compat';
import { type SttProvider, type TtsProvider } from '@/lib/db/config';
import { blockLegacyWriteForPlatform } from '@/lib/legacy-writes';

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

    // Check if user has elevated role (admin, super_admin, or superuser)
    if (!isElevatedRole(user.role)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
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

    // Check if user has admin role (only admins/super_admins can modify settings)
    if (!isAdminRole(user.role)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Phase F: speech (STT/TTS) config is now owned by the consolidated AI & API Setup page.
    // Super admins can still write platform-level speech config via the API Keys page.
    const blocked = await blockLegacyWriteForPlatform(user);
    if (blocked) return blocked;

    const body = await request.json();

    // Validate STT fields
    if (body.stt) {
      // Validate default — accept any known STT provider
      const validSttProviders: string[] = ['openai', 'gemini', 'mistral', 'fireworks'];
      if (body.stt.default && typeof body.stt.default === 'string' && !validSttProviders.includes(body.stt.default)) {
        return NextResponse.json({ error: `default must be one of: ${validSttProviders.join(', ')}` }, { status: 400 });
      }
      if (body.stt.fallback && body.stt.fallback !== 'none' && !validSttProviders.includes(body.stt.fallback)) {
        return NextResponse.json({ error: `fallback must be one of: ${validSttProviders.join(', ')}, or "none"` }, { status: 400 });
      }

      // Validate default/fallback providers
      if (body.stt.default && body.stt.fallback && body.stt.default === body.stt.fallback) {
        return NextResponse.json(
          { error: 'STT default and fallback must differ' },
          { status: 400 }
        );
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

/**
 * Transcribe Config API
 *
 * Returns client-safe recording configuration (no API keys or provider details).
 * Used by VoiceInput component to enforce duration limits.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSpeechSettings, getRoutesSettings } from '@/lib/db/compat';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [speechSettings, routesSettings] = await Promise.all([
      getSpeechSettings(),
      getRoutesSettings(),
    ]);

    const { stt } = speechSettings;

    // Check if any STT provider is enabled and reachable
    const hasStt = Object.values(stt.providers).some(p => p.enabled);

    return NextResponse.json({
      enabled: hasStt,
      minDurationSeconds: stt.recording.minDurationSeconds,
      maxDurationSeconds: stt.recording.maxDurationSeconds,
    });
  } catch (error) {
    console.error('[Transcribe Config API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transcribe config' },
      { status: 500 }
    );
  }
}

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

    // Check if any STT provider is enabled and its route is active
    const { stt } = speechSettings;
    const hasRoute1Stt = routesSettings.route1Enabled &&
      Object.entries(stt.providers).some(([id, p]) => p.enabled && ['openai', 'gemini', 'mistral'].includes(id));
    const hasRoute2Stt = routesSettings.route2Enabled &&
      stt.providers.fireworks.enabled;

    return NextResponse.json({
      enabled: hasRoute1Stt || hasRoute2Stt,
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

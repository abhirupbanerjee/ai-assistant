/**
 * Public Branding API
 *
 * GET /api/branding - Get branding settings (no auth required)
 */

import { NextResponse } from 'next/server';
import { getBrandingSettings, BRANDING_ICONS } from '@/lib/db/compat';

export async function GET() {
  try {
    const branding = await getBrandingSettings();

    return NextResponse.json({
      botName: branding.botName,
      botIcon: branding.botIcon,
      subtitle: branding.subtitle || null,
      welcomeTitle: branding.welcomeTitle || null,
      welcomeMessage: branding.welcomeMessage || null,
      accentColor: branding.accentColor || '#2563eb',
      // Include available icons for client reference
      availableIcons: BRANDING_ICONS,
    });
  } catch (error) {
    console.error('Failed to get branding settings:', error);
    return NextResponse.json(
      { error: 'Failed to get branding settings' },
      { status: 500 }
    );
  }
}

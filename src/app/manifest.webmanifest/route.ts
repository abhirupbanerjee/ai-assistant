import { NextResponse } from 'next/server';
import { getPWASettings, getBrandingSettings } from '@/lib/db/compat';

// Force dynamic rendering - reads from database at runtime
export const dynamic = 'force-dynamic';

/**
 * Dynamic Web App Manifest
 *
 * Returns a manifest.webmanifest with dynamic values from the database:
 * - Bot name from branding settings
 * - Icon paths from PWA settings (auto-set when bot icon is selected)
 */
export async function GET() {
  const pwa = await getPWASettings();
  const branding = await getBrandingSettings();

  const manifest = {
    id: '/',
    scope: '/',
    name: branding.botName || 'Policy Bot',
    short_name: branding.botName || 'PolicyBot',
    description: 'AI-powered policy assistant',
    start_url: '/chat',
    display: 'standalone',
    background_color: pwa.backgroundColor || '#ffffff',
    theme_color: pwa.themeColor || '#2563eb',
    orientation: 'portrait-primary',
    prefer_related_applications: false,
    icons: [
      {
        src: pwa.icon192Path || '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: pwa.icon192Path || '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: pwa.icon512Path || '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: pwa.icon512Path || '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

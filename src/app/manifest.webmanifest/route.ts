import { NextResponse } from 'next/server';
import { getPWASettings, getBrandingSettings, getSettingMetadata } from '@/lib/db/compat';

// Force dynamic rendering - reads from database at runtime
export const dynamic = 'force-dynamic';

/**
 * Dynamic Web App Manifest
 *
 * Returns a manifest.webmanifest with dynamic values from the database:
 * - Bot name from branding settings
 * - Icon paths from PWA settings (auto-set when bot icon is selected)
 *
 * Phase 2 (mobile UI refresh) additions:
 * - Monochrome icons (Android 13+ Material You themed icons)
 * - Screenshots (richer install prompt)
 * - `shortcuts` (New chat long-press on Android)
 * - `share_target` (receive shared text/links from the Android share sheet)
 */
export async function GET(req: Request) {
  const pwa = await getPWASettings();
  const branding = await getBrandingSettings();
  // Cache-bust token: when the admin changes the branding icon, the
  // branding-settings row's updatedAt changes, which changes this query
  // param, which forces browsers/CDNs to re-fetch the manifest and its
  // referenced PNGs instead of serving a stale home-screen icon.
  const brandingMeta = await getSettingMetadata('branding-settings');
  const iconVersion = brandingMeta?.updatedAt
    ? encodeURIComponent(brandingMeta.updatedAt)
    : (pwa.updatedAt ? encodeURIComponent(pwa.updatedAt) : '0');
  const iconQuery = `?v=${iconVersion}`;

  // Build an absolute URL for the share_target action. Web Manifest
  // share_target.action must be an absolute URL or relative to the manifest
  // scope; using an absolute origin avoids ambiguity across deployments.
  const origin = new URL(req.url).origin;
  const shareAction = `${origin}/api/share-target`;

  const icon192 = (pwa.icon192Path || '/icons/icon-192x192.png') + iconQuery;
  const icon512 = (pwa.icon512Path || '/icons/icon-512x512.png') + iconQuery;
  // Monochrome icons are static (text silhouette), no cache-bust needed,
  // but we keep them stable so Android's themed-icon cache stays valid.
  const mono192 = '/icons/icon-monochrome-192x192.png';
  const mono512 = '/icons/icon-monochrome-512x512.png';

  const manifest = {
    id: '/',
    scope: '/',
    name: branding.botName || 'AI Assistant',
    short_name: branding.botName || 'AI Assistant',
    description: 'AI-powered policy assistant',
    start_url: '/chat',
    display: 'standalone',
    background_color: pwa.backgroundColor || '#ffffff',
    theme_color: pwa.themeColor || '#2563eb',
    orientation: 'portrait-primary',
    prefer_related_applications: false,
    icons: [
      {
        src: icon192,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: icon192,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: icon512,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: icon512,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      // Android 13+ Material You themed icons — single-color silhouette
      // that the system tints to match the user's wallpaper palette.
      {
        src: mono192,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'monochrome',
      },
      {
        src: mono512,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'monochrome',
      },
    ],
    // Android-only: long-press the app icon to surface these shortcuts.
    // iOS PWAs ignore `shortcuts`, which is fine for the Android focus.
    shortcuts: [
      {
        name: 'New chat',
        short_name: 'New',
        description: 'Start a new conversation',
        url: '/chat',
        icons: [{ src: icon192, sizes: '192x192', type: 'image/png' }],
      },
    ],
    // Chrome Android share-sheet integration. Receives shared text/links and
    // prefills the composer. See src/app/api/share-target/route.ts.
    share_target: {
      action: shareAction,
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
      },
    },
    // Richer install prompt — phone-sized screenshots in both color schemes.
    screenshots: [
      {
        src: '/icons/screenshot-phone-light-1080x1920.png',
        sizes: '1080x1920',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'AI Assistant — light mode',
      },
      {
        src: '/icons/screenshot-phone-dark-1080x1920.png',
        sizes: '1080x1920',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'AI Assistant — dark mode',
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

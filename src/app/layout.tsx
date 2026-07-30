import type { Metadata, Viewport } from 'next';
import './globals.css';
import Providers from './providers';
import { getBrandingSettings, getPWASettings, getSettingMetadata } from '@/lib/db/compat';
import { BRANDING_ICONS } from '@/lib/db/config';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // P1.1 — Treat the on-screen keyboard as a viewport resize (Chrome/Android)
  // so the layout shrinks above it. Paired with the `100dvh` shell in
  // globals.css, no visualViewport JS observer is needed.
  interactiveWidget: 'resizes-content',
  // P1.5 — Flip the browser chrome tint by color scheme.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#2563eb' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1c1c' },
  ],
};

/**
 * Resolve the favicon / apple-touch-icon PNG for the currently selected
 * branding icon. Falls back to the PWA settings path, then to the default
 * app icon. Used by `generateMetadata` so the browser-tab icon and the
 * PWA home-screen icon track the admin's Branding selection instead of a
 * build-time static path.
 *
 * @returns `{ icon, apple, version }` where `version` is a cache-bust token
 * (the branding-settings `updatedAt` timestamp) appended as `?v=` so the
 * browser re-fetches the favicon when the admin changes the icon.
 */
async function resolveBrandingIcon(): Promise<{ icon: string; apple: string; version: string }> {
  // NEXT_PHASE guard — DB is unavailable during `next build`. Fall back to
  // the static default so the build does not crash. See src/lib/auth-options.ts.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return { icon: '/icons/icon-192x192.png', apple: '/icons/icon-192x192.png', version: '0' };
  }

  try {
    const branding = await getBrandingSettings();
    const pwa = await getPWASettings();
    const meta = await getSettingMetadata('branding-settings');
    const version = meta?.updatedAt
      ? encodeURIComponent(meta.updatedAt)
      : (pwa.updatedAt ? encodeURIComponent(pwa.updatedAt) : '0');

    // Prefer the PNG mapped to the selected bot icon key; fall back to the
    // PWA settings path, then the static default.
    const selected = BRANDING_ICONS.find(i => i.key === branding.botIcon);
    const icon192 = selected?.png192 || pwa.icon192Path || '/icons/icon-192x192.png';

    return {
      icon: `${icon192}?v=${version}`,
      apple: `${icon192}?v=${version}`,
      version,
    };
  } catch {
    // DB unavailable at runtime (e.g. during migrations) — use the static
    // default so the page still renders with a favicon.
    return { icon: '/icons/icon-192x192.png', apple: '/icons/icon-192x192.png', version: '0' };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { icon, apple } = await resolveBrandingIcon();

  return {
    title: 'AI Assistant',
    description: 'Enterprise AI platform for secure, self-hosted assistants and autonomous agents',
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: 'AI Assistant',
    },
    icons: {
      icon,
      apple,
    },
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <head>
        {/* Cloudflare Web Analytics with Subresource Integrity (SRI)
            SRI hash pins the exact script version, preventing CDN compromise attacks.
            Hash is for beacon.min.js as of 2026-05-23. Update if Cloudflare releases a new version.
            Reference: https://developers.cloudflare.com/web-analytics/get-started/
        */}
        {process.env.NEXT_PUBLIC_CLOUDFLARE_BEACON_TOKEN && (
          <script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            integrity="sha384-KXjSmF7snBFRXXcoEwADd668C56vFQQOoMXjq+3me5V8q5rbsKeJK+srjmzNil7"
            crossOrigin="anonymous"
          />
        )}
      </head>
      <body className="font-sans h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

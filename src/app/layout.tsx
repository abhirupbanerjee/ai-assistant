import type { Metadata, Viewport } from 'next';
import './globals.css';
import Providers from './providers';

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

export const metadata: Metadata = {
  title: 'AI Assistant',
  description: 'AI-powered policy assistant for government staff',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'AI Assistant',
  },
  icons: {
    icon: '/icons/icon-192x192.png',
    apple: '/icons/icon-192x192.png',
  },
};

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

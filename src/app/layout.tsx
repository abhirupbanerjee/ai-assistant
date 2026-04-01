import type { Metadata, Viewport } from 'next';
import './globals.css';
import Providers from './providers';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#2563eb',
};

export const metadata: Metadata = {
  title: 'Policy Bot',
  description: 'AI-powered policy assistant for government staff',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Policy Bot',
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
      <body className="font-sans h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

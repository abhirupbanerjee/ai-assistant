'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';
import AccentColorProvider from '@/components/AccentColorProvider';
import { InstallBanner } from '@/components/pwa/InstallBanner';
import { RegisterSW } from '@/components/pwa/RegisterSW';

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <AccentColorProvider>
        {children}
        <InstallBanner />
        <RegisterSW />
      </AccentColorProvider>
    </SessionProvider>
  );
}

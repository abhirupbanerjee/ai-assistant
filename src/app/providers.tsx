'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';
import AccentColorProvider from '@/components/AccentColorProvider';
import { InstallBanner } from '@/components/pwa/InstallBanner';
import { OfflineBanner } from '@/components/pwa/OfflineBanner';
import { RegisterSW } from '@/components/pwa/RegisterSW';
import { ToastProvider } from '@/contexts/ToastContext';
import ToastContainer from '@/components/ui/ToastContainer';

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <AccentColorProvider>
        <ToastProvider>
          <OfflineBanner />
          {children}
          <InstallBanner />
          <RegisterSW />
          <ToastContainer />
        </ToastProvider>
      </AccentColorProvider>
    </SessionProvider>
  );
}

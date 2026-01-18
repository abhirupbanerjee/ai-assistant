'use client';

import { useEffect } from 'react';

export function RegisterSW() {
  useEffect(() => {
    // Guard against SSR
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // Auto-reload when new SW takes control (fixes broken old SW)
    let refreshing = false;
    const handleControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      console.log('[SW] New version activated, reloading...');
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('[SW] Registered');

        // Force update check to ensure latest SW is active
        registration.update().catch(() => {});
      } catch (e) {
        console.warn('[SW] Registration failed:', e);
      }
    };

    // Defer until page is fully loaded
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register);
      return () => {
        window.removeEventListener('load', register);
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      };
    }
  }, []);

  return null;
}

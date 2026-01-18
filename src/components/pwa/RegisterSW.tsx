'use client';

import { useEffect } from 'react';

export function RegisterSW() {
  useEffect(() => {
    // Guard against SSR
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(() => console.log('[SW] Registered'))
        .catch((e) => console.warn('[SW] Registration failed:', e));
    };

    // Defer until page is fully loaded
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register);
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}

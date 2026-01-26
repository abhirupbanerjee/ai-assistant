'use client';

import { useState, useEffect } from 'react';

/**
 * Hook to detect if screen width matches a media query.
 * Used for responsive behavior that can't be handled with CSS alone.
 *
 * @param query - CSS media query string (e.g., '(max-width: 767px)')
 * @returns boolean indicating if the query matches
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);

    // Set initial value
    setMatches(mediaQuery.matches);

    // Listen for changes
    const handler = (e: MediaQueryListEvent) => {
      setMatches(e.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/**
 * Convenience hook to check if current viewport is mobile (<768px).
 * Use this instead of useIsTouchDevice for layout decisions.
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

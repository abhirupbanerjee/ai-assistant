'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseScrollHideOptions {
  threshold?: number;      // Scroll distance before hiding (default: 20px)
  debounceMs?: number;     // Debounce for scroll end detection (default: 150ms)
}

interface UseScrollHideReturn {
  isHidden: boolean;
  onScroll: (e: React.UIEvent<HTMLElement>) => void;
  resetHidden: () => void;
}

/**
 * Hook to hide UI elements when scrolling down and show them when scrolling up.
 * Used for mobile FABs and other floating UI that should hide during scroll.
 */
export function useScrollHide(options: UseScrollHideOptions = {}): UseScrollHideReturn {
  const { threshold = 20, debounceMs = 150 } = options;

  const [isHidden, setIsHidden] = useState(false);
  const lastScrollTop = useRef(0);
  const scrollEndTimer = useRef<NodeJS.Timeout | null>(null);
  const accumulatedDelta = useRef(0);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (scrollEndTimer.current) {
        clearTimeout(scrollEndTimer.current);
      }
    };
  }, []);

  const onScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    const target = e.currentTarget;
    const currentScrollTop = target.scrollTop;
    const delta = currentScrollTop - lastScrollTop.current;

    // Accumulate delta in same direction, reset on direction change
    if ((delta > 0 && accumulatedDelta.current >= 0) || (delta < 0 && accumulatedDelta.current <= 0)) {
      accumulatedDelta.current += delta;
    } else {
      accumulatedDelta.current = delta;
    }

    // Hide when scrolling down past threshold
    if (accumulatedDelta.current > threshold) {
      setIsHidden(true);
    }
    // Show when scrolling up past threshold
    else if (accumulatedDelta.current < -threshold) {
      setIsHidden(false);
    }

    lastScrollTop.current = currentScrollTop;

    // Reset accumulated delta and show UI when scroll stops
    if (scrollEndTimer.current) {
      clearTimeout(scrollEndTimer.current);
    }
    scrollEndTimer.current = setTimeout(() => {
      accumulatedDelta.current = 0;
      // Optionally show UI when scroll stops (uncomment if desired)
      // setIsHidden(false);
    }, debounceMs);
  }, [threshold, debounceMs]);

  const resetHidden = useCallback(() => {
    setIsHidden(false);
    accumulatedDelta.current = 0;
  }, []);

  return { isHidden, onScroll, resetHidden };
}

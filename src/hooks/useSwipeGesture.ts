'use client';

import { useEffect, useRef } from 'react';

interface SwipeConfig {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
  edgeWidth?: number;
  rightEdgeOnly?: boolean;
  disabled?: boolean;
}

export function useSwipeGesture(config: SwipeConfig) {
  const { onSwipeLeft, onSwipeRight, threshold = 50, edgeWidth = 30, rightEdgeOnly = false, disabled = false } = config;

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const startedFromEdge = useRef(false);

  const onSwipeLeftRef = useRef(onSwipeLeft);
  const onSwipeRightRef = useRef(onSwipeRight);

  useEffect(() => {
    onSwipeLeftRef.current = onSwipeLeft;
    onSwipeRightRef.current = onSwipeRight;
  }, [onSwipeLeft, onSwipeRight]);

  useEffect(() => {
    if (disabled) return;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      
      // Check edge detection based on rightEdgeOnly flag
      if (rightEdgeOnly) {
        const windowWidth = window.innerWidth;
        startedFromEdge.current = touchStartX.current > windowWidth - edgeWidth;
      } else {
        startedFromEdge.current = touchStartX.current < edgeWidth;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;

      const deltaX = touchEndX - touchStartX.current;
      const deltaY = touchEndY - touchStartY.current;

      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > threshold) {
        if (rightEdgeOnly) {
          // Right edge: swipe left (negative deltaX)
          if (deltaX < 0 && startedFromEdge.current && onSwipeLeftRef.current) {
            onSwipeLeftRef.current();
          }
        } else {
          // Left edge: swipe right (positive deltaX)
          if (deltaX > 0 && startedFromEdge.current && onSwipeRightRef.current) {
            onSwipeRightRef.current();
          } else if (deltaX < 0 && onSwipeLeftRef.current) {
            onSwipeLeftRef.current();
          }
        }
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [threshold, edgeWidth, rightEdgeOnly, disabled]);
}

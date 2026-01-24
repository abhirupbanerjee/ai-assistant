'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseResizableSidebarOptions {
  storageKeyPrefix: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  collapseThreshold?: number;
  side: 'left' | 'right';
}

interface UseResizableSidebarReturn {
  width: number;
  isCollapsed: boolean;
  isResizing: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  handleMouseDown: (e: React.MouseEvent) => void;
}

export function useResizableSidebar({
  storageKeyPrefix,
  defaultWidth = 288,
  minWidth = 200,
  maxWidth = 500,
  collapseThreshold = 120,
  side,
}: UseResizableSidebarOptions): UseResizableSidebarReturn {
  // Initialize width from localStorage or default
  const [width, setWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(`${storageKeyPrefix}-width`);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
          return parsed;
        }
      }
    }
    return defaultWidth;
  });

  // Initialize collapsed state from localStorage
  const [isCollapsed, setIsCollapsedState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(`${storageKeyPrefix}-collapsed`) === 'true';
    }
    return false;
  });

  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Persist width to localStorage
  useEffect(() => {
    localStorage.setItem(`${storageKeyPrefix}-width`, String(width));
  }, [width, storageKeyPrefix]);

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem(`${storageKeyPrefix}-collapsed`, String(isCollapsed));
  }, [isCollapsed, storageKeyPrefix]);

  // Handle collapse state change
  const setIsCollapsed = useCallback((collapsed: boolean) => {
    setIsCollapsedState(collapsed);
  }, []);

  // Handle mouse down on resize handle
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }, [width]);

  // Handle mouse move during resize
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = side === 'left'
        ? e.clientX - startXRef.current
        : startXRef.current - e.clientX;

      const newWidth = startWidthRef.current + delta;

      // Auto-collapse if below threshold
      if (newWidth < collapseThreshold) {
        setIsCollapsedState(true);
        setIsResizing(false);
        return;
      }

      // Clamp between min and max
      const clampedWidth = Math.min(Math.max(newWidth, minWidth), maxWidth);
      setWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    // Add global listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Prevent text selection during resize
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing, side, collapseThreshold, minWidth, maxWidth]);

  return {
    width,
    isCollapsed,
    isResizing,
    setIsCollapsed,
    handleMouseDown,
  };
}

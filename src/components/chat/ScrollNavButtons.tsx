'use client';

import { useCallback } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';

/** Scroll position thresholds (px) */
export const SCROLL_DOWN_THRESHOLD = 100; // show scroll-down when within this distance from bottom
export const SCROLL_UP_THRESHOLD = 200;   // show scroll-up when scrolled past this distance from top

interface ScrollNavButtonsProps {
  /** Ref to the scrollable container element */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Current scrollTop of the container */
  scrollTop: number;
  /** Total scrollable height */
  scrollHeight: number;
  /** Visible height of the container */
  clientHeight: number;
  /** Whether a streaming response is in progress (suppress buttons during auto-scroll) */
  isStreaming: boolean;
  /** True on touch devices — buttons are always visible when relevant (no hover) */
  isTouchDevice: boolean;
  /** Optional extra classNames appended to the wrapper */
  className?: string;
  /**
   * CSS classes for the hover-reveal behaviour on desktop (non-touch).
   * Default uses Tailwind group-hover. Override for non-Tailwind contexts (e.g. embed CSS).
   */
  hoverClassName?: string;
  /** CSS classes for individual buttons (defaults to Tailwind pill style) */
  buttonClassName?: string;
}

/**
 * Scroll navigation buttons (scroll-to-top + scroll-to-bottom).
 *
 * Desktop: hidden by default, revealed on hover of the parent scroll container
 * (parent must have `group` class). Uses `opacity-0 group-hover:opacity-100`.
 *
 * Mobile (touch): always visible when the user is far enough from the target
 * position, since hover is not available on touch devices.
 *
 * Both buttons hide during streaming auto-scroll to avoid fighting the
 * programmatic scroll controller.
 */
const DEFAULT_BUTTON_CLASS =
  'w-9 h-9 rounded-full bg-white border border-gray-200 shadow-md hover:shadow-lg hover:bg-gray-50 transition-all text-gray-600 flex items-center justify-center';

export default function ScrollNavButtons({
  containerRef,
  scrollTop,
  scrollHeight,
  clientHeight,
  isStreaming,
  isTouchDevice,
  className = '',
  hoverClassName = 'opacity-0 group-hover:opacity-100 transition-opacity duration-200',
  buttonClassName = DEFAULT_BUTTON_CLASS,
}: ScrollNavButtonsProps) {
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  const showScrollDown = distanceFromBottom > SCROLL_DOWN_THRESHOLD && !isStreaming;
  const showScrollUp = scrollTop > SCROLL_UP_THRESHOLD && !isStreaming;

  const scrollToTop = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: 0, behavior: 'smooth' });
  }, [containerRef]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [containerRef]);

  // On desktop: always render but control visibility via group-hover + opacity.
  // On mobile: only render when there's a button to show.
  const hasAnyButton = showScrollUp || showScrollDown;

  if (!hasAnyButton && isTouchDevice) return null;

  return (
    <div
      className={`absolute bottom-4 right-4 z-10 flex flex-col gap-1.5 ${className} ${
        isTouchDevice
          ? 'opacity-100'
          : hoverClassName
      }`}
      aria-label="Scroll navigation"
    >
      {showScrollUp && (
        <button
          onClick={scrollToTop}
          className={buttonClassName}
          title="Scroll to top"
          aria-label="Scroll to top"
        >
          <ArrowUp size={16} />
        </button>
      )}
      {showScrollDown && (
        <button
          onClick={scrollToBottom}
          className={buttonClassName}
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  );
}

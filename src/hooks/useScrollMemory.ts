'use client';

import { useRef, useCallback, RefObject } from 'react';

/**
 * Bump this version whenever the scroll container layout changes in a way that
 * invalidates previously saved absolute offsets (e.g. adding/removing a
 * scroll-start spacer). Old stored values will be discarded and the thread will
 * fall back to its default scroll position instead of jumping to a wrong offset.
 */
const SCROLL_MEMORY_VERSION = 2;

interface StoredScrollPosition {
  offset: number;
  version: number;
}

/**
 * Per-thread scroll position memory.
 * When switching threads, saves the scroll position of the current thread
 * and restores it when the user navigates back.
 */
const scrollPositions = new Map<string, StoredScrollPosition>();

/**
 * Hook that provides save/restore callbacks for scroll position,
 * keyed by thread ID.
 *
 * Usage:
 *   const { saveScroll, restoreScroll } = useScrollMemory(containerRef);
 *
 *   // Save when leaving a thread:
 *   saveScroll(threadId);
 *
 *   // Restore after loading a thread:
 *   restoreScroll(threadId);
 */
export function useScrollMemory(containerRef: RefObject<HTMLDivElement | null>) {
  const pendingRestore = useRef<{ threadId: string; attempts: number } | null>(null);

  const saveScroll = useCallback(
    (threadId: string) => {
      const container = containerRef.current;
      if (container && threadId) {
        scrollPositions.set(threadId, {
          offset: container.scrollTop,
          version: SCROLL_MEMORY_VERSION,
        });
      }
    },
    [containerRef],
  );

  const restoreScroll = useCallback(
    (threadId: string) => {
      if (!threadId) return;

      const saved = scrollPositions.get(threadId);
      const container = containerRef.current;

      if (container && saved && saved.version === SCROLL_MEMORY_VERSION) {
        // Apply saved scroll position
        // Defer to next frame so the DOM has painted the restored messages
        requestAnimationFrame(() => {
          container.scrollTop = saved.offset;
          // If messages loaded asynchronously, try again after a short delay
          pendingRestore.current = { threadId, attempts: 0 };
        });
      }
    },
    [containerRef],
  );

  /**
   * Call after messages finish loading (e.g. in a useEffect after messages state settles).
   * If a restore was pending and the container now has content, re-apply the saved position.
   */
  const confirmRestore = useCallback(
    (threadId: string) => {
      if (!pendingRestore.current || pendingRestore.current.threadId !== threadId) return;

      const container = containerRef.current;
      const saved = scrollPositions.get(threadId);

      if (container && saved && saved.version === SCROLL_MEMORY_VERSION) {
        const hasContent = container.scrollHeight > container.clientHeight;
        if (hasContent && Math.abs(container.scrollTop - saved.offset) > 10) {
          container.scrollTop = saved.offset;
        }
      }

      // Only retry a few times
      pendingRestore.current.attempts += 1;
      if (pendingRestore.current.attempts >= 5) {
        pendingRestore.current = null;
      }
    },
    [containerRef],
  );

  /**
   * Cancel any pending scroll restore — call when the user manually scrolls
   * so that confirmRestore doesn't fight the user's scroll position.
   */
  const cancelRestore = useCallback(() => {
    pendingRestore.current = null;
  }, []);

  /**
   * Clear saved scroll position for a thread (e.g. on new message sent).
   */
  const clearScroll = useCallback((threadId: string) => {
    scrollPositions.delete(threadId);
  }, []);

  return { saveScroll, restoreScroll, confirmRestore, cancelRestore, clearScroll };
}
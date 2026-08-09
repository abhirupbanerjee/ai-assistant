'use client';

import { useState, useCallback, useEffect } from 'react';

export interface TextSelection {
  selectedText: string;
  surroundingContext: string;
  position: { x: number; y: number };
  pageNumber?: number;
}

export function useTextSelection(containerRef: React.RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const readSelection = () => {
      const captured = captureSelection();
      if (!captured) {
        setShowButton(false);
        return;
      }
      setSelection(captured);
      setShowButton(true);
    };

    const handlePointerSelection = () => {
      // selectionchange fires reliably after native selection handles settle,
      // but debounce slightly to avoid intermediate states while dragging.
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(readSelection, 120);
    };

    // mouseup handles desktop clicks/drags.
    document.addEventListener('mouseup', readSelection);
    // selectionchange covers both mouse and touch once the selection is finalized.
    document.addEventListener('selectionchange', handlePointerSelection);

    return () => {
      document.removeEventListener('mouseup', readSelection);
      document.removeEventListener('selectionchange', handlePointerSelection);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [containerRef]);

  const clearSelection = useCallback(() => {
    setShowButton(false);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const captureSelection = useCallback((): TextSelection | null => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return null;

    const container = containerRef.current;
    if (!container) return null;

    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return null;

    let node: Node | null = range.commonAncestorContainer;
    let pageNumber: number | undefined;
    while (node) {
      if (node instanceof HTMLElement && node.dataset.pageNumber) {
        pageNumber = Number(node.dataset.pageNumber);
        break;
      }
      node = node.parentNode;
    }

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const selectedText = sel.toString();

    return {
      selectedText,
      surroundingContext: getSurroundingContext(range, container),
      position: {
        x: rect.left + rect.width / 2,
        y: rect.top - containerRect.top - 40 + container.scrollTop,
      },
      pageNumber,
    };
  }, [containerRef]);

  return { selection, showButton, clearSelection, captureSelection };
}

function getSurroundingContext(range: Range, container: HTMLElement): string {
  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(container);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const before = beforeRange.toString().slice(-200);

  const fullText = container.textContent || '';
  const afterStart = before.length + range.toString().length;
  const after = fullText.slice(afterStart, afterStart + 200);

  return `${before}[SELECTED]${after}`;
}

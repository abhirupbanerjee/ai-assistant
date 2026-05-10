'use client';

import { useState, useCallback, useMemo } from 'react';
import { useIsMobile } from './useMediaQuery';

type InputState = 'compact' | 'expanded' | 'focused-write';

interface UseInputStateOptions {
  value: string;
  isFocused: boolean;
  attachmentCount: number;
  lineCount: number;
}

interface UseInputStateResult {
  state: InputState;
  setForceExpanded: (expanded: boolean) => void;
}

/**
 * Determines the input bar state based on screen size, focus, draft content, and attachments.
 * 
 * States:
 * - COMPACT: Mobile, idle, no draft/attachments → single-row bar
 * - EXPANDED: Desktop OR (mobile with draft/attachments/focus) → two-row bar with chips
 * - FOCUSED-WRITE: Mobile only, when lineCount >= 4 → 50dvh sheet with collapsed chips
 */
export function useInputState({
  value,
  isFocused,
  attachmentCount,
  lineCount,
}: UseInputStateOptions): UseInputStateResult {
  const isMobile = useIsMobile();
  const [forceExpanded, setForceExpanded] = useState(false);

  // State computation (synchronous, no debounce)
  const state = useMemo(() => {
    // Desktop always uses EXPANDED (unless empty and not focused)
    if (!isMobile) {
      return 'expanded' as InputState;
    }

    // Mobile: check for FOCUSED-WRITE (4+ lines)
    if (lineCount >= 4) {
      return 'focused-write' as InputState;
    }

    // Mobile: check for EXPANDED (draft, attachments, focus, or forced)
    const hasContent = value.trim().length > 0;
    const hasAttachments = attachmentCount > 0;
    if (forceExpanded || isFocused || hasContent || hasAttachments) {
      return 'expanded' as InputState;
    }

    // Mobile: default COMPACT
    return 'compact' as InputState;
  }, [isMobile, value, isFocused, attachmentCount, lineCount, forceExpanded]);

  return {
    state,
    setForceExpanded,
  };
}

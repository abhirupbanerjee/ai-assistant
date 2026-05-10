'use client';

import { useEffect } from 'react';
import { useIsMobile } from './useMediaQuery';

interface UseKeyboardShortcutsOptions {
  onFocus?: () => void;
  onBlur?: () => void;
  onSend?: () => void;
  onTogglePlusMenu?: () => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
}

/**
 * Keyboard shortcuts for chat input:
 * - Cmd/Ctrl+K: Focus textarea
 * - Esc: Blur textarea (only when focused)
 * - Cmd/Ctrl+Enter: Send message
 * - Cmd/Ctrl+/: Toggle PlusMenu
 *
 * Disabled on mobile (no physical keyboard expected).
 */
export function useKeyboardShortcuts({
  onFocus,
  onBlur,
  onSend,
  onTogglePlusMenu,
  textareaRef,
  disabled = false,
}: UseKeyboardShortcutsOptions) {
  const isMobile = useIsMobile();

  useEffect(() => {
    if (disabled || isMobile) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if target is an input/textarea/contenteditable (except our textarea)
      const target = e.target as HTMLElement;
      const isOtherInput =
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') &&
        target !== textareaRef?.current;

      if (isOtherInput) return;

      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      // Cmd/Ctrl+K: Focus textarea
      if (modKey && e.key === 'k') {
        e.preventDefault();
        textareaRef?.current?.focus();
        onFocus?.();
      }

      // Esc: Blur textarea (only if focused)
      if (e.key === 'Escape' && textareaRef?.current === document.activeElement) {
        e.preventDefault();
        textareaRef?.current?.blur();
        onBlur?.();
      }

      // Cmd/Ctrl+Enter: Send message
      if (modKey && e.key === 'Enter') {
        e.preventDefault();
        onSend?.();
      }

      // Cmd/Ctrl+/: Toggle PlusMenu
      if (modKey && e.key === '/') {
        e.preventDefault();
        onTogglePlusMenu?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [disabled, isMobile, onFocus, onBlur, onSend, onTogglePlusMenu, textareaRef]);
}

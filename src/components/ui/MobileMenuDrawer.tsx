'use client';

import { ReactNode, useEffect, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { lockBodyScroll } from '@/lib/body-scroll-lock';

interface MobileMenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  side: 'left' | 'right';
  children: ReactNode;
  headerRight?: ReactNode;
  titleContent?: ReactNode;
}

/**
 * Full-page slide-in drawer for mobile menus.
 * Slides from left or right edge with backdrop overlay.
 */
export default function MobileMenuDrawer({
  isOpen,
  onClose,
  title,
  side,
  children,
  headerRight,
  titleContent,
}: MobileMenuDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Keep keyboard focus inside the modal drawer and restore it to the control
  // that opened the drawer after close.
  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;

    if (!isOpen) {
      drawer.setAttribute('inert', '');
      return;
    }

    drawer.removeAttribute('inert');
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const getFocusableElements = () => Array.from(
      drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => !element.hasAttribute('inert') && element.getAttribute('aria-hidden') !== 'true');

    const hasNestedModal = () => Boolean(document.querySelector('[data-modal-root="true"]'));

    const handleKeyDown = (e: KeyboardEvent) => {
      // A modal launched from this drawer owns focus and Escape until it
      // closes; the underlying drawer must remain open and inactive.
      if (hasNestedModal()) return;

      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;
      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        e.preventDefault();
        drawer.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (hasNestedModal()) return;
      if (!drawer.contains(e.target as Node)) {
        closeButtonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      window.requestAnimationFrame(() => {
        previouslyFocusedRef.current?.focus();
      });
    };
  }, [isOpen, onClose]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (!isOpen) return;
    return lockBodyScroll();
  }, [isOpen]);

  // Handle backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Swipe to close
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const startX = touch.clientX;

    const handleTouchMove = (moveEvent: TouchEvent) => {
      const currentX = moveEvent.touches[0].clientX;
      const deltaX = currentX - startX;

      // If swiping in the direction that would close the drawer
      if ((side === 'left' && deltaX < -50) || (side === 'right' && deltaX > 50)) {
        onClose();
        document.removeEventListener('touchmove', handleTouchMove);
      }
    };

    const handleTouchEnd = () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleTouchEnd);
  }, [side, onClose]);

  // Transform classes based on side and open state
  const getTransformClass = () => {
    if (isOpen) return 'translate-x-0';
    return side === 'left' ? '-translate-x-full' : 'translate-x-full';
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 z-50 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={handleBackdropClick}
        aria-hidden={!isOpen}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`fixed inset-y-0 ${side === 'left' ? 'left-0' : 'right-0'} w-full max-w-sm bg-white z-50 transform transition-transform duration-200 ease-out ${getTransformClass()} flex flex-col safe-area-top safe-area-bottom`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-hidden={!isOpen}
        tabIndex={-1}
        onTouchStart={handleTouchStart}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b bg-white">
          <div className="flex items-center gap-3">
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="p-2 -ml-2 rounded-lg hover:bg-gray-100 transition-colors"
              aria-label="Close menu"
            >
              <X size={20} className="text-gray-600" />
            </button>
            <h2 className="font-semibold text-gray-900 min-w-0">
              {titleContent ?? title}
            </h2>
          </div>
          {headerRight}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      </div>
    </>
  );
}

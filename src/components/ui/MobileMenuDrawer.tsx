'use client';

import { ReactNode, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

interface MobileMenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  side: 'left' | 'right';
  children: ReactNode;
  headerRight?: ReactNode;
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
}: MobileMenuDrawerProps) {
  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
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
        className={`fixed inset-y-0 ${side === 'left' ? 'left-0' : 'right-0'} w-full max-w-sm bg-white z-50 transform transition-transform duration-200 ease-out ${getTransformClass()} flex flex-col safe-area-top safe-area-bottom`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onTouchStart={handleTouchStart}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b bg-white">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-2 -ml-2 rounded-lg hover:bg-gray-100 transition-colors"
              aria-label="Close menu"
            >
              <X size={20} className="text-gray-600" />
            </button>
            <h2 className="font-semibold text-gray-900">{title}</h2>
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

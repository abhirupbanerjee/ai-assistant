'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { X, ChevronUp } from 'lucide-react';

interface ChipSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Number of active chips/toggles to show in the collapsed pill */
  activeCount: number;
  /** Chip slots from MessageInput */
  categoryChipSlot?: React.ReactNode;
  attachmentChipsSlot?: React.ReactNode;
  /** Inline mode chips (desktop inline chips, shown inside sheet on mobile) */
  modeChips?: React.ReactNode;
  languageToneChips?: React.ReactNode;
}

/**
 * ChipSheet — a mobile bottom sheet that consolidates chips and toggles
 * when the input is in FOCUSED-WRITE state on mobile.
 *
 * Collapsed: a compact pill showing active chip count.
 * Expanded: a slide-up bottom sheet with all chips, backdrop, and swipe-down to close.
 */
export default function ChipSheet({
  isOpen,
  onClose,
  activeCount,
  categoryChipSlot,
  attachmentChipsSlot,
  modeChips,
  languageToneChips,
}: ChipSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);

  // Swipe down to close — manual touch handling on the sheet element
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const touchEndY = e.changedTouches[0].clientY;
    const deltaY = touchEndY - touchStartY.current;
    if (deltaY > 50) {
      onClose();
    }
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Trap focus inside sheet when open
  useEffect(() => {
    if (!isOpen || !sheetRef.current) return;
    const firstFocusable = sheetRef.current.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();
  }, [isOpen]);

  const hasAnyContent = categoryChipSlot || attachmentChipsSlot || modeChips || languageToneChips;

  return (
    <>
      {/* Collapsed pill — shown when sheet is closed and there are active chips */}
      {!isOpen && activeCount > 0 && (
        <button
          onClick={onClose} // "onClose" actually opens it when collapsed
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 transition-colors"
          title={`${activeCount} option${activeCount !== 1 ? 's' : ''} active — tap to view`}
          aria-label={`${activeCount} option${activeCount !== 1 ? 's' : ''} active — tap to view`}
        >
          <ChevronUp size={12} />
          <span>{activeCount} active</span>
        </button>
      )}

      {/* Expanded bottom sheet */}
      {isOpen && hasAnyContent && (
        <div
          className="fixed inset-0 z-50 flex items-end animate-in fade-in duration-200"
          onClick={handleBackdropClick}
          role="dialog"
          aria-modal="true"
          aria-label="Options panel"
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30" />

          {/* Sheet */}
          <div
            ref={sheetRef}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="relative w-full bg-white rounded-t-2xl shadow-xl animate-in slide-in-from-bottom-4 duration-300 max-h-[60vh] overflow-y-auto"
          >
            {/* Handle bar */}
            <div className="sticky top-0 bg-white pt-3 pb-1 flex justify-center rounded-t-2xl z-10">
              <div className="w-10 h-1 bg-gray-300 rounded-full" />
            </div>

            {/* Close button */}
            <div className="absolute top-3 right-3 z-10">
              <button
                onClick={onClose}
                className="p-1.5 rounded-full hover:bg-gray-100 transition-colors text-gray-500"
                aria-label="Close options panel"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div ref={contentRef} className="px-4 pb-6 pt-2 space-y-3">
              {/* Category + Attachment chips */}
              {(categoryChipSlot || attachmentChipsSlot) && (
                <div className="flex flex-wrap items-center gap-2">
                  {categoryChipSlot}
                  {attachmentChipsSlot}
                </div>
              )}

              {/* Mode chips */}
              {modeChips && (
                <div className="flex flex-wrap items-center gap-2">
                  {modeChips}
                </div>
              )}

              {/* Language/Tone chips */}
              {languageToneChips && (
                <div className="flex flex-wrap items-center gap-2">
                  {languageToneChips}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}


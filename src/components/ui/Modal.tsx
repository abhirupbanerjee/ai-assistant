'use client';

import { useEffect, useRef, ReactNode } from 'react';
import { X } from 'lucide-react';
import { lockBodyScroll } from '@/lib/body-scroll-lock';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Allow content to overflow (useful for dropdowns). Default false. */
  allowOverflow?: boolean;
  /** Max width class. Default 'max-w-lg'. Options: 'max-w-sm', 'max-w-md', 'max-w-lg', 'max-w-xl', 'max-w-2xl', 'max-w-3xl' */
  maxWidth?: 'max-w-sm' | 'max-w-md' | 'max-w-lg' | 'max-w-xl' | 'max-w-2xl' | 'max-w-3xl';
}

export default function Modal({ isOpen, onClose, title, children, allowOverflow = false, maxWidth = 'max-w-lg' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  // Keep the latest callback available to the keyboard listener without making
  // the modal focus lifecycle depend on the callback's identity. Callers often
  // pass an inline function, which changes whenever controlled form state
  // changes; depending on it here used to rerun focus initialization after
  // every keystroke.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const releaseScrollLock = lockBodyScroll();

    const focusFrame = window.requestAnimationFrame(() => {
      // Prefer an editable field over the header close button. Falling back to
      // the first generic focusable element still supports confirmation modals
      // that contain buttons only.
      const firstField = dialogRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
      ) ?? dialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      );
      firstField?.focus();
    });

    const getFocusableElements = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }

      if (e.key !== 'Tab') return;
      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current?.focus();
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

    // Capture phase gives the topmost modal first refusal on Escape before an
    // underlying drawer's document listener can react.
    document.addEventListener('keydown', handleEscape, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleEscape, true);
      releaseScrollLock();
      window.requestAnimationFrame(() => previouslyFocusedRef.current?.focus());
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleOverlayClick}
      data-modal-root="true"
    >
      <div
        ref={dialogRef}
        className={`bg-white rounded-lg shadow-xl ${maxWidth} w-full mx-4 max-h-[90vh] flex flex-col`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            aria-label={`Close ${title}`}
          >
            <X size={20} />
          </button>
        </div>
        <div className={`p-6 ${allowOverflow ? 'overflow-visible' : 'overflow-y-auto max-h-[calc(90vh-8rem)]'}`}>
          {children}
        </div>
      </div>
    </div>
  );
}

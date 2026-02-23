'use client';

import { List, Paperclip } from 'lucide-react';
import { useMobileMenu } from '@/contexts/MobileMenuContext';

interface MobileFABsProps {
  threadCount: number;
  artifactCount: number;
  hasActiveThread: boolean;
}

/**
 * Floating Action Buttons for mobile view.
 * Positioned at top of screen to avoid overlap with input area.
 * - Left FAB: Opens Threads menu
 * - Right FAB: Opens Artifacts menu (only shown when there's an active thread)
 *
 * FABs auto-hide when:
 * - Input is expanded (typing)
 * - Scrolling down
 * - A menu is open
 */
export default function MobileFABs({
  threadCount,
  artifactCount,
  hasActiveThread,
}: MobileFABsProps) {
  const { shouldHideFABs, openThreadsMenu, openArtifactsMenu } = useMobileMenu();

  return (
    <>
      {/* Threads FAB - Top Left (below header) */}
      <button
        onClick={openThreadsMenu}
        className={`fixed top-16 left-4 z-40 w-12 h-12 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center transition-all duration-200 ${
          shouldHideFABs ? 'opacity-0 pointer-events-none -translate-y-4' : 'opacity-100 translate-y-0'
        }`}
        aria-label="Open threads menu"
      >
        <List size={20} className="text-gray-600" />
        {threadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-blue-500 text-white text-[10px] font-medium rounded-full flex items-center justify-center">
            {threadCount > 99 ? '99+' : threadCount}
          </span>
        )}
      </button>

      {/* Artifacts FAB - Top Right (below header, only when there's an active thread) */}
      {hasActiveThread && (
        <button
          onClick={openArtifactsMenu}
          className={`fixed top-16 right-4 z-40 w-12 h-12 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center transition-all duration-200 ${
            shouldHideFABs ? 'opacity-0 pointer-events-none -translate-y-4' : 'opacity-100 translate-y-0'
          }`}
          aria-label="Open artifacts menu"
        >
          <Paperclip size={20} className="text-gray-600" />
          {artifactCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-purple-500 text-white text-[10px] font-medium rounded-full flex items-center justify-center">
              {artifactCount > 99 ? '99+' : artifactCount}
            </span>
          )}
        </button>
      )}
    </>
  );
}

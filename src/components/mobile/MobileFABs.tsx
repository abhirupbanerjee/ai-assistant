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
      {/* Threads FAB - Bottom Left */}
      <button
        onClick={openThreadsMenu}
        className={`fixed bottom-20 left-4 z-40 w-14 h-14 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center transition-all duration-200 ${
          shouldHideFABs ? 'opacity-0 pointer-events-none translate-y-4' : 'opacity-100 translate-y-0'
        }`}
        aria-label="Open threads menu"
      >
        <List size={22} className="text-gray-600" />
        {threadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-blue-500 text-white text-xs font-medium rounded-full flex items-center justify-center">
            {threadCount > 99 ? '99+' : threadCount}
          </span>
        )}
      </button>

      {/* Artifacts FAB - Bottom Right (only when there's an active thread) */}
      {hasActiveThread && (
        <button
          onClick={openArtifactsMenu}
          className={`fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center transition-all duration-200 ${
            shouldHideFABs ? 'opacity-0 pointer-events-none translate-y-4' : 'opacity-100 translate-y-0'
          }`}
          aria-label="Open artifacts menu"
        >
          <Paperclip size={22} className="text-gray-600" />
          {artifactCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-purple-500 text-white text-xs font-medium rounded-full flex items-center justify-center">
              {artifactCount > 99 ? '99+' : artifactCount}
            </span>
          )}
        </button>
      )}
    </>
  );
}

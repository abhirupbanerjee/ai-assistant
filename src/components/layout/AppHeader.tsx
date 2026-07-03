'use client';

import { HelpCircle } from 'lucide-react';
import Link from 'next/link';
import MobileHeader from '@/components/mobile/MobileHeader';
import BotIcon from '@/components/ui/BotIcon';
import type { Thread } from '@/types';

interface AppHeaderProps {
  title: string;
  /** Bot icon key from branding settings (e.g., 'policy', 'ai-icon') */
  botIcon?: string;
  // Mobile-specific props
  isMobile?: boolean;
  activeThread?: Thread | null;
  onOpenThreadsMenu?: () => void;
  onNewThread?: () => void;
  onHomeClick?: () => void;
}

export default function AppHeader({
  title,
  botIcon,
  isMobile,
  activeThread,
  onOpenThreadsMenu,
  onNewThread,
  onHomeClick,
}: AppHeaderProps) {

  // On mobile with an active thread, show the contextual MobileHeader
  if (isMobile && activeThread && onOpenThreadsMenu && onNewThread) {
    return (
      <MobileHeader
        threadTitle={activeThread.title}
        category={activeThread.categories?.[0]}
        onBack={onOpenThreadsMenu}
        onNewThread={onNewThread}
      />
    );
  }

  // Desktop header or mobile without active thread
  return (
    <header className="shrink-0 bg-white border-b px-4 py-2 md:py-3 shadow-sm h-12 md:h-14 flex items-center justify-between">
      {/* Left: Logo and Bot Name */}
      <div className="flex items-center">
        <Link
          href="/chat"
          onClick={() => {
            onHomeClick?.();
          }}
          className="inline-flex items-center gap-2 text-base md:text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors cursor-pointer"
        >
          <BotIcon iconKey={botIcon} size={20} className="md:w-6 md:h-6 text-blue-600" />
          <span className="hidden sm:inline">{title}</span>
        </Link>
      </div>

      {/* Right: Help Link */}
      <div className="flex items-center gap-3">
        {/* Help Link */}
        <Link
          href="/help"
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <HelpCircle size={18} />
          <span className="hidden sm:inline">Help</span>
        </Link>
      </div>
    </header>
  );
}

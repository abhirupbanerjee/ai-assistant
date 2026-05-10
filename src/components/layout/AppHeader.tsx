'use client';

import { Bot } from 'lucide-react';
import Link from 'next/link';
import MobileHeader from '@/components/mobile/MobileHeader';
import type { Thread } from '@/types';

interface AppHeaderProps {
  title: string;
  // Mobile-specific props
  isMobile?: boolean;
  activeThread?: Thread | null;
  onOpenThreadsMenu?: () => void;
  onNewThread?: () => void;
  onHomeClick?: () => void;
}

export default function AppHeader({
  title,
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

  // Default: centered logo header
  return (
    <header className="shrink-0 bg-white border-b px-4 py-2 md:py-3 shadow-sm h-12 md:h-14 flex items-center justify-center">
      <Link
        href="/chat"
        onClick={onHomeClick}
        className="inline-flex items-center gap-2 text-base md:text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors cursor-pointer"
      >
        <Bot size={20} className="md:w-6 md:h-6 text-blue-600" />
        <span className="hidden sm:inline">{title}</span>
      </Link>
    </header>
  );
}

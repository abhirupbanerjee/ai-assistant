'use client';

import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Share2,
  Bot,
} from 'lucide-react';
import Link from 'next/link';

interface AppHeaderProps {
  title: string;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  showShareButton?: boolean;
  onShare?: () => void;
}

export default function AppHeader({
  title,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  leftSidebarOpen,
  rightSidebarOpen,
  showShareButton = false,
  onShare,
}: AppHeaderProps) {
  return (
    <header className="shrink-0 bg-white border-b px-4 py-3 shadow-sm">
      <div className="flex items-center">
        {/* Left section: Toggle button */}
        <div className="flex items-center">
          <button
            onClick={onToggleLeftSidebar}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title={leftSidebarOpen ? 'Collapse threads panel' : 'Expand threads panel'}
          >
            {leftSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
          </button>
        </div>

        {/* Center section: Logo + Bot Name */}
        <div className="flex-1 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors cursor-pointer"
          >
            <Bot size={24} className="text-blue-600" />
            <span>{title}</span>
          </Link>
        </div>

        {/* Right section: Share + Artifacts toggle */}
        <div className="flex items-center gap-2">
          {showShareButton && onShare && (
            <button
              onClick={onShare}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Share thread"
            >
              <Share2 size={18} />
            </button>
          )}
          <button
            onClick={onToggleRightSidebar}
            className="hidden lg:flex p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title={rightSidebarOpen ? 'Collapse artifacts panel' : 'Expand artifacts panel'}
          >
            {rightSidebarOpen ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
          </button>
        </div>
      </div>
    </header>
  );
}

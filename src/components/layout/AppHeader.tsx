'use client';

import { useState, useEffect, useRef } from 'react';
import { Bot, ChevronDown, HelpCircle, X } from 'lucide-react';
import Link from 'next/link';
import MobileHeader from '@/components/mobile/MobileHeader';
import type { Thread, UserSubscription } from '@/types';

interface Category {
  id: number;
  name: string;
}

interface AppHeaderProps {
  title: string;
  // Mobile-specific props
  isMobile?: boolean;
  activeThread?: Thread | null;
  onOpenThreadsMenu?: () => void;
  onNewThread?: () => void;
  onHomeClick?: () => void;
  // Category dropdown
  categories?: Category[];
  selectedCategoryId?: number | null;
  onCategoryChange?: (categoryId: number | null, categoryName: string) => void;
  // User subscriptions for category list
  userSubscriptions?: UserSubscription[];
}

export default function AppHeader({
  title,
  isMobile,
  activeThread,
  onOpenThreadsMenu,
  onNewThread,
  onHomeClick,
  categories,
  selectedCategoryId,
  onCategoryChange,
  userSubscriptions,
}: AppHeaderProps) {
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowCategoryDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Build category list from subscriptions if not provided
  const categoryList = categories || userSubscriptions?.filter(s => s.isActive).map(s => ({
    id: s.categoryId,
    name: s.categoryName,
  })) || [];

  const selectedCategory = categoryList.find(c => c.id === selectedCategoryId);

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
            // Clear selected category when clicking home
            onCategoryChange?.(null, 'All Categories');
          }}
          className="inline-flex items-center gap-2 text-base md:text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors cursor-pointer"
        >
          <Bot size={20} className="md:w-6 md:h-6 text-blue-600" />
          <span className="hidden sm:inline">{title}</span>
        </Link>
      </div>

      {/* Right: Category Dropdown + Help Link */}
      <div className="flex items-center gap-3">
        {/* Category Dropdown - show on desktop or when no active thread on mobile */}
        {categoryList.length > 0 && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors"
            >
              <span className="max-w-[120px] sm:max-w-[180px] truncate">
                {selectedCategory ? selectedCategory.name : 'All Categories'}
              </span>
              {selectedCategoryId ? (
                <X
                  size={14}
                  className="text-gray-400 hover:text-gray-600 ml-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCategoryChange?.(null, 'All Categories');
                  }}
                />
              ) : (
                <ChevronDown size={16} className={`transition-transform ${showCategoryDropdown ? 'rotate-180' : ''}`} />
              )}
            </button>

            {/* Category Dropdown Menu */}
            {showCategoryDropdown && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1">
                <button
                  onClick={() => {
                    onCategoryChange?.(null, 'All Categories');
                    setShowCategoryDropdown(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                    selectedCategoryId === null
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  All Categories
                </button>
                <div className="border-t border-gray-100 my-1" />
                {categoryList.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => {
                      onCategoryChange?.(category.id, category.name);
                      setShowCategoryDropdown(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors truncate ${
                      selectedCategoryId === category.id
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

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

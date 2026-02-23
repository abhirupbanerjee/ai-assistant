'use client';

import { ChevronLeft, Plus } from 'lucide-react';
import type { ThreadCategory } from '@/types';

interface MobileHeaderProps {
  threadTitle: string;
  category?: ThreadCategory;
  onBack: () => void;
  onNewThread: () => void;
}

/**
 * Mobile header shown when user is on an active thread.
 * Displays: [←] [Thread Title...] [Category Badge] [+ New]
 */
export default function MobileHeader({
  threadTitle,
  category,
  onBack,
  onNewThread,
}: MobileHeaderProps) {
  // Get category color based on name (simplified color mapping)
  const getCategoryColor = (categoryName?: string): string => {
    if (!categoryName) return 'bg-gray-100 text-gray-600';

    // Simple hash-based color selection
    const colors = [
      'bg-blue-100 text-blue-700',
      'bg-green-100 text-green-700',
      'bg-purple-100 text-purple-700',
      'bg-orange-100 text-orange-700',
      'bg-pink-100 text-pink-700',
      'bg-teal-100 text-teal-700',
      'bg-indigo-100 text-indigo-700',
      'bg-red-100 text-red-700',
    ];

    let hash = 0;
    for (let i = 0; i < categoryName.length; i++) {
      hash = ((hash << 5) - hash) + categoryName.charCodeAt(i);
      hash = hash & hash;
    }
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <header className="shrink-0 bg-white border-b px-2 py-2 shadow-sm">
      <div className="flex items-center gap-1">
        {/* Back button - opens threads menu */}
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
          aria-label="Back to threads"
        >
          <ChevronLeft size={24} className="text-gray-600" />
        </button>

        {/* Thread title - truncated */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <h1 className="text-sm font-medium text-gray-900 truncate">
            {threadTitle || 'New Chat'}
          </h1>

          {/* Category badge */}
          {category && (
            <span
              className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(category.name)}`}
            >
              {category.name}
            </span>
          )}
        </div>

        {/* New thread button */}
        <button
          onClick={onNewThread}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
          aria-label="New thread"
          style={{ color: 'var(--accent-color)' }}
        >
          <Plus size={22} strokeWidth={2.5} />
        </button>
      </div>
    </header>
  );
}

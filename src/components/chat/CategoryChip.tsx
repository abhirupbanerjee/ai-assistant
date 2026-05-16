'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, X, Search } from 'lucide-react';
import type { UserSubscription } from '@/types';

const RECENT_CATEGORIES_KEY = 'policybot:recentCategories';

interface CategoryChipProps {
  subscriptions: UserSubscription[];
  selectedCategoryId: number | null;
  onSelect: (categoryId: number | null) => void;
  locked?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  readOnly?: boolean;
}

function getRecentCategoryIds(): number[] {
  try {
    const raw = localStorage.getItem(RECENT_CATEGORIES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function saveRecentCategoryId(categoryId: number) {
  try {
    const existing = getRecentCategoryIds();
    const updated = [categoryId, ...existing.filter(id => id !== categoryId)].slice(0, 3);
    localStorage.setItem(RECENT_CATEGORIES_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}

export default function CategoryChip({
  subscriptions,
  selectedCategoryId,
  onSelect,
  locked = false,
  disabled = false,
  readOnly = false,
}: CategoryChipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [recentCategoryIds, setRecentCategoryIds] = useState<number[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load recent categories on mount
  useEffect(() => {
    setRecentCategoryIds(getRecentCategoryIds());
  }, []);

  // Hide dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Auto-focus search input when dropdown opens; clear filter when it closes
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    } else {
      setFilterText('');
    }
  }, [isOpen]);

  // Hide if no subscriptions or locked
  if (subscriptions.length === 0 || locked) {
    return null;
  }

  // Hide if only one subscription (no choice needed)
  if (subscriptions.length === 1 && !selectedCategoryId) {
    return null;
  }

  const selectedCategory = subscriptions.find(s => s.categoryId === selectedCategoryId);

  const filteredSubscriptions = useMemo(() => {
    if (!filterText.trim()) return subscriptions;
    const query = filterText.toLowerCase();
    return subscriptions.filter(s => s.categoryName.toLowerCase().includes(query));
  }, [subscriptions, filterText]);

  const handleSelect = (categoryId: number | null) => {
    if (categoryId !== null) {
      saveRecentCategoryId(categoryId);
      setRecentCategoryIds(getRecentCategoryIds());
    }
    onSelect(categoryId);
    setIsOpen(false);
    setFilterText('');
  };

  // Read-only badge (for active threads)
  if (readOnly && selectedCategory) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-700 border border-gray-300">
        <span className="truncate">{selectedCategory.categoryName}</span>
        <span className="text-xs font-semibold text-gray-500 ml-1 px-2 py-0.5 bg-gray-200 rounded">
          Active
        </span>
      </div>
    );
  }

  // Recent categories that are still valid subscriptions
  const validRecentCategories = recentCategoryIds
    .map(id => subscriptions.find(s => s.categoryId === id))
    .filter(Boolean) as UserSubscription[];

  return (
    <div className="relative inline-flex items-center gap-2 flex-wrap" ref={dropdownRef}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled || readOnly}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
          selectedCategory
            ? 'bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200'
            : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'
        } ${disabled || readOnly ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={selectedCategory ? `Category: ${selectedCategory.categoryName}` : 'Select a category'}
      >
        {selectedCategory ? (
          <>
            <span className="truncate">{selectedCategory.categoryName}</span>
            {!readOnly && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(null);
                }}
                className="ml-1 hover:opacity-70 transition-opacity"
                aria-label={`Clear ${selectedCategory.categoryName}`}
              >
                <X size={14} />
              </button>
            )}
          </>
        ) : (
          <>
            <span>Select category</span>
            <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {/* Quick-pick recent categories */}
      {!selectedCategoryId && !isOpen && validRecentCategories.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {validRecentCategories.map((sub) => (
            <button
              key={sub.categoryId}
              onClick={() => handleSelect(sub.categoryId)}
              className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
              title={sub.categoryName}
            >
              {sub.categoryName}
            </button>
          ))}
        </div>
      )}

      {/* Inline hint when required but not selected and no recent categories */}
      {subscriptions.length > 1 && !selectedCategoryId && validRecentCategories.length === 0 && (
        <span className="text-xs text-gray-500 hidden sm:inline">
          Pick a category
        </span>
      )}

      {/* Dropdown menu */}
      {isOpen && subscriptions.length > 1 && (
        <div className="absolute top-full left-0 mt-1 w-max min-w-[14rem] bg-white rounded-lg shadow-lg border border-gray-200 z-50 flex flex-col" role="listbox">
          {/* Search input */}
          <div className="px-2 py-1.5 border-b border-gray-100 flex items-center gap-2 sticky top-0 bg-white rounded-t-lg">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search categories..."
              className="w-full text-sm outline-none bg-transparent text-gray-700 placeholder-gray-400"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsOpen(false);
                }
              }}
            />
          </div>
          {/* Scrollable list */}
          <div className="overflow-y-auto max-h-60">
            {filteredSubscriptions.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-400 text-center">
                No categories found
              </div>
            ) : (
              filteredSubscriptions.map((sub) => (
                <button
                  key={sub.categoryId}
                  onClick={() => handleSelect(sub.categoryId)}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                    selectedCategoryId === sub.categoryId
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  role="option"
                  aria-selected={selectedCategoryId === sub.categoryId}
                >
                  {sub.categoryName}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

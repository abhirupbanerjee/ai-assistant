'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { UserSubscription } from '@/types';

interface CategoryChipProps {
  subscriptions: UserSubscription[];
  selectedCategoryId: number | null;
  onSelect: (categoryId: number | null) => void;
  locked?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  readOnly?: boolean;
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
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Hide if no subscriptions or locked
  if (subscriptions.length === 0 || locked) {
    return null;
  }

  // Hide if only one subscription (no choice needed)
  if (subscriptions.length === 1 && !selectedCategoryId) {
    return null;
  }

  const selectedCategory = subscriptions.find(s => s.categoryId === selectedCategoryId);

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

  return (
    <div className="relative inline-flex items-center gap-2" ref={dropdownRef}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled || readOnly}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
          selectedCategory
            ? 'bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200'
            : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'
        } ${disabled || readOnly ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {selectedCategory ? (
          <>
            <span className="truncate">{selectedCategory.categoryName}</span>
            {!readOnly && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(null);
                  setIsOpen(false);
                }}
                className="ml-1 hover:opacity-70 transition-opacity"
                aria-label="Clear category"
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

      {/* Dropdown menu */}
      {isOpen && subscriptions.length > 1 && (
        <div className="absolute top-full left-0 mt-1 w-max bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
          {subscriptions.map((sub) => (
            <button
              key={sub.categoryId}
              onClick={() => {
                onSelect(sub.categoryId);
                setIsOpen(false);
              }}
              className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                selectedCategoryId === sub.categoryId
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {sub.categoryName}
            </button>
          ))}
        </div>
      )}

      {/* Inline hint when required but not selected */}
      {subscriptions.length > 1 && !selectedCategoryId && (
        <span className="text-xs text-gray-500 hidden sm:inline">
          Pick a category
        </span>
      )}
    </div>
  );
}

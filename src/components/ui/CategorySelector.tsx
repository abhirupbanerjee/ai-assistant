'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, X, Tag, Check } from 'lucide-react';

interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string;
}

interface CategorySelectorProps {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Single selection mode - only one category can be selected at a time */
  singleSelect?: boolean;
}

export default function CategorySelector({
  selectedIds,
  onChange,
  placeholder = 'Select categories...',
  disabled = false,
  className = '',
  singleSelect = false,
}: CategorySelectorProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch user's available categories
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const response = await fetch('/api/user/categories');
        if (response.ok) {
          const data = await response.json();
          setCategories(data.categories || []);
        }
      } catch (err) {
        console.error('Failed to fetch categories:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCategories();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleCategory = (categoryId: number) => {
    if (singleSelect) {
      // In single-select mode, selecting a category replaces the current selection
      // Clicking the already-selected category deselects it
      if (selectedIds.includes(categoryId)) {
        onChange([]);
      } else {
        onChange([categoryId]);
      }
      setIsOpen(false); // Close dropdown after selection in single-select mode
    } else {
      // Multi-select mode
      if (selectedIds.includes(categoryId)) {
        onChange(selectedIds.filter(id => id !== categoryId));
      } else {
        onChange([...selectedIds, categoryId]);
      }
    }
  };

  const removeCategory = (categoryId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selectedIds.filter(id => id !== categoryId));
  };

  const selectedCategories = categories.filter(cat => selectedIds.includes(cat.id));

  if (loading) {
    return (
      <div className={`h-10 bg-gray-100 rounded-lg animate-pulse ${className}`} />
    );
  }

  if (categories.length === 0) {
    return (
      <div className={`text-sm text-gray-500 py-2 ${className}`}>
        No categories available
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Selected categories / trigger button */}
      <div
        role="combobox"
        aria-expanded={isOpen}
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setIsOpen(!isOpen); } }}
        className={`
          w-full min-h-[40px] px-3 py-2 text-left
          bg-white border rounded-lg
          flex items-center flex-wrap gap-1.5
          ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'hover:border-gray-400 cursor-pointer'}
          ${isOpen ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-300'}
        `}
      >
        {selectedCategories.length === 0 ? (
          <span className="text-gray-500 text-sm">{placeholder}</span>
        ) : (
          selectedCategories.map(cat => (
            <span
              key={cat.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full"
            >
              <Tag size={10} />
              {cat.name}
              {!disabled && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => removeCategory(cat.id, e)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); removeCategory(cat.id, e as unknown as React.MouseEvent); } }}
                  className="hover:bg-blue-200 rounded-full p-0.5 cursor-pointer"
                >
                  <X size={10} />
                </span>
              )}
            </span>
          ))
        )}
        <ChevronDown
          size={16}
          className={`ml-auto text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
          {/* Show all categories with scroll after 5 items (approx 220px) */}
          <div className="max-h-[220px] overflow-y-auto">
            {categories.map(cat => {
              const isSelected = selectedIds.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => toggleCategory(cat.id)}
                  className={`
                    w-full px-3 py-2.5 text-left flex items-center gap-2
                    hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0
                    ${isSelected ? 'bg-blue-50' : ''}
                  `}
                >
                  {singleSelect ? (
                    // Radio button for single-select
                    <div className={`
                      w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0
                      ${isSelected ? 'border-blue-600' : 'border-gray-300'}
                    `}>
                      {isSelected && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                    </div>
                  ) : (
                    // Checkbox for multi-select
                    <div className={`
                      w-4 h-4 rounded border flex items-center justify-center shrink-0
                      ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}
                    `}>
                      {isSelected && <Check size={12} className="text-white" />}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900">
                      {cat.name}
                    </div>
                    {cat.description && (
                      <div className="text-xs text-gray-500 line-clamp-1">
                        {cat.description}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {/* Scroll indicator when there are more than 5 categories */}
          {categories.length > 5 && (
            <div className="px-3 py-1.5 text-xs text-gray-400 text-center border-t border-gray-100 bg-gray-50">
              Scroll to see more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useRef } from 'react';
import { Languages, Check } from 'lucide-react';

interface Language {
  code: string;
  name: string;
}

interface LanguageSelectorProps {
  selectedLanguage: string;
  onLanguageChange: (languageCode: string) => void;
  disabled?: boolean;
}

export default function LanguageSelector({
  selectedLanguage,
  onLanguageChange,
  disabled,
}: LanguageSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [languages, setLanguages] = useState<Language[]>([{ code: 'en', name: 'English' }]);
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch available languages on mount
  useEffect(() => {
    const fetchLanguages = async () => {
      try {
        const response = await fetch('/api/chat/languages');
        if (response.ok) {
          const data = await response.json();
          setLanguages(data.languages);
          setTranslationEnabled(data.translationEnabled);
        }
      } catch (error) {
        console.error('Failed to fetch languages:', error);
      }
    };
    fetchLanguages();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedLang = languages.find(l => l.code === selectedLanguage) || languages[0];
  const isNonEnglish = selectedLanguage !== 'en';

  // Don't show if translation is not enabled and only English is available
  if (!translationEnabled && languages.length <= 1) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={disabled}
        onMouseEnter={() => !showDropdown && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`p-2 rounded-lg transition-colors flex items-center gap-1 ${
          isNonEnglish
            ? 'bg-green-100 text-green-700 hover:bg-green-200'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <Languages size={20} />
        {isNonEnglish && (
          <span className="text-xs font-medium uppercase">{selectedLanguage}</span>
        )}
      </button>

      {/* Tooltip */}
      {showTooltip && !showDropdown && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-50 shadow-lg">
          <span className="font-medium">Response language</span>
          <p className="text-gray-400 mt-0.5">
            {isNonEnglish
              ? `Translating to ${selectedLang.name}`
              : 'Click to translate responses'}
          </p>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute bottom-full left-0 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[160px] py-1">
          <div className="px-3 py-1.5 text-xs text-gray-500 font-medium border-b border-gray-100">
            Response Language
          </div>
          {languages.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => {
                onLanguageChange(lang.code);
                setShowDropdown(false);
              }}
              className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-gray-50 ${
                selectedLanguage === lang.code ? 'text-green-700 bg-green-50' : 'text-gray-700'
              }`}
            >
              <span>{lang.name}</span>
              {selectedLanguage === lang.code && <Check size={16} />}
            </button>
          ))}
          {selectedLanguage !== 'en' && (
            <div className="px-3 py-1.5 text-xs text-gray-400 border-t border-gray-100 mt-1">
              Responses will be translated
            </div>
          )}
        </div>
      )}
    </div>
  );
}

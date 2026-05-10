'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import LanguageSelector from './LanguageSelector';
import ToneSelector from './ToneSelector';

interface InlineLanguageToneChipsProps {
  selectedLanguage: string;
  onLanguageChange: (languageCode: string) => void;
  selectedTone: string;
  onToneChange: (tone: string) => void;
  disabled?: boolean;
}

export default function InlineLanguageToneChips({
  selectedLanguage,
  onLanguageChange,
  selectedTone,
  onToneChange,
  disabled = false,
}: InlineLanguageToneChipsProps) {
  const [openDropdown, setOpenDropdown] = useState<'language' | 'tone' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };

    if (openDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [openDropdown]);

  // Get display labels
  const getLanguageLabel = () => {
    const labels: Record<string, string> = {
      en: 'English',
      es: 'Español',
      fr: 'Français',
      de: 'Deutsch',
      it: 'Italiano',
      pt: 'Português',
      ja: '日本語',
      zh: '中文',
      ko: '한국어',
      ru: 'Русский',
      ar: 'العربية',
    };
    return labels[selectedLanguage] || selectedLanguage;
  };

  const getToneLabel = () => {
    const labels: Record<string, string> = {
      default: 'Default',
      formal: 'Formal',
      casual: 'Casual',
      technical: 'Technical',
      friendly: 'Friendly',
    };
    return labels[selectedTone] || selectedTone;
  };

  return (
    <div ref={containerRef} className="flex items-center gap-2">
      {/* Language Selector */}
      <div className="relative">
        <button
          onClick={() => setOpenDropdown(openDropdown === 'language' ? null : 'language')}
          disabled={disabled}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            selectedLanguage !== 'en'
              ? 'bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200'
              : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          title={`Language: ${getLanguageLabel()}`}
          aria-label={`Language: ${getLanguageLabel()}`}
        >
          <span>{getLanguageLabel()}</span>
          <ChevronDown size={12} className={`transition-transform ${openDropdown === 'language' ? 'rotate-180' : ''}`} />
        </button>

        {/* Language Dropdown */}
        {openDropdown === 'language' && (
          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[140px]">
            <LanguageSelector
              selectedLanguage={selectedLanguage}
              onLanguageChange={(lang) => {
                onLanguageChange(lang);
                setOpenDropdown(null);
              }}
            />
          </div>
        )}
      </div>

      {/* Tone Selector */}
      <div className="relative">
        <button
          onClick={() => setOpenDropdown(openDropdown === 'tone' ? null : 'tone')}
          disabled={disabled}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            selectedTone !== 'default'
              ? 'bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200'
              : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          title={`Tone: ${getToneLabel()}`}
          aria-label={`Tone: ${getToneLabel()}`}
        >
          <span>{getToneLabel()}</span>
          <ChevronDown size={12} className={`transition-transform ${openDropdown === 'tone' ? 'rotate-180' : ''}`} />
        </button>

        {/* Tone Dropdown */}
        {openDropdown === 'tone' && (
          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[140px]">
            <ToneSelector
              selectedTone={selectedTone}
              onToneChange={(tone) => {
                onToneChange(tone);
                setOpenDropdown(null);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

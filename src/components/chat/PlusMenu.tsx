'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus } from 'lucide-react';
import FileUpload from './FileUpload';
import ModeToggle, { ChatMode } from './ModeToggle';
import WebSearchToggle from './WebSearchToggle';
import LanguageSelector from './LanguageSelector';
import ToneSelector from './ToneSelector';

interface UrlSourceInfo {
  filename: string;
  originalUrl: string;
  sourceType: 'web' | 'youtube';
  title?: string;
}

interface PlusMenuProps {
  // FileUpload props
  threadId: string | null;
  currentUploads: string[];
  onUploadComplete: (filename: string) => void;
  onUrlSourceAdded?: (source: UrlSourceInfo) => void;
  // ModeToggle props
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  autonomousAdminDisabled?: boolean;
  // WebSearchToggle props
  webSearchEnabled: boolean;
  onWebSearchToggle: (enabled: boolean) => void;
  // LanguageSelector props
  selectedLanguage: string;
  onLanguageChange: (languageCode: string) => void;
  // ToneSelector props
  selectedTone: string;
  onToneChange: (tone: string) => void;
  // General
  disabled?: boolean;
}

export default function PlusMenu({
  threadId,
  currentUploads,
  onUploadComplete,
  onUrlSourceAdded,
  mode,
  onModeChange,
  autonomousAdminDisabled,
  webSearchEnabled,
  onWebSearchToggle,
  selectedLanguage,
  onLanguageChange,
  selectedTone,
  onToneChange,
  disabled,
}: PlusMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Count active features for badge
  const activeCount = [
    mode === 'autonomous',
    webSearchEnabled,
    selectedLanguage !== 'en',
    selectedTone !== 'default',
    currentUploads.length > 0,
  ].filter(Boolean).length;

  return (
    <div ref={menuRef} className="relative">
      {/* Plus button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className={`p-2 rounded-lg transition-colors relative ${
          isOpen
            ? 'bg-blue-100 text-blue-700'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <Plus size={20} className={`transition-transform ${isOpen ? 'rotate-45' : ''}`} />
        {/* Active features badge */}
        {activeCount > 0 && !isOpen && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white text-[10px] font-medium rounded-full flex items-center justify-center">
            {activeCount}
          </span>
        )}
      </button>

      {/* Popup menu */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 p-2 z-50">
          {/* Tool buttons in a row */}
          <div className="flex items-center gap-1">
            <FileUpload
              threadId={threadId}
              currentUploads={currentUploads}
              onUploadComplete={onUploadComplete}
              onUrlSourceAdded={onUrlSourceAdded}
              disabled={disabled}
            />
            <ModeToggle mode={mode} onModeChange={onModeChange} disabled={disabled} adminDisabled={autonomousAdminDisabled} />
            <WebSearchToggle
              enabled={webSearchEnabled}
              onToggle={onWebSearchToggle}
              disabled={disabled}
            />
            <LanguageSelector
              selectedLanguage={selectedLanguage}
              onLanguageChange={onLanguageChange}
              disabled={disabled}
            />
            <ToneSelector
              selectedTone={selectedTone}
              onToneChange={onToneChange}
              disabled={disabled}
            />
          </div>

          {/* Upload count indicator */}
          {currentUploads.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500 text-center">
              {currentUploads.length} file{currentUploads.length !== 1 ? 's' : ''} attached
            </div>
          )}
        </div>
      )}
    </div>
  );
}

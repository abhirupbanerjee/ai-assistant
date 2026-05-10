'use client';

import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Plus } from 'lucide-react';
import FileUpload from './FileUpload';
import ModeToggle, { ChatMode } from './ModeToggle';
import WebSearchToggle from './WebSearchToggle';
import CitationTrajectoryToggle from './CitationTrajectoryToggle';

// Lazy-load LanguageSelector and ToneSelector (rarely used on first interaction)
const DynamicLanguageSelector = dynamic(() => import('./LanguageSelector'), { ssr: false });
const DynamicToneSelector = dynamic(() => import('./ToneSelector'), { ssr: false });


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
  // CitationTrajectoryToggle props
  showCitationTrajectory: boolean;
  onCitationTrajectoryToggle: (enabled: boolean) => void;
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
  showCitationTrajectory,
  onCitationTrajectoryToggle,
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

   // Count active toggles (excluding uploads which are shown separately)
   const activeToggles = [
     mode === 'autonomous',
     webSearchEnabled,
     selectedLanguage !== 'en',
     selectedTone !== 'default',
     showCitationTrajectory,
   ].filter(Boolean).length;

   const hasUploads = currentUploads.length > 0;
   const hasActiveFeatures = activeToggles > 0 || hasUploads;

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
         {/* Active features badge: green dot for toggles, number for uploads */}
         {hasActiveFeatures && !isOpen && (
           <div className="absolute -top-1 -right-1 flex items-center gap-0.5">
             {activeToggles > 0 && (
               <span className="w-2 h-2 bg-green-500 rounded-full" title="Active toggles" />
             )}
             {hasUploads && (
               <span className="w-4 h-4 bg-blue-500 text-white text-[9px] font-medium rounded-full flex items-center justify-center">
                 {currentUploads.length > 9 ? '9+' : currentUploads.length}
               </span>
             )}
           </div>
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
            <DynamicLanguageSelector
              selectedLanguage={selectedLanguage}
              onLanguageChange={onLanguageChange}
              disabled={disabled}
            />
            <DynamicToneSelector
              selectedTone={selectedTone}
              onToneChange={onToneChange}
              disabled={disabled}
            />

            <CitationTrajectoryToggle
              enabled={showCitationTrajectory}
              onToggle={onCitationTrajectoryToggle}
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

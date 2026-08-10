'use client';

import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Plus, X } from 'lucide-react';
import FileUpload from './FileUpload';
import ModeToggle, { ChatMode } from './ModeToggle';
import WebSearchToggle from './WebSearchToggle';
import CitationTrajectoryToggle from './CitationTrajectoryToggle';
import SourcesToggle from './SourcesToggle';

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
  onUploadComplete: (result: { filename: string; item?: import('@/types').ThreadUploadItem }) => void;
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
  // SourcesToggle props
  showSources: boolean;
  onSourcesToggle: (enabled: boolean) => void;
  adminSourcesDisabled?: boolean;
  // CitationTrajectoryToggle admin control
  adminCitationTrajectoryDisabled?: boolean;
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
  showSources,
  onSourcesToggle,
  adminSourcesDisabled,
  adminCitationTrajectoryDisabled,
  disabled,
}: PlusMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen]);

   // Count active toggles (excluding uploads which are shown separately)
   const activeToggles = [
     mode === 'autonomous',
     webSearchEnabled,
     selectedLanguage !== 'en',
     selectedTone !== 'default',
     showCitationTrajectory,
     showSources,
   ].filter(Boolean);

   const hasUploads = currentUploads.length > 0;
   const hasActiveFeatures = activeToggles.length > 0 || hasUploads;

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
          {/* Active features badge: blue dot for toggles, number for uploads */}
          {hasActiveFeatures && !isOpen && (
            <div className="absolute -top-1 -right-1 flex items-center gap-0.5">
              {activeToggles.length > 0 && (
                <span className="w-2 h-2 bg-blue-500 rounded-full" title="Active toggles" />
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
         <div className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 p-3 z-50 min-w-[300px]">
           {/* Header */}
           <div className="flex items-center justify-between mb-3">
             <span className="text-sm font-semibold text-gray-900">Chat Settings</span>
             <button
               onClick={() => setIsOpen(false)}
               className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
               aria-label="Close settings"
             >
               <X size={16} />
             </button>
           </div>

           {/* Capabilities Section */}
           <div className="border-t border-gray-100 pt-2">
             <div className="text-xs uppercase text-gray-500 font-medium mb-2">Capabilities</div>
             <div className="flex items-center gap-2">
               <ModeToggle mode={mode} onModeChange={onModeChange} disabled={disabled} adminDisabled={autonomousAdminDisabled} />
               <WebSearchToggle
                 enabled={webSearchEnabled}
                 onToggle={onWebSearchToggle}
                 disabled={disabled}
               />
                <CitationTrajectoryToggle
                  enabled={showCitationTrajectory}
                  onToggle={onCitationTrajectoryToggle}
                  disabled={disabled}
                  adminDisabled={adminCitationTrajectoryDisabled}
                />
               <SourcesToggle
                 enabled={showSources}
                 onToggle={onSourcesToggle}
                 disabled={disabled}
                 adminDisabled={adminSourcesDisabled}
               />
             </div>
           </div>

           {/* Language & Tone Section */}
           <div className="border-t border-gray-100 pt-2 mt-2">
             <div className="text-xs uppercase text-gray-500 font-medium mb-2">Language & Tone</div>
             <div className="space-y-2">
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
             </div>
           </div>

           {/* Attachments Section */}
           <div className="border-t border-gray-100 pt-2 mt-2">
             <div className="text-xs uppercase text-gray-500 font-medium mb-2">Attachments</div>
             <div className="flex items-center gap-2">
               <FileUpload
                 threadId={threadId}
                 currentUploads={currentUploads}
                 onUploadComplete={onUploadComplete}
                 onUrlSourceAdded={onUrlSourceAdded}
                 disabled={disabled}
               />
               <span className="text-sm text-gray-600">
                 {currentUploads.length > 0
                   ? `${currentUploads.length} file${currentUploads.length !== 1 ? 's' : ''} attached`
                   : 'Add files, URLs, or YouTube'}
               </span>
             </div>
           </div>
         </div>
       )}
   </div>
 );
}

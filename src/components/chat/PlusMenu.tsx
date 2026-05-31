'use client';

import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Plus, X, ChevronRight, Image, BarChart3, Workflow, FileText, Code, Presentation, Sheet } from 'lucide-react';
import Modal from '@/components/ui/Modal';
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
  // SourcesToggle props
  showSources: boolean;
  onSourcesToggle: (enabled: boolean) => void;
  adminSourcesDisabled?: boolean;
  // CitationTrajectoryToggle admin control
  adminCitationTrajectoryDisabled?: boolean;
  // Create menu
  onCreateCommandSelect?: (commandKey: string) => void;
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
  onCreateCommandSelect,
  disabled,
}: PlusMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showAllCreate, setShowAllCreate] = useState(false);
  const [createCommands, setCreateCommands] = useState<Array<{ commandKey: string; label: string; description: string; icon: string }>>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch enabled slash commands for Create menu
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/chat/slash-commands')
      .then((r) => r.json())
      .then((data) => {
        setCreateCommands(data.commands || []);
      })
      .catch(() => {
        setCreateCommands([]);
      });
  }, [isOpen]);

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

           {/* Create Section */}
           {createCommands.length > 0 && onCreateCommandSelect && (
             <div className="border-t border-gray-100 pt-2 mt-2">
               <div className="text-xs uppercase text-gray-500 font-medium mb-2">Create</div>
               <div className="flex flex-col gap-1">
                 {createCommands.slice(0, 6).map((cmd) => {
                   const iconMap: Record<string, React.ReactNode> = {
                     Image: <Image size={14} className="text-gray-500" />,
                     BarChart3: <BarChart3 size={14} className="text-gray-500" />,
                     Workflow: <Workflow size={14} className="text-gray-500" />,
                     FileText: <FileText size={14} className="text-gray-500" />,
                     Code: <Code size={14} className="text-gray-500" />,
                     Presentation: <Presentation size={14} className="text-gray-500" />,
                     Sheet: <Sheet size={14} className="text-gray-500" />,
                   };
                   return (
                     <button
                       key={cmd.commandKey}
                       type="button"
                       onClick={() => {
                         onCreateCommandSelect(cmd.commandKey);
                         setIsOpen(false);
                       }}
                       className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-100 text-left transition-colors"
                     >
                       {iconMap[cmd.icon] || <FileText size={14} className="text-gray-500" />}
                       <span className="text-xs text-gray-700">{cmd.label}</span>
                     </button>
                   );
                 })}
                 {createCommands.length > 6 && (
                   <button
                     type="button"
                     onClick={() => setShowAllCreate(true)}
                     className="w-full flex items-center justify-center gap-1 px-3 py-2 rounded-lg hover:bg-gray-100 text-left transition-colors text-xs text-blue-600 font-medium"
                   >
                     Show All ({createCommands.length})
                     <ChevronRight size={14} />
                   </button>
                 )}
               </div>
             </div>
           )}

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

      {/* Show All Create Commands Modal */}
      <Modal
        isOpen={showAllCreate}
        onClose={() => setShowAllCreate(false)}
        title="Create"
        maxWidth="max-w-md"
      >
        <div className="grid grid-cols-2 gap-2">
          {createCommands.map((cmd) => {
            const iconMap: Record<string, React.ReactNode> = {
              Image: <Image size={18} className="text-gray-500" />,
              BarChart3: <BarChart3 size={18} className="text-gray-500" />,
              Workflow: <Workflow size={18} className="text-gray-500" />,
              FileText: <FileText size={18} className="text-gray-500" />,
              Code: <Code size={18} className="text-gray-500" />,
              Presentation: <Presentation size={18} className="text-gray-500" />,
              Sheet: <Sheet size={18} className="text-gray-500" />,
            };
            return (
              <button
                key={cmd.commandKey}
                type="button"
                onClick={() => {
                  onCreateCommandSelect?.(cmd.commandKey);
                  setShowAllCreate(false);
                  setIsOpen(false);
                }}
                className="flex flex-col items-start gap-1.5 p-3 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-left transition-colors"
              >
                <div className="flex items-center gap-2">
                  {iconMap[cmd.icon] || <FileText size={18} className="text-gray-500" />}
                  <span className="text-sm font-medium text-gray-900">{cmd.label}</span>
                </div>
                {cmd.description && (
                  <span className="text-xs text-gray-500 line-clamp-2">{cmd.description}</span>
                )}
              </button>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}

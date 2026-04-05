'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, Mic, Paperclip, Settings, AlertCircle, Loader2, X } from 'lucide-react';
import VoiceInput from '@/components/chat/VoiceInput';
import FileUpload from '@/components/chat/FileUpload';
import ModeToggle, { ChatMode } from '@/components/chat/ModeToggle';
import WebSearchToggle from '@/components/chat/WebSearchToggle';
import LanguageSelector from '@/components/chat/LanguageSelector';
import ToneSelector from '@/components/chat/ToneSelector';
import ModelSelector from '@/components/chat/ModelSelector';
import type { ChatPreferences } from '@/types/stream';
import { useMobileMenuOptional } from '@/contexts/MobileMenuContext';

interface UrlSourceInfo {
  filename: string;
  originalUrl: string;
  sourceType: 'web' | 'youtube';
  title?: string;
}

interface MobileMessageInputProps {
  onSend: (message: string, mode?: ChatMode, preferences?: ChatPreferences) => void;
  disabled?: boolean;
  threadId: string | null;
  currentUploads: string[];
  onUploadComplete: (filename: string) => void;
  onUrlSourceAdded?: (source: UrlSourceInfo) => void;
  preferences: ChatPreferences;
  onPreferencesChange: (preferences: ChatPreferences) => void;
  modelReady?: boolean;
  onModelStatusChange?: (ready: boolean) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

/**
 * Mobile-optimized message input with collapsible state.
 * Collapsed: thin bar with voice and attach buttons
 * Expanded: full textarea with preferences menu
 * Hides while scrolling to maximize reading space.
 */
export default function MobileMessageInput({
  onSend,
  disabled,
  threadId,
  currentUploads,
  onUploadComplete,
  onUrlSourceAdded,
  preferences,
  onPreferencesChange,
  modelReady = true,
  onModelStatusChange,
  onFocus,
  onBlur,
}: MobileMessageInputProps) {
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<ChatMode>('normal');
  const [isExpanded, setIsExpanded] = useState(false);
  const [showPrefsMenu, setShowPrefsMenu] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prefsMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenu = useMobileMenuOptional();

  // Should hide input while scrolling (from context)
  const shouldHideInput = mobileMenu?.shouldHideInput ?? false;

  // Update context when expanded state changes
  useEffect(() => {
    mobileMenu?.setInputExpanded(isExpanded);
  }, [isExpanded, mobileMenu]);

  // Auto-resize textarea: 1 line default (~24px), expand up to 4 lines (~96px), then scroll
  const LINE_HEIGHT = 24;
  const MAX_LINES = 4;
  const MAX_HEIGHT = LINE_HEIGHT * MAX_LINES; // 96px

  useEffect(() => {
    if (textareaRef.current && isExpanded) {
      textareaRef.current.style.height = `${LINE_HEIGHT}px`;
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, MAX_HEIGHT)}px`;
    }
  }, [message, isExpanded]);

  // Close prefs menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (prefsMenuRef.current && !prefsMenuRef.current.contains(event.target as Node)) {
        setShowPrefsMenu(false);
      }
    };

    if (showPrefsMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showPrefsMenu]);

  const isSubmitDisabled = disabled || !modelReady;

  const handleSubmit = () => {
    if (message.trim() && !isSubmitDisabled) {
      onSend(message.trim(), mode, preferences);
      setMessage('');
      setMode('normal');
      setIsExpanded(false);
      setShowPrefsMenu(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleExpand = () => {
    setIsExpanded(true);
    onFocus?.();
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleCollapse = () => {
    if (!message.trim()) {
      setIsExpanded(false);
      setShowPrefsMenu(false);
      onBlur?.();
    }
  };

  const handleVoiceTranscript = (text: string) => {
    setMessage((prev) => prev + (prev ? ' ' : '') + text);
    if (!isExpanded) {
      handleExpand();
    }
  };

  // Handle paste for file uploads
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items || !threadId) return;

    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length === 0) return;

    e.preventDefault();
    setUploadError(null);
    setIsUploading(true);

    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`/api/threads/${threadId}/upload`, {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          onUploadComplete(data.filename);
        } else {
          const errorData = await response.json();
          setUploadError(errorData.error || 'Failed to upload file');
        }
      } catch {
        setUploadError('Failed to upload file. Please try again.');
      }
    }
    setIsUploading(false);
  }, [threadId, onUploadComplete]);

  // Preference handlers
  const handleWebSearchToggle = (enabled: boolean) => {
    onPreferencesChange({ ...preferences, webSearchEnabled: enabled });
  };

  const handleLanguageChange = (languageCode: string) => {
    onPreferencesChange({ ...preferences, targetLanguage: languageCode });
  };

  const handleToneChange = (tone: string) => {
    onPreferencesChange({ ...preferences, responseTone: tone });
  };

  // Count active features
  const activeCount = [
    mode === 'autonomous',
    preferences.webSearchEnabled,
    preferences.targetLanguage !== 'en',
    preferences.responseTone !== 'default',
  ].filter(Boolean).length;

  // Collapsed state - thin bar (hidden while scrolling)
  if (!isExpanded) {
    return (
      <div className={`bg-white p-3 safe-area-bottom transition-all duration-200 ${
        shouldHideInput ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'
      }`}>
        <div
          onClick={handleExpand}
          className="bg-gray-50 rounded-2xl border border-gray-200 px-4 py-3 flex items-center gap-3 cursor-text"
        >
          {/* Voice button */}
          <div onClick={(e) => e.stopPropagation()}>
            <VoiceInput onTranscript={handleVoiceTranscript} disabled={disabled} />
          </div>

          {/* Placeholder */}
          <span className="flex-1 text-gray-400 text-sm">
            {currentUploads.length > 0
              ? `${currentUploads.length} file${currentUploads.length !== 1 ? 's' : ''} attached • Tap to type...`
              : 'Tap to type...'}
          </span>

          {/* Attach button */}
          <div onClick={(e) => e.stopPropagation()}>
            <FileUpload
              threadId={threadId}
              currentUploads={currentUploads}
              onUploadComplete={onUploadComplete}
              onUrlSourceAdded={onUrlSourceAdded}
              disabled={disabled}
            />
          </div>
        </div>
      </div>
    );
  }

  // Expanded state - full input
  return (
    <div className="bg-white p-3 safe-area-bottom">
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3">
        {/* Upload indicators */}
        {currentUploads.length > 0 && (
          <div className="flex items-center gap-2 mb-2 text-sm">
            <span
              className="px-2 py-1 rounded text-sm"
              style={{
                backgroundColor: 'var(--accent-light)',
                color: 'var(--accent-text)',
              }}
            >
              {currentUploads.length} file{currentUploads.length !== 1 ? 's' : ''} attached
            </span>
          </div>
        )}

        {/* Upload Error */}
        {uploadError && (
          <div className="mb-2 p-2 bg-red-50 text-red-600 rounded-lg text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{uploadError}</span>
              </div>
              <button
                onClick={() => setUploadError(null)}
                className="p-0.5 hover:bg-red-100 rounded flex-shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Uploading Indicator */}
        {isUploading && (
          <div className="mb-2 p-2 bg-blue-50 text-blue-600 rounded-lg text-sm flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Uploading file...
          </div>
        )}

        {/* Textarea - 1 line default, expands to 4 lines, then scrolls */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={handleCollapse}
          placeholder="Ask a question..."
          disabled={disabled || isUploading}
          rows={1}
          enterKeyHint="send"
          className="w-full bg-transparent resize-none focus:outline-none text-gray-900 placeholder-gray-400"
          style={{ minHeight: `${LINE_HEIGHT}px`, maxHeight: `${MAX_HEIGHT}px`, lineHeight: `${LINE_HEIGHT}px` }}
          autoFocus
        />

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200">
          {/* Left: Voice + Attach */}
          <div className="flex items-center gap-1">
            <VoiceInput onTranscript={handleVoiceTranscript} disabled={disabled} />
            <FileUpload
              threadId={threadId}
              currentUploads={currentUploads}
              onUploadComplete={onUploadComplete}
              onUrlSourceAdded={onUrlSourceAdded}
              disabled={disabled}
            />
          </div>

          {/* Center: Prefs menu */}
          <div className="relative" ref={prefsMenuRef}>
            <button
              type="button"
              onClick={() => setShowPrefsMenu(!showPrefsMenu)}
              disabled={disabled}
              className={`p-2 rounded-lg transition-colors relative ${
                showPrefsMenu || activeCount > 0
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-500 hover:bg-gray-100'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Settings size={18} />
              {activeCount > 0 && !showPrefsMenu && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white text-[10px] font-medium rounded-full flex items-center justify-center">
                  {activeCount}
                </span>
              )}
            </button>

            {/* Prefs popup */}
            {showPrefsMenu && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 p-3 z-50 min-w-[280px]">
                <div className="text-xs font-medium text-gray-500 mb-2">Chat Options</div>

                {/* Options grid */}
                <div className="flex flex-wrap gap-2 mb-3">
                  <ModeToggle mode={mode} onModeChange={setMode} disabled={disabled} />
                  <WebSearchToggle
                    enabled={preferences.webSearchEnabled}
                    onToggle={handleWebSearchToggle}
                    disabled={disabled}
                  />
                  <LanguageSelector
                    selectedLanguage={preferences.targetLanguage}
                    onLanguageChange={handleLanguageChange}
                    disabled={disabled}
                  />
                  <ToneSelector
                    selectedTone={preferences.responseTone}
                    onToneChange={handleToneChange}
                    disabled={disabled}
                  />
                </div>

                {/* Model selector */}
                <div className="pt-2 border-t border-gray-100">
                  <div className="text-xs font-medium text-gray-500 mb-2">Model</div>
                  <ModelSelector threadId={threadId} disabled={disabled} onModelStatusChange={onModelStatusChange} />
                </div>
              </div>
            )}
          </div>

          {/* Right: Send */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitDisabled || !message.trim()}
            className="p-2.5 rounded-full text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            style={{ backgroundColor: 'var(--accent-color)' }}
          >
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

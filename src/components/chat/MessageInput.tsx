'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

import { ArrowUp, Loader2, Square, Bot, Globe, Paperclip } from 'lucide-react';
import VoiceInput from './VoiceInput';
import PlusMenu from './PlusMenu';
import ModelSelector from './ModelSelector';
import InlineModeChips from './InlineModeChips';
import InlineLanguageToneChips from './InlineLanguageToneChips';
import ChipSheet, { type ActiveFeatureBadge } from './ChipSheet';

import { ChatMode } from './ModeToggle';
import { useToast } from '@/contexts/ToastContext';
import type { ChatPreferences } from '@/types/stream';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useDraftPersistence } from '@/hooks/useDraftPersistence';
import { useInputState } from '@/hooks/useInputState';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

interface UrlSourceInfo {
  filename: string;
  originalUrl: string;
  sourceType: 'web' | 'youtube';
  title?: string;
}

interface MessageInputProps {
  onSend: (message: string, mode?: ChatMode, preferences?: ChatPreferences) => void;
  disabled?: boolean;
  threadId: string | null;
  currentUploads: string[];
  onUploadComplete: (filename: string) => void;
  onUrlSourceAdded?: (source: UrlSourceInfo) => void;
  // Chat preferences
  preferences: ChatPreferences;
  onPreferencesChange: (preferences: ChatPreferences) => void;
  // Autonomous mode admin control
  autonomousAdminDisabled?: boolean;
  // Model readiness — false when no valid model is available for the active route
  modelReady?: boolean;
  onModelStatusChange?: (ready: boolean) => void;
  // Streaming state
  isStreaming?: boolean;
  onAbort?: () => void;
  // Focus callbacks for sidebar hiding (mobile)
  onFocus?: () => void;
  onBlur?: () => void;
  // Chip slots for CategoryChip and AttachmentChipsRow
  categoryChipSlot?: React.ReactNode;
  attachmentChipsSlot?: React.ReactNode;
}

export default function MessageInput({
  onSend,
  disabled,
  threadId,
  currentUploads,
  onUploadComplete,
  onUrlSourceAdded,
  preferences,
  onPreferencesChange,
  autonomousAdminDisabled,
  modelReady = true,
  onModelStatusChange,
  isStreaming = false,
  onAbort,
  onFocus,
  onBlur,
  categoryChipSlot,
  attachmentChipsSlot,
}: MessageInputProps) {
  const [message, setMessage] = useState('');
  // Restore default mode from localStorage on mount
  const [mode, setMode] = useState<ChatMode>(() => {
    if (typeof window === 'undefined') return 'normal';
    try {
      const saved = localStorage.getItem('policybot:pref:defaultMode');
      return (saved as ChatMode) || 'normal';
    } catch {
      return 'normal';
    }
  });
  const [isUploading, setIsUploading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [lineCount, setLineCount] = useState(1);
  const [chipSheetOpen, setChipSheetOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();

  // Toast notifications
  const { addToast } = useToast();

  // Draft persistence
  const { clearDraft, restoredEvent, dismissRestoredEvent, draftSaveError, clearDraftSaveError } = useDraftPersistence(threadId, message, setMessage);

  // Fire toast when draft is restored or when draft save fails
  useEffect(() => {
    if (restoredEvent) {
      addToast('Draft restored', 'info', 4000);
      dismissRestoredEvent();
    }
  }, [restoredEvent, addToast, dismissRestoredEvent]);

  // Fire toast for draft save errors
  useEffect(() => {
    if (draftSaveError) {
      addToast(draftSaveError.message, 'error', 5000);
      clearDraftSaveError();
    }
  }, [draftSaveError, addToast, clearDraftSaveError]);


  // Input state management (COMPACT/EXPANDED/FOCUSED-WRITE)
  const { state: inputState } = useInputState({
    value: message,
    isFocused,
    attachmentCount: currentUploads.length,
    lineCount,
  });

  // Compute active feature badges for ChipSheet collapsed pill
  const activeFeatures = useMemo<ActiveFeatureBadge[]>(() => {
    const features: ActiveFeatureBadge[] = [];
    if (mode === 'autonomous') {
      features.push({ icon: <Bot size={12} />, label: 'Autonomous' });
    }
    if (preferences.webSearchEnabled) {
      features.push({ icon: <Globe size={12} />, label: 'Web Search' });
    }
    if (preferences.targetLanguage !== 'en') {
      features.push({
        icon: <span className="text-[10px] font-bold">{preferences.targetLanguage.toUpperCase()}</span>,
        label: preferences.targetLanguage,
      });
    }
    if (currentUploads.length > 0) {
      features.push({
        icon: <Paperclip size={12} />,
        label: `${currentUploads.length} file${currentUploads.length !== 1 ? 's' : ''}`,
      });
    }
    return features;
  }, [mode, preferences.webSearchEnabled, preferences.targetLanguage, currentUploads.length]);


  // aria-live state announcements — announce input state transitions to screen readers
  const prevInputState = useRef(inputState);
  const [stateAnnouncement, setStateAnnouncement] = useState('');
  useEffect(() => {
    if (prevInputState.current !== inputState) {
      prevInputState.current = inputState;
      const labels: Record<string, string> = {
        compact: 'Compact input mode',
        expanded: 'Expanded input mode with options',
        'focused-write': 'Focused input mode',
      };
      setStateAnnouncement(labels[inputState] || '');
    }
  }, [inputState]);


  // Auto-resize textarea with different max heights for mobile vs desktop
  useEffect(() => {
    if (textareaRef.current) {
      const maxHeight = isMobile ? 112 : 150; // Mobile: 4 lines, Desktop: ~6 lines
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
      
      // Calculate line count (approximate: 28px per line on mobile, 24px on desktop)
      const lineHeightPx = isMobile ? 28 : 24;
      const calculatedLines = Math.ceil(scrollHeight / lineHeightPx);
      setLineCount(calculatedLines);
    }
  }, [message, isMobile]);

  const isSubmitDisabled = disabled || !modelReady;

  // Preference change handlers
  const handleWebSearchToggle = useCallback((enabled: boolean) => {
    onPreferencesChange({ ...preferences, webSearchEnabled: enabled });
  }, [preferences, onPreferencesChange]);

  const handleLanguageChange = useCallback((languageCode: string) => {
    onPreferencesChange({ ...preferences, targetLanguage: languageCode });
  }, [preferences, onPreferencesChange]);

  const handleToneChange = useCallback((tone: string) => {
    onPreferencesChange({ ...preferences, responseTone: tone });
  }, [preferences, onPreferencesChange]);

  const handleCitationTrajectoryToggle = useCallback((enabled: boolean) => {
    onPreferencesChange({ ...preferences, showCitationTrajectory: enabled });
  }, [preferences, onPreferencesChange]);

  const handleSubmit = useCallback(() => {
    if (message.trim() && !isSubmitDisabled) {
      onSend(message.trim(), mode, preferences);
      setMessage('');
      clearDraft();
      // Save mode to localStorage for next session
      try {
        localStorage.setItem('policybot:pref:defaultMode', mode);
      } catch (error) {
        console.warn('Failed to save default mode preference:', error);
      }
      // Reset mode to normal after sending
      setMode('normal');
    }
  }, [message, isSubmitDisabled, onSend, mode, preferences, clearDraft]);

  // Memoized keyboard shortcut callbacks to prevent listener re-binding
  const focusTextarea = useCallback(() => {
    textareaRef.current?.focus();
  }, []);

  const blurTextarea = useCallback(() => {
    textareaRef.current?.blur();
  }, []);

  // Keyboard shortcuts (desktop only)
  useKeyboardShortcuts({
    onFocus: focusTextarea,
    onBlur: blurTextarea,
    onSend: handleSubmit,
    onTogglePlusMenu: undefined,
    textareaRef: textareaRef as React.RefObject<HTMLTextAreaElement>,
    disabled: disabled || isMobile,
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // On mobile, Enter always inserts a new line (submit via button only)
      if (isMobile) return;
      // Shift+Enter or Ctrl/Cmd+Enter = new line
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        return; // Allow default new line behavior
      }
      // Enter alone = submit
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleVoiceTranscript = (text: string) => {
    setMessage((prev) => prev + (prev ? ' ' : '') + text);
    textareaRef.current?.focus();
  };

  const handleFocus = () => {
    setIsFocused(true);
    onFocus?.();
  };

  const handleBlur = () => {
    setIsFocused(false);
    onBlur?.();
  };

  // Upload a single file
  const uploadFile = useCallback(async (file: File) => {
    if (!threadId) return;

    setIsUploading(true);

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
        const errorMsg = errorData.error || 'Failed to upload file';
        addToast(errorMsg, 'error', 5000);
      }
    } catch (error) {
      addToast('Failed to upload file. Please try again.', 'error', 5000);
    } finally {
      setIsUploading(false);
    }
  }, [threadId, onUploadComplete, addToast]);

  // Handle paste event for file uploads
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items || !threadId) return;

    // Extract files from clipboard
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }

    // If no files, let default paste behavior handle it (text paste)
    if (files.length === 0) return;

    // Prevent default paste for file uploads
    e.preventDefault();

    // Upload each file
    for (const file of files) {
      await uploadFile(file);
    }
  }, [threadId, uploadFile]);

  // Unified layout for both mobile and desktop
  return (
    <div className="bg-white p-4 safe-area-bottom transition-all duration-300" data-state={inputState}>
      {/* Screen reader state announcements */}
      <span role="status" aria-live="polite" className="sr-only">
        {stateAnnouncement}
      </span>
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3 transition-all duration-300">

        {/* Chip slots: CategoryChip + AttachmentChipsRow (visible in EXPANDED state) */}
        {/* On mobile FOCUSED-WRITE, chips are shown in the ChipSheet instead */}
        {(categoryChipSlot || attachmentChipsSlot) && inputState !== 'compact' && (
          <div className="mb-3 flex flex-wrap items-center gap-2 transition-all duration-300">
            {/* On mobile focused-write, show ChipSheet collapsed pill instead of inline chips */}
            {isMobile && inputState === 'focused-write' ? (
              <ChipSheet
                isOpen={chipSheetOpen}
                onClose={() => setChipSheetOpen(false)}
                activeFeatures={activeFeatures}
                categoryChipSlot={categoryChipSlot}
                attachmentChipsSlot={attachmentChipsSlot}
                modeChips={
                  <InlineModeChips
                    mode={mode}
                    onModeChange={setMode}
                    webSearchEnabled={preferences.webSearchEnabled}
                    onWebSearchToggle={handleWebSearchToggle}
                    autonomousAdminDisabled={autonomousAdminDisabled}
                    disabled={disabled}
                  />
                }
                languageToneChips={
                  <InlineLanguageToneChips
                    selectedLanguage={preferences.targetLanguage}
                    onLanguageChange={handleLanguageChange}
                    selectedTone={preferences.responseTone}
                    onToneChange={handleToneChange}
                    disabled={disabled}
                  />
                }
              />
            ) : (
              <>
                {categoryChipSlot}
                {attachmentChipsSlot}
              </>
            )}
          </div>
        )}

        {/* Uploading Indicator - kept inline as it's transient but active */}
        {isUploading && (
          <div className="mb-2 p-2 bg-blue-50 text-blue-600 rounded-lg text-sm flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Uploading file...
          </div>
        )}

        {/* Textarea - responsive sizing */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="Ask a question..."
          disabled={isUploading}
          rows={isMobile ? 2 : 1}
          enterKeyHint={isMobile ? 'enter' : 'send'}
          className={`w-full bg-transparent resize-none focus:outline-none text-gray-900 placeholder-gray-400 ${
            isMobile ? 'min-h-[56px] max-h-[112px]' : 'min-h-[40px] max-h-[150px]'
          }`}
        />

        {/* Bottom row: Voice + Plus menu + Model selector + Submit */}
        <div className="flex items-center justify-between mt-2">
          {/* Left actions: Voice + Plus menu */}
          <div className="flex items-center gap-1">
            <VoiceInput onTranscript={handleVoiceTranscript} />
            <PlusMenu
              threadId={threadId}
              currentUploads={currentUploads}
              onUploadComplete={onUploadComplete}
              onUrlSourceAdded={onUrlSourceAdded}
              mode={mode}
              onModeChange={setMode}
              autonomousAdminDisabled={autonomousAdminDisabled}
              webSearchEnabled={preferences.webSearchEnabled}
              onWebSearchToggle={handleWebSearchToggle}
              selectedLanguage={preferences.targetLanguage}
              onLanguageChange={handleLanguageChange}
              selectedTone={preferences.responseTone}
              onToneChange={handleToneChange}
              showCitationTrajectory={preferences.showCitationTrajectory}
              onCitationTrajectoryToggle={handleCitationTrajectoryToggle}
            />
          </div>

          {/* Center: Model selector */}
          <ModelSelector threadId={threadId} onModelStatusChange={onModelStatusChange} />

          {/* Right action: Send or Stop (during streaming) */}
          {isStreaming ? (
            <button
              onClick={onAbort}
              className="p-2.5 rounded-full text-white transition-all bg-red-500 hover:bg-red-600 flex-shrink-0"
              title="Stop generation"
              aria-label="Stop generation"
            >
              <Square size={18} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitDisabled || !message.trim()}
              className="p-2.5 rounded-full text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              style={{
                backgroundColor: 'var(--accent-color)',
              }}
              onMouseEnter={(e) => {
                if (!isSubmitDisabled && message.trim()) {
                  e.currentTarget.style.backgroundColor = 'var(--accent-hover)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--accent-color)';
              }}
              title="Send message"
              aria-label="Send message"
            >
              <ArrowUp size={18} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* Draft restored toast — fired via useToast on restore */}
    </div>
  );
}

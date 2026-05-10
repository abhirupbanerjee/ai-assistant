'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, AlertCircle, Loader2, X, Square, RotateCcw } from 'lucide-react';
import VoiceInput from './VoiceInput';
import PlusMenu from './PlusMenu';
import ModelSelector from './ModelSelector';
import InlineModeChips from './InlineModeChips';
import InlineLanguageToneChips from './InlineLanguageToneChips';
import Toast from '@/components/ui/Toast';
import { ChatMode } from './ModeToggle';
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
  const [mode, setMode] = useState<ChatMode>('normal');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [lineCount, setLineCount] = useState(1);
  const [lastFailedFile, setLastFailedFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();

  // Draft persistence
  const { clearDraft, restoredEvent, dismissRestoredEvent } = useDraftPersistence(threadId, message, setMessage);

  // Input state management (COMPACT/EXPANDED/FOCUSED-WRITE)
  const { state: inputState } = useInputState({
    value: message,
    isFocused,
    attachmentCount: currentUploads.length,
    lineCount,
  });

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

    setUploadError(null);
    setIsUploading(true);
    setLastFailedFile(null);

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
        setUploadError(errorMsg);
        setLastFailedFile(file);
      }
    } catch (error) {
      setUploadError('Failed to upload file. Please try again.');
      setLastFailedFile(file);
    } finally {
      setIsUploading(false);
    }
  }, [threadId, onUploadComplete]);

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

  // Uploads indicator
  const UploadsIndicator = () =>
    currentUploads.length > 0 ? (
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
    ) : null;

  // Unified layout for both mobile and desktop
  return (
    <div className="bg-white p-4 safe-area-bottom transition-all duration-300" data-state={inputState}>
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3 transition-all duration-300">
        {/* Chip slots: CategoryChip + AttachmentChipsRow (visible in EXPANDED state) */}
        {(categoryChipSlot || attachmentChipsSlot) && inputState !== 'compact' && (
          <div className="mb-3 flex flex-wrap items-center gap-2 transition-all duration-300">
            {categoryChipSlot}
            {attachmentChipsSlot}
            {/* Inline mode chips on desktop EXPANDED */}
            {!isMobile && (
              <>
                <InlineModeChips
                  mode={mode}
                  onModeChange={setMode}
                  webSearchEnabled={preferences.webSearchEnabled}
                  onWebSearchToggle={handleWebSearchToggle}
                  autonomousAdminDisabled={autonomousAdminDisabled}
                  disabled={disabled}
                />
                <InlineLanguageToneChips
                  selectedLanguage={preferences.targetLanguage}
                  onLanguageChange={handleLanguageChange}
                  selectedTone={preferences.responseTone}
                  onToneChange={handleToneChange}
                  disabled={disabled}
                />
              </>
            )}
          </div>
        )}

        <UploadsIndicator />

        {/* Upload Error */}
        {uploadError && (
          <div className="mb-2 p-2 bg-red-50 text-red-600 rounded-lg text-sm" role="alert">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                <div>
                  <div>{uploadError}</div>
                  <div className="text-xs text-red-500 mt-1">
                    Supported: PDF, PNG, JPG, WebP, TXT (max size from settings)
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {lastFailedFile && (
                  <button
                    onClick={() => uploadFile(lastFailedFile)}
                    disabled={isUploading}
                    className="p-0.5 hover:bg-red-100 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                    title="Retry upload"
                    aria-label="Retry upload"
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                  </button>
                )}
                <button
                  onClick={() => {
                    setUploadError(null);
                    setLastFailedFile(null);
                  }}
                  className="p-0.5 hover:bg-red-100 rounded"
                  aria-label="Dismiss error"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
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

      {/* Draft restored toast */}
      {restoredEvent && (
        <Toast
          message="Draft restored"
          type="info"
          duration={4000}
          onDismiss={dismissRestoredEvent}
        />
      )}
    </div>
  );
}

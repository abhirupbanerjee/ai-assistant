'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, AlertCircle, Loader2, X } from 'lucide-react';
import VoiceInput from './VoiceInput';
import PlusMenu from './PlusMenu';
import ModelSelector from './ModelSelector';
import { ChatMode } from './ModeToggle';
import type { ChatPreferences } from '@/types/stream';
import { useIsMobile } from '@/hooks/useMediaQuery';

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
  // Focus callbacks for sidebar hiding (mobile)
  onFocus?: () => void;
  onBlur?: () => void;
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
  onFocus,
  onBlur,
}: MessageInputProps) {
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<ChatMode>('normal');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();

  // Auto-resize textarea with different max heights for mobile vs desktop
  useEffect(() => {
    if (textareaRef.current) {
      const maxHeight = isMobile ? 112 : 150; // Mobile: 4 lines, Desktop: ~6 lines
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`;
    }
  }, [message, isMobile]);

  const isSubmitDisabled = disabled || !modelReady;

  const handleSubmit = () => {
    if (message.trim() && !isSubmitDisabled) {
      onSend(message.trim(), mode, preferences);
      setMessage('');
      // Reset mode to normal after sending
      setMode('normal');
    }
  };

  // Preference change handlers
  const handleWebSearchToggle = (enabled: boolean) => {
    onPreferencesChange({ ...preferences, webSearchEnabled: enabled });
  };

  const handleLanguageChange = (languageCode: string) => {
    onPreferencesChange({ ...preferences, targetLanguage: languageCode });
  };

  const handleToneChange = (tone: string) => {
    onPreferencesChange({ ...preferences, responseTone: tone });
  };

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
    onFocus?.();
  };

  const handleBlur = () => {
    onBlur?.();
  };

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
    setUploadError(null);
    setIsUploading(true);

    // Upload each file
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
      } catch (error) {
        setUploadError('Failed to upload file. Please try again.');
      }
    }

    setIsUploading(false);
  }, [threadId, onUploadComplete]);

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
    <div className="bg-white p-4 safe-area-bottom">
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3">
        <UploadsIndicator />

        {/* Upload Error */}
        {uploadError && (
          <div className="mb-2 p-2 bg-red-50 text-red-600 rounded-lg text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <div>
                  <div>{uploadError}</div>
                  <div className="text-xs text-red-500 mt-1">
                    Supported: PDF, PNG, JPG, WebP, TXT (max size from settings)
                  </div>
                </div>
              </div>
              <button
                onClick={() => setUploadError(null)}
                className="p-0.5 hover:bg-red-100 rounded flex-shrink-0"
                aria-label="Dismiss error"
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
            />
          </div>

          {/* Center: Model selector */}
          <ModelSelector threadId={threadId} onModelStatusChange={onModelStatusChange} />

          {/* Right action: Send */}
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
          >
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

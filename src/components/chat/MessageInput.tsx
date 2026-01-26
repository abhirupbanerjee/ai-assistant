'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';
import VoiceInput from './VoiceInput';
import PlusMenu from './PlusMenu';
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
  onFocus,
  onBlur,
}: MessageInputProps) {
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<ChatMode>('normal');
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

  const handleSubmit = () => {
    if (message.trim() && !disabled) {
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
      if (isMobile) {
        // Mobile: Enter = new line (default behavior)
        return;
      } else {
        // Desktop: Enter = submit, Ctrl+Enter = new line
        if (e.ctrlKey || e.metaKey) {
          return; // Allow new line with Ctrl/Cmd+Enter
        }
        e.preventDefault();
        handleSubmit();
      }
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

  // Send button
  const SendButton = () => (
    <button
      onClick={handleSubmit}
      disabled={disabled || !message.trim()}
      className="p-2.5 rounded-full text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
      style={{
        backgroundColor: 'var(--accent-color)',
      }}
      onMouseEnter={(e) => {
        if (!disabled && message.trim()) {
          e.currentTarget.style.backgroundColor = 'var(--accent-hover)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--accent-color)';
      }}
    >
      <ArrowUp size={18} strokeWidth={2.5} />
    </button>
  );

  // Unified layout for both mobile and desktop
  return (
    <div className="bg-white p-4 safe-area-bottom">
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3">
        <UploadsIndicator />

        {/* Textarea - responsive sizing */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="Ask a question..."
          disabled={disabled}
          rows={isMobile ? 2 : 1}
          enterKeyHint={isMobile ? 'enter' : 'send'}
          className={`w-full bg-transparent resize-none focus:outline-none text-gray-900 placeholder-gray-400 ${
            isMobile ? 'min-h-[56px] max-h-[112px]' : 'min-h-[40px] max-h-[150px]'
          }`}
        />

        {/* Bottom row: Voice + Plus menu + Submit */}
        <div className="flex items-center justify-between mt-2">
          {/* Left actions: Voice + Plus menu */}
          <div className="flex items-center gap-1">
            <VoiceInput onTranscript={handleVoiceTranscript} disabled={disabled} />
            <PlusMenu
              threadId={threadId}
              currentUploads={currentUploads}
              onUploadComplete={onUploadComplete}
              onUrlSourceAdded={onUrlSourceAdded}
              mode={mode}
              onModeChange={setMode}
              webSearchEnabled={preferences.webSearchEnabled}
              onWebSearchToggle={handleWebSearchToggle}
              selectedLanguage={preferences.targetLanguage}
              onLanguageChange={handleLanguageChange}
              selectedTone={preferences.responseTone}
              onToneChange={handleToneChange}
              disabled={disabled}
            />
          </div>

          {/* Right action: Send */}
          <SendButton />
        </div>
      </div>
    </div>
  );
}

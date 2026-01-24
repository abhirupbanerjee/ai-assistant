'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';
import VoiceInput from './VoiceInput';
import FileUpload from './FileUpload';
import ModeToggle, { ChatMode } from './ModeToggle';
import WebSearchToggle from './WebSearchToggle';
import LanguageSelector from './LanguageSelector';
import ToneSelector from './ToneSelector';
import type { ChatPreferences } from '@/types/stream';
import { useIsTouchDevice } from '@/hooks/useIsTouchDevice';

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
}: MessageInputProps) {
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<ChatMode>('normal');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isTouchDevice = useIsTouchDevice();

  // Auto-resize textarea with different max heights for mobile vs desktop
  useEffect(() => {
    if (textareaRef.current) {
      const maxHeight = isTouchDevice ? 112 : 150; // Mobile: 4 lines, Desktop: ~6 lines
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`;
    }
  }, [message, isTouchDevice]);

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
    // On touch devices: Enter creates new line (default behavior)
    // On desktop: Enter submits, Shift+Enter creates new line
    if (e.key === 'Enter' && !e.shiftKey && !isTouchDevice) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleVoiceTranscript = (text: string) => {
    setMessage((prev) => prev + (prev ? ' ' : '') + text);
    textareaRef.current?.focus();
  };

  // Reusable uploads indicator
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

  // Reusable send button
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

  // Mobile layout: Voice + Textarea + Send in main row, tools below
  if (isTouchDevice) {
    return (
      <div className="bg-white p-4 safe-area-bottom">
        <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3">
          <UploadsIndicator />

          {/* Main row: Voice + Textarea + Send */}
          <div className="flex items-end gap-2">
            <div className="flex-shrink-0 pb-0.5">
              <VoiceInput onTranscript={handleVoiceTranscript} disabled={disabled} />
            </div>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question..."
              disabled={disabled}
              rows={2}
              enterKeyHint="enter"
              className="flex-1 bg-transparent resize-none focus:outline-none text-gray-900 placeholder-gray-400 min-h-[56px] max-h-[112px]"
            />
            <div className="flex-shrink-0 pb-0.5">
              <SendButton />
            </div>
          </div>

          {/* Tools row: centered */}
          <div className="flex items-center justify-center gap-2 mt-2 pt-2 border-t border-gray-200">
            <FileUpload
              threadId={threadId}
              currentUploads={currentUploads}
              onUploadComplete={onUploadComplete}
              onUrlSourceAdded={onUrlSourceAdded}
              disabled={disabled}
            />
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
          </div>
        </div>
      </div>
    );
  }

  // Desktop layout: current layout unchanged
  return (
    <div className="bg-white p-4 safe-area-bottom">
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3">
        <UploadsIndicator />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question..."
          disabled={disabled}
          rows={1}
          enterKeyHint="send"
          className="w-full bg-transparent resize-none focus:outline-none text-gray-900 placeholder-gray-400 min-h-[40px] max-h-[150px]"
        />

        {/* Bottom row: actions + send */}
        <div className="flex items-center justify-between mt-2">
          {/* Left actions */}
          <div className="flex items-center gap-1">
            <FileUpload
              threadId={threadId}
              currentUploads={currentUploads}
              onUploadComplete={onUploadComplete}
              onUrlSourceAdded={onUrlSourceAdded}
              disabled={disabled}
            />
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

          {/* Right actions */}
          <div className="flex items-center gap-1">
            <VoiceInput onTranscript={handleVoiceTranscript} disabled={disabled} />
            <SendButton />
          </div>
        </div>
      </div>
    </div>
  );
}

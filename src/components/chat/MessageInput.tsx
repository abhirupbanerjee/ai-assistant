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

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [message]);

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleVoiceTranscript = (text: string) => {
    setMessage((prev) => prev + (prev ? ' ' : '') + text);
    textareaRef.current?.focus();
  };

  return (
    <div className="bg-white p-4 safe-area-bottom">
      {/* Claude-style contained input card */}
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3">
        {/* Uploads indicator */}
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

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question..."
          disabled={disabled}
          rows={1}
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

            {/* Send button with accent color */}
            <button
              onClick={handleSubmit}
              disabled={disabled || !message.trim()}
              className="p-2.5 rounded-full text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                backgroundColor: disabled || !message.trim()
                  ? 'var(--accent-color)'
                  : 'var(--accent-color)',
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
          </div>
        </div>
      </div>
    </div>
  );
}

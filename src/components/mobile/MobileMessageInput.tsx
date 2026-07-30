'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, Mic, Paperclip, Settings, AlertCircle, Loader2, X } from 'lucide-react';
import SlashCommandMenu from '@/components/chat/SlashCommandMenu';
import AgentMentionMenu from '@/components/chat/AgentMentionMenu';
import VoiceInput from '@/components/chat/VoiceInput';
import FileUpload from '@/components/chat/FileUpload';
import ModeToggle, { ChatMode } from '@/components/chat/ModeToggle';
import WebSearchToggle from '@/components/chat/WebSearchToggle';
import LanguageSelector from '@/components/chat/LanguageSelector';
import ToneSelector from '@/components/chat/ToneSelector';
import ModelSelector from '@/components/chat/ModelSelector';
import type { ChatPreferences } from '@/types/stream';
import { buildSubmitPayload } from '@/lib/message-input-parser';
import { serializeToPlainText, insertMentionSpan, getCursorToken } from '@/lib/chat-input-dom';
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
 * Expanded: full contentEditable div with preferences menu
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
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const MAX_SLASH_COMMANDS = 3;
  const [activeSlashCommands, setActiveSlashCommands] = useState<string[]>([]);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [activeAgentMentions, setActiveAgentMentions] = useState<string[]>([]);
  // Phase 5: pipeline orchestration — token cache
  const [knownAgentIds, setKnownAgentIds] = useState<Set<string>>(new Set());
  const [knownCommandKeys, setKnownCommandKeys] = useState<Set<string>>(new Set());
  const contentEditableRef = useRef<HTMLDivElement>(null);
  const prefsMenuRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenu = useMobileMenuOptional();

  // Should hide input while scrolling (from context)
  const shouldHideInput = mobileMenu?.shouldHideInput ?? false;

  // Update context when expanded state changes
  useEffect(() => {
    mobileMenu?.setInputExpanded(isExpanded);
  }, [isExpanded, mobileMenu]);

  // Phase 5: pre-fetch known agents and slash commands for pipeline validation
  useEffect(() => {
    fetch('/api/chat/agents')
      .then((r) => r.json())
      // Lowercase ids to match parsePipelinePrompt's lowercased @token lookup.
      .then((d) =>
        setKnownAgentIds(new Set((d.agents as Array<{ id: string }>).map((a) => a.id.toLowerCase())))
      )
      .catch(() => {});
    fetch('/api/chat/slash-commands')
      .then((r) => r.json())
      .then((d) =>
        setKnownCommandKeys(
          new Set((d.commands as Array<{ commandKey: string }>).map((c) => c.commandKey))
        )
      )
      .catch(() => {});
  }, []);

  // Auto-resize contentEditable div: 1 line default (~24px), expand up to 4 lines (~96px)
  const LINE_HEIGHT = 24;
  const MAX_LINES = 4;
  const MAX_HEIGHT = LINE_HEIGHT * MAX_LINES; // 96px

  useEffect(() => {
    if (contentEditableRef.current && isExpanded) {
      contentEditableRef.current.style.height = `${LINE_HEIGHT}px`;
      const scrollHeight = contentEditableRef.current.scrollHeight;
      contentEditableRef.current.style.height = `${Math.min(scrollHeight, MAX_HEIGHT)}px`;
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
    let finalMessage = message.trim();
    if (!finalMessage && activeSlashCommands.length === 0 && activeAgentMentions.length === 0) return;
    if (isSubmitDisabled) return;

    // Phase 5: pipeline detection + chip merging + slash extraction handled by
    // the shared, unit-tested buildSubmitPayload helper. Mobile defaults to
    // strict pipeline mode.
    const { finalMessage: outMessage, toolHints, agentMention, pipeline, pipelineMode } =
      buildSubmitPayload({
        message,
        activeAgentMentions,
        activeSlashCommands,
        knownAgentIds,
        knownCommandKeys,
        pipelineModeState: 'strict',
        maxSlashCommands: MAX_SLASH_COMMANDS,
      });

    onSend(outMessage, mode, { ...preferences, toolHints, agentMention, pipeline, pipelineMode });
    setMessage('');
    if (contentEditableRef.current) {
      contentEditableRef.current.innerHTML = '';
    }
    setActiveSlashCommands([]);
    setActiveAgentMentions([]);
    setMode('normal');
    setIsExpanded(false);
    setShowPrefsMenu(false);
    setSlashMenuOpen(false);
    setSlashQuery('');
    setMentionMenuOpen(false);
    setMentionQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // Menu open → Enter selects the highlighted item via the menu's
      // window-level listener; don't submit the raw partial trigger token.
      if (mentionMenuOpen || slashMenuOpen) return;
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setSlashMenuOpen(false);
      setSlashQuery('');
      setMentionMenuOpen(false);
      setMentionQuery('');
    }
  };

  const handleExpand = () => {
    setIsExpanded(true);
    onFocus?.();
    setTimeout(() => contentEditableRef.current?.focus(), 100);
  };

  const handleCollapse = () => {
    if (!message.trim()) {
      setIsExpanded(false);
      setShowPrefsMenu(false);
      onBlur?.();
    }
  };

  const handleVoiceTranscript = (text: string) => {
    const div = contentEditableRef.current;
    if (div) {
      div.focus();
      const range = document.createRange();
      range.selectNodeContents(div);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      if (message) {
        document.execCommand('insertText', false, ' ' + text);
      } else {
        document.execCommand('insertText', false, text);
      }
      setMessage(serializeToPlainText(div));
    }
    if (!isExpanded) {
      handleExpand();
    }
  };

  // Handle paste for file uploads
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items || !threadId) return;

    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
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
      return;
    }

    // Plain text paste: strip HTML formatting
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) {
      document.execCommand('insertText', false, text);
      if (contentEditableRef.current) {
        setMessage(serializeToPlainText(contentEditableRef.current));
      }
    }
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
    activeSlashCommands.length > 0,
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
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3 relative">
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

        {/* Agent mention menu */}
        {mentionMenuOpen && (
          <AgentMentionMenu
            query={mentionQuery}
            activeCategoryId={preferences.activeCategoryId}
            onSelect={(agentId) => {
              const div = contentEditableRef.current;
              if (div) {
                insertMentionSpan(div, '@', agentId, 'mention-agent');
                setMessage(serializeToPlainText(div));
              }
              setMentionMenuOpen(false);
              setMentionQuery('');
              div?.focus();
            }}
            onDismiss={() => {
              setMentionMenuOpen(false);
              setMentionQuery('');
            }}
          />
        )}

        {/* Slash command menu */}
        {slashMenuOpen && (
          <SlashCommandMenu
            query={slashQuery}
            onSelect={(commandKey) => {
              const div = contentEditableRef.current;
              if (div && activeSlashCommands.length < MAX_SLASH_COMMANDS) {
                insertMentionSpan(div, '/', commandKey, 'mention-slash');
                setMessage(serializeToPlainText(div));
                setActiveSlashCommands(prev => [...prev, commandKey]);
              }
              setSlashMenuOpen(false);
              setSlashQuery('');
              div?.focus();
            }}
            onDismiss={() => {
              setSlashMenuOpen(false);
              setSlashQuery('');
            }}
          />
        )}

        {/* ContentEditable div — replaces <textarea> for inline colored mentions */}
        <div
          ref={contentEditableRef}
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Ask a question..."
          className="chat-content-editable chat-content-editable-mobile w-full bg-transparent resize-none focus:outline-none text-gray-900 placeholder-gray-400"
          style={{ minHeight: `${LINE_HEIGHT}px`, maxHeight: `${MAX_HEIGHT}px`, lineHeight: `${LINE_HEIGHT}px` }}
          onInput={() => {
            const div = contentEditableRef.current;
            if (!div) return;
            const plainText = serializeToPlainText(div);
            setMessage(plainText);

            // Phase 5: cursor-anchored trigger detection via DOM
            const token = getCursorToken(div);
            if (token.prefix === '@') {
              setMentionQuery(token.query);
              setMentionMenuOpen(true);
              setSlashMenuOpen(false);
              setSlashQuery('');
            } else if (token.prefix === '/' && activeSlashCommands.length < MAX_SLASH_COMMANDS) {
              setSlashQuery(token.query);
              setSlashMenuOpen(true);
              setMentionMenuOpen(false);
              setMentionQuery('');
            } else {
              setSlashMenuOpen(false);
              setMentionMenuOpen(false);
              setSlashQuery('');
              setMentionQuery('');
            }
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={handleCollapse}
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

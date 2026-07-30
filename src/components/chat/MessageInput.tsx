'use client';

import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';

import { ArrowUp, Loader2, Square, Bot, Globe, Paperclip, Brain, BookOpen } from 'lucide-react';
import VoiceInput from './VoiceInput';
import PlusMenu from './PlusMenu';
import SlashCommandMenu from './SlashCommandMenu';
import AgentMentionMenu from './AgentMentionMenu';
import ModelSelector from './ModelSelector';
import InlineModeChips from './InlineModeChips';
import InlineLanguageToneChips from './InlineLanguageToneChips';
import ChipSheet, { type ActiveFeatureBadge } from './ChipSheet';

import { ChatMode } from './ModeToggle';
import { useToast } from '@/contexts/ToastContext';
import type { ChatPreferences, PipelineMode } from '@/types/stream';
import { parsePipelinePrompt } from '@/lib/pipeline-parser';
import { buildSubmitPayload } from '@/lib/message-input-parser';
import { serializeToPlainText, insertMentionSpan, getCursorToken, renderMentionsFromPlainText } from '@/lib/chat-input-dom';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useDraftPersistence } from '@/hooks/useDraftPersistence';
import { useInputState } from '@/hooks/useInputState';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { isDefaultThinkingEnabledModel } from '@/lib/llm-thinking';

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
  // Sources display admin control
  adminSourcesDisabled?: boolean;
  adminCitationTrajectoryDisabled?: boolean;
  // Model readiness — false when no valid model is available for the active route
  modelReady?: boolean;
  pendingModelId?: string | null;
  onPendingModelChange?: (modelId: string | null) => void;
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
  // Auto model selection — last picked model display name
  lastAutoPick?: string | null;
  // Share-target prefill (Phase 2.3) — seeds the composer once on mount
  // when the app is opened via the Android share sheet. Cleared after first
  // use so it does not re-apply on subsequent re-renders.
  initialDraft?: string;
}

interface CurrentModelInfo {
  id: string;
  thinkingCapable: boolean;
}

const MessageInput = memo(function MessageInput({
  onSend,
  disabled,
  threadId,
  currentUploads,
  onUploadComplete,
  onUrlSourceAdded,
  preferences,
  onPreferencesChange,
  autonomousAdminDisabled,
  adminSourcesDisabled,
  adminCitationTrajectoryDisabled,
  modelReady = true,
  pendingModelId,
  onPendingModelChange,
  onModelStatusChange,
  isStreaming = false,
  onAbort,
  onFocus,
  onBlur,
  categoryChipSlot,
  attachmentChipsSlot,
  lastAutoPick,
  initialDraft,
}: MessageInputProps) {
  const [message, setMessage] = useState('');
  // Mode defaults to normal on every page load.
  // We intentionally do NOT restore autonomous mode from localStorage,
  // because it causes unexpected autonomous executions when users
  // forget they had it enabled in a previous session.
  const [mode, setMode] = useState<ChatMode>('normal');
  const [isUploading, setIsUploading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [lineCount, setLineCount] = useState(1);
  const [chipSheetOpen, setChipSheetOpen] = useState(false);
  const [currentModelInfo, setCurrentModelInfo] = useState<CurrentModelInfo | null>(null);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const MAX_SLASH_COMMANDS = 3;
  const [activeSlashCommands, setActiveSlashCommands] = useState<string[]>([]);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [activeAgentMentions, setActiveAgentMentions] = useState<string[]>([]);
  // Phase 5: pipeline orchestration
  const [knownAgentIds, setKnownAgentIds] = useState<Set<string>>(new Set());
  const [knownCommandKeys, setKnownCommandKeys] = useState<Set<string>>(new Set());
  const [pipelineModeState, setPipelineModeState] = useState<PipelineMode>('strict');
  const lastModelIdRef = useRef<string | null>(null);
  const contentEditableRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // Toast notifications
  const { addToast } = useToast();

  // Draft persistence
  const { clearDraft, restoredEvent, dismissRestoredEvent, draftSaveError, clearDraftSaveError } = useDraftPersistence(threadId, message, setMessage);

  // Phase 2.3: seed the composer once with a shared payload (Android share
  // sheet). Declared AFTER useDraftPersistence so this effect runs after the
  // localStorage draft-restore effect on mount — otherwise a stale saved
  // draft for the 'new' thread would clobber the incoming share. The ref
  // guard ensures it applies only on the first mount that receives a draft.
  const draftAppliedRef = useRef(false);
  useEffect(() => {
    if (initialDraft && !draftAppliedRef.current) {
      draftAppliedRef.current = true;
      setMessage(initialDraft);
    }
  }, [initialDraft, setMessage]);

  // Sync contentEditable DOM when message changes from outside (draft restore,
  // initialDraft). During normal typing, onInput already keeps the DOM in sync
  // and updates message state — this effect only fires when message diverges
  // from the DOM (i.e. programmatic changes).
  useEffect(() => {
    const div = contentEditableRef.current;
    if (!div || !message) {
      if (div && !message) div.innerHTML = '';
      return;
    }
    const domText = serializeToPlainText(div);
    if (domText !== message) {
      renderMentionsFromPlainText(div, message, knownAgentIds, knownCommandKeys);
    }
  }, [message, knownAgentIds, knownCommandKeys]);

  // Phase 5: pre-fetch known agents and slash commands for pipeline validation
  // and cursor-anchored trigger detection.
  useEffect(() => {
    fetch('/api/chat/agents')
      .then((r) => r.json())
      // Lowercase ids: parsePipelinePrompt lowercases @tokens before lookup, so
      // a mixed-case admin-created id would otherwise never pipeline-match.
      .then((d) =>
        setKnownAgentIds(new Set((d.agents as Array<{ id: string }>).map((a) => a.id.toLowerCase())))
      )
      .catch(() => { /* non-critical — pipeline detection degrades gracefully */ });
    fetch('/api/chat/slash-commands')
      .then((r) => r.json())
      .then((d) =>
        setKnownCommandKeys(
          new Set((d.commands as Array<{ commandKey: string }>).map((c) => c.commandKey))
        )
      )
      .catch(() => { /* non-critical */ });
  }, []);

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
    if (currentModelInfo?.thinkingCapable && preferences.thinkingEnabled) {
      features.push({ icon: <Brain size={12} />, label: 'Thinking' });
    }
    if (preferences.targetLanguage !== 'en') {
      features.push({
        icon: <span className="text-[10px] font-bold">{preferences.targetLanguage?.toUpperCase() ?? 'EN'}</span>,
        label: preferences.targetLanguage,
      });
    }
    if (preferences.showSources) {
      features.push({ icon: <BookOpen size={12} />, label: 'Sources' });
    }
    if (currentUploads.length > 0) {
      features.push({
        icon: <Paperclip size={12} />,
        label: `${currentUploads.length} file${currentUploads.length !== 1 ? 's' : ''}`,
      });
    }
    return features;
  }, [mode, preferences.webSearchEnabled, preferences.thinkingEnabled, preferences.targetLanguage, preferences.showSources, currentUploads.length, currentModelInfo?.thinkingCapable]);


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


  // Auto-resize contentEditable div
  useEffect(() => {
    if (contentEditableRef.current) {
      const maxHeight = isMobile ? 112 : 150;
      contentEditableRef.current.style.height = 'auto';
      const scrollHeight = contentEditableRef.current.scrollHeight;
      contentEditableRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
      
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

  const handleSourcesToggle = useCallback((enabled: boolean) => {
    onPreferencesChange({ ...preferences, showSources: enabled });
  }, [preferences, onPreferencesChange]);

  const handleThinkingToggle = useCallback(() => {
    if (!currentModelInfo?.thinkingCapable) return;
    onPreferencesChange({ ...preferences, thinkingEnabled: !preferences.thinkingEnabled });
  }, [currentModelInfo?.thinkingCapable, onPreferencesChange, preferences]);

  const handleModelInfoChange = useCallback((model: { id: string; thinkingCapable?: boolean } | null, ready: boolean) => {
    const nextModel = model && ready
      ? { id: model.id, thinkingCapable: Boolean(model.thinkingCapable) }
      : null;
    setCurrentModelInfo(nextModel);

    const nextModelId = nextModel?.id ?? null;
    if (lastModelIdRef.current === nextModelId) return;
    lastModelIdRef.current = nextModelId;

    const nextThinkingEnabled = nextModel?.thinkingCapable
      ? isDefaultThinkingEnabledModel(nextModel.id)
      : false;
    if (preferences.thinkingEnabled !== nextThinkingEnabled) {
      onPreferencesChange({ ...preferences, thinkingEnabled: nextThinkingEnabled });
    }
  }, [onPreferencesChange, preferences]);

  const handleSubmit = useCallback(() => {
    if (!message.trim() || isSubmitDisabled) return;

    // Phase 5: pipeline detection + chip merging + slash extraction is handled
    // by the pure buildSubmitPayload helper (unit-tested, framework-free).
    const { finalMessage, toolHints, agentMention, pipeline, pipelineMode } =
      buildSubmitPayload({
        message,
        activeAgentMentions,
        activeSlashCommands,
        knownAgentIds,
        knownCommandKeys,
        pipelineModeState,
        maxSlashCommands: MAX_SLASH_COMMANDS,
      });

    onSend(finalMessage, mode, { ...preferences, toolHints, agentMention, pipeline, pipelineMode });
    setMessage('');
    // Clear contentEditable div
    if (contentEditableRef.current) {
      contentEditableRef.current.innerHTML = '';
    }
    setActiveSlashCommands([]);
    setActiveAgentMentions([]);
    clearDraft();
    // Reset mode to normal after sending
    setMode('normal');
  }, [
    message,
    isSubmitDisabled,
    onSend,
    mode,
    preferences,
    activeSlashCommands,
    activeAgentMentions,
    clearDraft,
    knownAgentIds,
    knownCommandKeys,
    pipelineModeState,
  ]);

  // Memoized keyboard shortcut callbacks to prevent listener re-binding
  const focusTextarea = useCallback(() => {
    contentEditableRef.current?.focus();
  }, []);

  const blurTextarea = useCallback(() => {
    contentEditableRef.current?.blur();
  }, []);

  // Keyboard shortcuts (desktop only)
  useKeyboardShortcuts({
    onFocus: focusTextarea,
    onBlur: blurTextarea,
    onSend: handleSubmit,
    onTogglePlusMenu: undefined,
    textareaRef: contentEditableRef as unknown as React.RefObject<HTMLTextAreaElement>,
    disabled: disabled || isMobile,
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // When a trigger menu is open, Enter/Tab selects the highlighted item via
      // the menu's window-level keydown listener (which calls preventDefault,
      // so no newline is inserted). Submitting here would fire before that
      // listener and send the raw partial trigger token.
      if (mentionMenuOpen || slashMenuOpen) return;
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
    const div = contentEditableRef.current;
    if (div) {
      div.focus();
      // Move cursor to end
      const range = document.createRange();
      range.selectNodeContents(div);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      // Insert text
      if (message) {
        document.execCommand('insertText', false, ' ' + text);
      } else {
        document.execCommand('insertText', false, text);
      }
      setMessage(serializeToPlainText(div));
    }
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

  // Handle paste event — files are uploaded, text is pasted as plain text only
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLDivElement>) => {
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

    // If files found, upload them (prevent default paste)
    if (files.length > 0) {
      e.preventDefault();
      for (const file of files) {
        await uploadFile(file);
      }
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
  }, [threadId, uploadFile]);

  // Unified layout for both mobile and desktop
  return (
    <div className="bg-white p-4 safe-area-bottom transition-all duration-300" data-state={inputState}>
      {/* Screen reader state announcements */}
      <span role="status" aria-live="polite" className="sr-only">
        {stateAnnouncement}
      </span>
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3 transition-all duration-300 relative">

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
          className={`chat-content-editable ${isMobile ? 'chat-content-editable-mobile' : ''}`}
          style={isMobile ? { minHeight: '56px', maxHeight: '112px' } : { minHeight: '40px', maxHeight: '40vh' }}
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
          onFocus={handleFocus}
          onBlur={handleBlur}
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
              showSources={preferences.showSources}
              onSourcesToggle={handleSourcesToggle}
              adminSourcesDisabled={adminSourcesDisabled}
              adminCitationTrajectoryDisabled={adminCitationTrajectoryDisabled}
            />
            {currentModelInfo?.thinkingCapable && (
              <button
                type="button"
                onClick={handleThinkingToggle}
                disabled={disabled || !modelReady}
                className={`p-2 rounded-lg transition-colors ${
                  preferences.thinkingEnabled
                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                } ${disabled || !modelReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={preferences.thinkingEnabled ? 'Thinking mode on' : 'Thinking mode off'}
                aria-label={preferences.thinkingEnabled ? 'Disable thinking mode' : 'Enable thinking mode'}
                aria-pressed={preferences.thinkingEnabled}
              >
                <Brain size={18} />
              </button>
            )}
            {/* Phase 5: pipeline mode toggle — visible only when a pipeline is detected */}
            {knownAgentIds.size > 0 && message.includes('@') && (() => {
              const parsed = parsePipelinePrompt(message, knownAgentIds, knownCommandKeys);
              if (parsed.steps.length < 2) return null;
              return (
                <button
                  type="button"
                  onClick={() => setPipelineModeState((s) => (s === 'strict' ? 'auto' : 'strict'))}
                  className={`p-2 rounded-lg text-xs font-medium transition-colors ${
                    pipelineModeState === 'strict'
                      ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                      : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                  }`}
                  title={
                    pipelineModeState === 'strict'
                      ? 'Strict pipeline — guaranteed order'
                      : 'Auto pipeline — LLM orchestrates'
                  }
                  aria-label={`Pipeline mode: ${pipelineModeState}`}
                >
                  {pipelineModeState === 'strict' ? '🔄 Strict' : '🤖 Auto'}
                </button>
              );
            })()}
          </div>

          {/* Center: Model selector */}
          <ModelSelector
            threadId={threadId}
            pendingModelId={pendingModelId}
            onPendingModelChange={onPendingModelChange}
            onModelStatusChange={onModelStatusChange}
            onModelInfoChange={handleModelInfoChange}
            lastAutoPick={lastAutoPick}
          />

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
});

export default MessageInput;

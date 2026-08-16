'use client';

import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';

import { ArrowUp, Loader2, Square, Bot, Globe, Paperclip, Brain, BookOpen, MessageSquareQuote } from 'lucide-react';
import VoiceInput from './VoiceInput';
import PlusMenu from './PlusMenu';
import SlashCommandMenu from './SlashCommandMenu';
import AgentMentionMenu from './AgentMentionMenu';
import ModelSelector from './ModelSelector';
import InlineModeChips from './InlineModeChips';
import InlineLanguageToneChips from './InlineLanguageToneChips';
import ChipSheet, { type ActiveFeatureBadge } from './ChipSheet';
import ArtifactContextChip from './ArtifactContextChip';

import { ChatMode } from './ModeToggle';
import { useToast } from '@/contexts/ToastContext';
import type { ChatPreferences, PipelineMode } from '@/types/stream';
import type { ArtifactComment, ThreadUploadItem } from '@/types';
import { parsePipelinePrompt } from '@/lib/pipeline-parser';
import { buildSubmitPayload } from '@/lib/message-input-parser';
import { type TriggerSpan } from '@/lib/trigger-span';
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
  onSend: (message: string, mode?: ChatMode, preferences?: ChatPreferences, options?: { artifactComments?: ArtifactComment[] }) => void;
  disabled?: boolean;
  threadId: string | null;
  currentUploads: string[];
  onUploadComplete: (result: { filename: string; item?: ThreadUploadItem }) => void;
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
  // Artifact comments attached to the pending message (Phase 2a Path A).
  artifactComments?: ArtifactComment[];
  onRemoveArtifactComment?: (commentId: string) => void;
  // Optional send-time options consumed by the parent ChatWindow.
  onSendOptions?: { artifactComments?: ArtifactComment[] };
}

interface CurrentModelInfo {
  id: string;
  thinkingCapable: boolean;
}

/** Replace a partial trigger token in the textarea with the full mention text. */
function replaceTriggerToken(
  currentValue: string,
  triggerStart: number,
  cursorPos: number,
  replacement: string
): string {
  return currentValue.slice(0, triggerStart) + replacement + currentValue.slice(cursorPos);
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
  artifactComments = [],
  onRemoveArtifactComment,
  onSendOptions,
}: MessageInputProps) {
  const [message, setMessage] = useState('');
  // Mode defaults to normal on every page load.
  // We intentionally do NOT restore autonomous mode from localStorage,
  // because it causes unexpected autonomous executions when users
  // forget they had it enabled in a previous session.
  const [mode, setMode] = useState<ChatMode>('normal');
  const [isUploading, setIsUploading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [chipSheetOpen, setChipSheetOpen] = useState(false);
  const [currentModelInfo, setCurrentModelInfo] = useState<CurrentModelInfo | null>(null);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const MAX_SLASH_COMMANDS = 3;
  const [activeSlashCommands, setActiveSlashCommands] = useState<string[]>([]);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  // Phase 5: pipeline orchestration
  const [knownAgentIds, setKnownAgentIds] = useState<Set<string>>(new Set());
  const [knownCommandKeys, setKnownCommandKeys] = useState<Set<string>>(new Set());
  const [pipelineModeState, setPipelineModeState] = useState<PipelineMode>('strict');
  const triggerSpanRef = useRef<TriggerSpan | null>(null);
  const lastModelIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        icon: <span className="text-[10px] font-bold">{preferences.targetLanguage.toUpperCase()}</span>,
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
    if (artifactComments.length > 0) {
      features.push({
        icon: <MessageSquareQuote size={12} />,
        label: `${artifactComments.length} comment${artifactComments.length !== 1 ? 's' : ''}`,
      });
    }
    return features;
  }, [mode, preferences.webSearchEnabled, preferences.thinkingEnabled, preferences.targetLanguage, preferences.showSources, currentUploads.length, currentModelInfo?.thinkingCapable, artifactComments.length]);


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


  // Auto-resize textarea. Mobile grows from one to three lines, then keeps a
  // fixed height and uses native textarea scrolling. Desktop behavior remains
  // unchanged.
  useEffect(() => {
    if (textareaRef.current) {
      const maxHeight = isMobile ? 84 : 150;
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
      textareaRef.current.style.overflowY = isMobile
        ? (scrollHeight > maxHeight ? 'auto' : 'hidden')
        : '';
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

    // Phase 5: pipeline detection — tokens are inline in the textarea text.
    // No chip re-insertion needed. buildSubmitPayload handles slash command
    // extraction from chips (if any) or raw inline tokens.
    const { finalMessage, toolHints, agentMention, pipeline, pipelineMode } =
      buildSubmitPayload({
        message,
        activeAgentMentions: [],
        activeSlashCommands,
        knownAgentIds,
        knownCommandKeys,
        pipelineModeState,
        maxSlashCommands: MAX_SLASH_COMMANDS,
      });

    onSend(finalMessage, mode, { ...preferences, toolHints, agentMention, pipeline, pipelineMode }, onSendOptions);
    setMessage('');
    setActiveSlashCommands([]);
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
    clearDraft,
    knownAgentIds,
    knownCommandKeys,
    pipelineModeState,
    onSendOptions,
  ]);

  const artifactCommentsSlot = useMemo(() => {
    if (artifactComments.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {artifactComments.map((comment, idx) => (
          <ArtifactContextChip
            key={comment.commentId}
            comment={comment}
            index={idx}
            total={artifactComments.length}
            onRemove={onRemoveArtifactComment}
          />
        ))}
      </div>
    );
  }, [artifactComments, onRemoveArtifactComment]);

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
    setMessage((prev) => prev + (prev ? ' ' : '') + text);
    textareaRef.current?.focus();
  };

  useEffect(() => () => {
    if (blurTimerRef.current !== null) {
      clearTimeout(blurTimerRef.current);
    }
  }, []);

  const handleFocus = () => {
    if (blurTimerRef.current !== null) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setIsFocused(true);
    onFocus?.();
  };

  const handleBlur = () => {
    // A category trigger is rendered only while the adaptive composer is
    // expanded. Browser event order fires textarea blur before the trigger's
    // click; collapsing synchronously therefore unmounted the trigger before
    // its click could open the dropdown. Defer the decision until focus has
    // settled, and treat the portalled category dropdown as part of the
    // composer even though it lives under document.body.
    if (blurTimerRef.current !== null) {
      clearTimeout(blurTimerRef.current);
    }
    blurTimerRef.current = setTimeout(() => {
      blurTimerRef.current = null;
      const activeElement = document.activeElement;
      const focusRemainsInComposer = activeElement instanceof Node
        && composerRef.current?.contains(activeElement);
      const focusMovedToCategoryDropdown = activeElement instanceof Element
        && activeElement.closest('[data-category-dropdown="true"]');

      if (focusRemainsInComposer || focusMovedToCategoryDropdown) return;

      setIsFocused(false);
      onBlur?.();
    }, 0);
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
        const threadUploadItem: ThreadUploadItem | undefined =
          typeof data.id === 'number' && typeof data.size === 'number'
            ? {
                id: data.id as number,
                threadId,
                filename: data.filename as string,
                fileType: data.fileType as string,
                fileSize: data.size as number,
                uploadedAt: new Date().toISOString(),
              }
            : undefined;
        onUploadComplete({ filename: data.filename as string, item: threadUploadItem });
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
    <div ref={composerRef} className="bg-white p-2 md:p-4 safe-area-bottom transition-all duration-300" data-state={inputState}>
      {/* Screen reader state announcements */}
      <span role="status" aria-live="polite" className="sr-only">
        {stateAnnouncement}
      </span>
      <div className="bg-gray-50 rounded-2xl border border-gray-200 p-2 md:p-3 transition-all duration-300 relative">

        {/* Chip slots: CategoryChip + AttachmentChipsRow + ArtifactComments (visible in EXPANDED state) */}
        {/* On mobile FOCUSED-WRITE, chips are shown in the ChipSheet instead */}
        {(categoryChipSlot || attachmentChipsSlot || artifactCommentsSlot) && inputState !== 'compact' && (
          <div className="mb-3 flex flex-wrap items-center gap-2 transition-all duration-300">
            {/* On mobile focused-write, show ChipSheet collapsed pill instead of inline chips */}
            {isMobile && inputState === 'focused-write' ? (
              <ChipSheet
                isOpen={chipSheetOpen}
                onClose={() => setChipSheetOpen(false)}
                activeFeatures={activeFeatures}
                categoryChipSlot={categoryChipSlot}
                attachmentChipsSlot={attachmentChipsSlot}
                artifactCommentsSlot={artifactCommentsSlot}
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
                {artifactCommentsSlot}
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
              const span = triggerSpanRef.current;
              const end = textareaRef.current?.selectionStart ?? message.length;
              const replacement = `@${agentId} `;
              // Replace the partial @query with the full @agentId token.
              if (span) {
                const newCursorPos = span.start + replacement.length;
                setMessage((prev) =>
                  replaceTriggerToken(prev, span.start, end, replacement)
                );
                // Restore cursor after the inserted token.
                setTimeout(() => {
                  textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
                }, 0);
              } else {
                setMessage((prev) =>
                  prev.replace(/(?:^|\s)@\S+/, ` ${replacement}`.trimStart())
                );
              }
              setMentionMenuOpen(false);
              setMentionQuery('');
              triggerSpanRef.current = null;
              textareaRef.current?.focus();
            }}
            onDismiss={() => {
              setMentionMenuOpen(false);
              setMentionQuery('');
              triggerSpanRef.current = null;
            }}
          />
        )}

        {/* Slash command menu */}
        {slashMenuOpen && (
          <SlashCommandMenu
            query={slashQuery}
            onSelect={(commandKey) => {
              const span = triggerSpanRef.current;
              const end = textareaRef.current?.selectionStart ?? message.length;
              const replacement = `/${commandKey} `;
              if (activeSlashCommands.length < MAX_SLASH_COMMANDS) {
                // Replace the partial /query with the full /commandKey token.
                if (span) {
                  const newCursorPos = span.start + replacement.length;
                  setMessage((prev) =>
                    replaceTriggerToken(prev, span.start, end, replacement)
                  );
                  setTimeout(() => {
                    textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
                  }, 0);
                } else {
                  setMessage((prev) =>
                    prev.replace(/(?:^|\s)\/\S+/, ` ${replacement}`.trimStart())
                  );
                }
                setActiveSlashCommands(prev => [...prev, commandKey]);
              }
              setSlashMenuOpen(false);
              setSlashQuery('');
              triggerSpanRef.current = null;
              textareaRef.current?.focus();
            }}
            onDismiss={() => {
              setSlashMenuOpen(false);
              setSlashQuery('');
              triggerSpanRef.current = null;
            }}
          />
        )}

        {/* Textarea - responsive sizing */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => {
            const val = e.target.value;
            const cursorPos = e.target.selectionStart ?? val.length;
            setMessage(val);

            // Phase 5: cursor-anchored trigger detection — find the @ or /
            // token immediately before the caret. This handles both position-0
            // single-chip and inline multi-@ pipeline tokens.
            // Menu opens for every @ trigger (no guard — supports multi-agent pipeline).
            const textBeforeCursor = val.slice(0, cursorPos);
            const atMatch = textBeforeCursor.match(/(?:^|\s)(@)([a-z0-9_-]*)$/);
            const slashMatch = textBeforeCursor.match(/(?:^|\s)(\/)([a-z0-9_-]*)$/);

            if (atMatch) {
              triggerSpanRef.current = { start: cursorPos - 1 - atMatch[2].length, kind: 'at' };
              setMentionQuery(atMatch[2]);
              setMentionMenuOpen(true);
              setSlashMenuOpen(false);
              setSlashQuery('');
            } else if (slashMatch && activeSlashCommands.length < MAX_SLASH_COMMANDS) {
              triggerSpanRef.current = { start: cursorPos - 1 - slashMatch[2].length, kind: 'slash' };
              setSlashQuery(slashMatch[2]);
              setSlashMenuOpen(true);
              setMentionMenuOpen(false);
              setMentionQuery('');
            } else {
              triggerSpanRef.current = null;
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
          placeholder="Ask a question..."
          disabled={isUploading}
          rows={1}
          enterKeyHint={isMobile ? 'enter' : 'send'}
          className={`w-full bg-transparent resize-none focus:outline-none text-gray-900 placeholder-gray-400 ${
            isMobile ? 'min-h-[28px] max-h-[84px] leading-7' : 'min-h-[40px] max-h-[40vh]'
          }`}
        />

        {/* Bottom row: Voice + Plus menu + Model selector + Submit */}
        <div className="flex items-center justify-between mt-1 md:mt-2">
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

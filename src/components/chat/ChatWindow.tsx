'use client';

import { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import dynamic from 'next/dynamic';
import { RefreshCw, BookOpen, ArrowDown } from 'lucide-react';
import type { Message, MessageMetadata, Thread, UserSubscription, Source, MessageVisualization, GeneratedDocumentInfo, GeneratedImageInfo, UrlSource, ChatPreferences, DiagramHint, PodcastHint, StarterPrompt } from '@/types';
import { DEFAULT_CHAT_PREFERENCES } from '@/types/stream';
import MessageBubble from './MessageBubble';
import SkeletonMessage, { CompactSkeletonMessage } from './SkeletonMessage';
import MessageInput from './MessageInput';
import type { ChatMode } from './ModeToggle';
import CategoryChip from './CategoryChip';
import AttachmentChipsRow from './AttachmentChipsRow';

import ProcessingIndicator from './ProcessingIndicator';

import { useStreamingChat } from '@/hooks/useStreamingChat';
import { useScrollHide } from '@/hooks/useScrollHide';
import { useScrollMemory } from '@/hooks/useScrollMemory';
import { useChatArtifacts } from '@/hooks/useChatArtifacts';
import { useMobileMenuOptional } from '@/contexts/MobileMenuContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import ChatSummaryBanner from './ChatSummaryBanner';
import ChatWelcome from './ChatWelcome';

// Lazy-load heavy conditional components that only render during specific streaming states
const SubagentPanel = dynamic(() => import('./SubagentPanel'), { ssr: false });
const HitlClarificationCard = dynamic(() => import('./HitlClarificationCard'), { ssr: false });
const PlanApprovalCard = dynamic(() => import('./PlanApprovalCard'), { ssr: false });
const SubagentApprovalCard = dynamic(() => import('./SubagentApprovalCard'), { ssr: false });


interface WelcomeConfig {
  title?: string;
  message?: string;
}

interface ChatWindowProps {
  activeThread?: Thread | null;
  onThreadCreated?: (thread: Thread) => void;
  userSubscriptions?: UserSubscription[];
  brandingName?: string;
  brandingSubtitle?: string;
  globalWelcome?: WelcomeConfig;
  categoryWelcome?: WelcomeConfig;
  globalStarterPrompts?: StarterPrompt[];
  // Callbacks for artifacts data
  onArtifactsChange?: (data: {
    threadId: string | null;
    uploads: string[];
    generatedDocs: GeneratedDocumentInfo[];
    generatedImages: GeneratedImageInfo[];
    generatedPodcasts: PodcastHint[];
    urlSources: UrlSource[];
  }) => void;
  // Callbacks for input focus (mobile sidebar hiding)
  onInputFocus?: () => void;
  onInputBlur?: () => void;
}

// Ref interface for external control
export interface ChatWindowRef {
  removeUpload: (filename: string) => void;
  removeUrlSource: (filename: string) => void;
}

interface ThreadSummary {
  summary: string;
  messagesSummarized: number;
  createdAt: string;
}

// Fallback UI for MessageInput when it crashes — defined outside component
// so React does not unmount/remount it on every parent render.
function InputFallback() {
  return (
    <div className="p-4 bg-gray-50 border-t border-gray-200 text-center">
      <p className="text-sm text-gray-500 mb-2">Input unavailable — please refresh the page</p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
      >
        Refresh
      </button>
    </div>
  );
}

const ChatWindow = forwardRef<ChatWindowRef, ChatWindowProps>(function ChatWindow({
  activeThread,
  onThreadCreated,
  userSubscriptions = [],
  brandingName = 'Policy Bot',
  brandingSubtitle,
  globalWelcome,
  categoryWelcome,
  globalStarterPrompts,
  onArtifactsChange,
  onInputFocus,
  onInputBlur,
}, ref) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [uploads, setUploads] = useState<string[]>([]);
  const [pendingUploads, setPendingUploads] = useState<string[]>([]);
  const [urlSources, setUrlSources] = useState<UrlSource[]>([]);
  const [pendingUrlSources, setPendingUrlSources] = useState<UrlSource[]>([]);
  const [showSummaryDetails, setShowSummaryDetails] = useState(false);
  const [summaryData, setSummaryData] = useState<ThreadSummary | null>(null);
  const [archivedMessages, setArchivedMessages] = useState<Message[]>([]);
  const [starterPrompts, setStarterPrompts] = useState<StarterPrompt[]>([]);
  const [loadingStarters, setLoadingStarters] = useState(false);
  const [fetchedCategoryWelcome, setFetchedCategoryWelcome] = useState<WelcomeConfig | null>(null);

  // Load chat preferences from localStorage on mount, with validation
  const [chatPreferences, setChatPreferencesState] = useState<ChatPreferences>(() => {
    if (typeof window === 'undefined') return DEFAULT_CHAT_PREFERENCES;
    try {
      const saved = localStorage.getItem('policybot:pref:chatSettings');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Validate and merge with defaults
        return {
          webSearchEnabled: typeof parsed.webSearchEnabled === 'boolean' ? parsed.webSearchEnabled : DEFAULT_CHAT_PREFERENCES.webSearchEnabled,
          targetLanguage: typeof parsed.targetLanguage === 'string' ? parsed.targetLanguage : DEFAULT_CHAT_PREFERENCES.targetLanguage,
          responseTone: typeof parsed.responseTone === 'string' ? parsed.responseTone : DEFAULT_CHAT_PREFERENCES.responseTone,
          showSources: typeof parsed.showSources === 'boolean' ? parsed.showSources : DEFAULT_CHAT_PREFERENCES.showSources,
          showCitationTrajectory: typeof parsed.showCitationTrajectory === 'boolean' ? parsed.showCitationTrajectory : DEFAULT_CHAT_PREFERENCES.showCitationTrajectory,
          thinkingEnabled: typeof parsed.thinkingEnabled === 'boolean' ? parsed.thinkingEnabled : DEFAULT_CHAT_PREFERENCES.thinkingEnabled,
        };
      }
    } catch {
      // Invalid JSON, fall back to defaults
    }
    return DEFAULT_CHAT_PREFERENCES;
  });

  // Persist chat preferences to localStorage on change
  const setChatPreferences = useCallback((prefs: ChatPreferences | ((prev: ChatPreferences) => ChatPreferences)) => {
    setChatPreferencesState(prev => {
      const newPrefs = typeof prefs === 'function' ? prefs(prev) : prefs;
      try {
        localStorage.setItem('policybot:pref:chatSettings', JSON.stringify(newPrefs));
      } catch {
        // localStorage may be unavailable or full
      }
      return newPrefs;
    });
  }, []);
  const [autonomousAdminDisabled, setAutonomousAdminDisabled] = useState(false);
  const [displaySettings, setDisplaySettings] = useState({ sourcesEnabled: true, citationTrajectoryEnabled: true });
  const [pendingCategoryId, setPendingCategoryId] = useState<number | null>(null);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    removeUpload: (filename: string) => {
      setUploads(prev => prev.filter(f => f !== filename));
      setPendingUploads(prev => prev.filter(f => f !== filename));
    },
    removeUrlSource: (filename: string) => {
      setUrlSources(prev => prev.filter(s => s.filename !== filename));
      setPendingUrlSources(prev => prev.filter(s => s.filename !== filename));
    },
  }), []);

  // Compute dynamic header based on subscriptions
  const getHeaderInfo = () => {
    const activeSubscriptions = userSubscriptions.filter(s => s.isActive);

    if (activeSubscriptions.length === 0) {
      return {
        title: brandingName,
        subtitle: brandingSubtitle || `Ask questions about policy documents`,
      };
    } else if (activeSubscriptions.length === 1) {
      const categoryName = activeSubscriptions[0].categoryName;
      return {
        title: `${categoryName} Assistant`,
        subtitle: brandingSubtitle || `Ask questions about ${categoryName}`,
      };
    } else {
      return {
        title: 'GEA Global Assistant',
        subtitle: brandingSubtitle || 'Ask questions about GEA Global',
      };
    }
  };

  const headerInfo = getHeaderInfo();

  // Compute welcome screen content
  const getWelcomeContent = () => {
    if (fetchedCategoryWelcome?.title || fetchedCategoryWelcome?.message) {
      return {
        title: fetchedCategoryWelcome.title || `Welcome to ${headerInfo.title}`,
        message: fetchedCategoryWelcome.message || headerInfo.subtitle,
      };
    }
    if (categoryWelcome?.title || categoryWelcome?.message) {
      return {
        title: categoryWelcome.title || `Welcome to ${headerInfo.title}`,
        message: categoryWelcome.message || headerInfo.subtitle,
      };
    }
    if (globalWelcome?.title || globalWelcome?.message) {
      return {
        title: globalWelcome.title || `Welcome to ${headerInfo.title}`,
        message: globalWelcome.message || headerInfo.subtitle,
      };
    }
    return {
      title: `Welcome to ${headerInfo.title}`,
      message: headerInfo.subtitle,
    };
  };

  const welcomeContent = getWelcomeContent();
  const [loading, setLoading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Mobile scroll-based hiding
  const { isHidden: isScrollingDown, onScroll: onScrollHide } = useScrollHide();
  const mobileMenu = useMobileMenuOptional();

  // Per-thread scroll position memory
  const { saveScroll, restoreScroll, confirmRestore } = useScrollMemory(messagesContainerRef);

  // Sync scroll state to mobile menu context
  useEffect(() => {
    mobileMenu?.setScrollingDown(isScrollingDown);
  }, [isScrollingDown, mobileMenu]);


  // Streaming chat hook
  const handleStreamComplete = useCallback((
    messageId: string,
    content: string,
    sources: Source[],
    visualizations: MessageVisualization[],
    documents: GeneratedDocumentInfo[],
    images: GeneratedImageInfo[],
    _diagrams: DiagramHint[],
    podcasts: PodcastHint[],
    metadata?: MessageMetadata,
    thinkingContent?: string
  ) => {
    const assistantMessage: Message = {
      id: messageId,
      role: 'assistant',
      content,
      sources: sources.length > 0 ? sources : undefined,
      visualizations: visualizations.length > 0 ? visualizations : undefined,
      generatedDocuments: documents.length > 0 ? documents : undefined,
      generatedImages: images.length > 0 ? images : undefined,
      generatedDiagrams: _diagrams.length > 0 ? _diagrams : undefined,
      generatedPodcasts: podcasts.length > 0 ? podcasts : undefined,
      timestamp: new Date(),
      metadata,
      thinkingContent,
    };
    setMessages(prev => {
      // Guard against race condition where loadThread already added this message
      if (prev.some(m => m.id === messageId)) return prev;
      return [...prev, assistantMessage];
    });
    setLoading(false);
  }, []);

  const handleStreamError = useCallback((code: string, message: string) => {
    setError(message);
    setLoading(false);
  }, []);

  const {
    state: streamingState,
    sendMessage: sendStreamingMessage,
    toggleProcessingDetails,
    reset: resetStreaming,
    abort: abortStreaming,
    pausePlan,
    resumePlan,
    stopPlan,
    skipTask,
    approveSubagentTool,
  } = useStreamingChat({
    onComplete: handleStreamComplete,
    onError: handleStreamError,
  });

  // Determine if we're in autonomous mode
  const isAutonomousMode = Boolean(streamingState.autonomousPlan);

  // Compute aggregated artifacts (docs, images, podcasts) from messages + streaming state
  const { generatedDocs, generatedImages, generatedPodcasts } = useChatArtifacts({
    threadId,
    messages,
    uploads,
    urlSources,
    streamingState,
    onArtifactsChange,
  });

  // Fetch autonomous mode admin setting on mount
  useEffect(() => {
    fetch('/api/settings/autonomous')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && typeof data.enabled === 'boolean') {
          setAutonomousAdminDisabled(!data.enabled);
        }
      })
      .catch(() => { /* default to enabled */ });

    // Fetch display settings (sources + citation trajectory)
    fetch('/api/settings/display')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          setDisplaySettings({
            sourcesEnabled: data.sourcesEnabled ?? true,
            citationTrajectoryEnabled: data.citationTrajectoryEnabled ?? true,
          });
        }
      })
      .catch(() => { /* default to enabled */ });
  }, []);

  // Effective display flags (admin override AND-gated with user preference)
  const effectiveShowSources = displaySettings.sourcesEnabled && chatPreferences.showSources;
  const effectiveShowCitationTrajectory = displaySettings.citationTrajectoryEnabled && chatPreferences.showCitationTrajectory;

  // Ref to track if a send is in progress (prevents race condition with activeThread change)
  const isSendingRef = useRef(false);

  const loadThread = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/threads/${id}`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages.map((m: Message) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        })));
        setUploads(data.uploads || []);

        // Task plan info is now shown via per-task progressive updates in the chat (Phase 1.4)
      }
    } catch (err) {
      console.error('Failed to load thread:', err);
    }
  }, []);

  // Load thread messages when active thread changes
  useEffect(() => {
    // CRITICAL: If a send is in progress (e.g. starter prompt on new thread),
    // do NOT reset streaming — this would abort the in-flight SSE connection.
    // The activeThread change is a side effect of createThread() calling
    // onThreadCreated() during sendMessage(), and resetting would kill the stream.
    if (isSendingRef.current) return;

    // Save scroll position of current thread before switching
    if (threadId) {
      saveScroll(threadId);
    }

    resetStreaming();

    // Reset pending uploads/sources when switching threads
    setPendingUploads([]);
    setPendingUrlSources([]);

    if (activeThread) {
      setPendingModelId(null);
      setThreadId(activeThread.id);
      loadThread(activeThread.id);
      // Restore scroll position for this thread (if saved)
      restoreScroll(activeThread.id);
      if (activeThread.isSummarized) {
        loadSummaryData(activeThread.id);
      } else {
        setSummaryData(null);
        setArchivedMessages([]);
      }
    } else {
      setPendingModelId(null);
      setThreadId(null);
      setMessages([]);
      setUploads([]);
      setSummaryData(null);
      setArchivedMessages([]);
    }
  }, [activeThread, resetStreaming, loadThread, saveScroll, restoreScroll, threadId]);

  // Recover from backgrounding on mobile: reload thread state when returning to tab
  const errorRef = useRef(error);
  errorRef.current = error;
  const streamingStateRef = useRef(streamingState);
  streamingStateRef.current = streamingState;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const currentThreadId = threadIdRef.current;
      if (!currentThreadId) return;

      const state = streamingStateRef.current;
      const hadError = errorRef.current || state.error;
      const wasStreaming = state.isStreaming;
      const seemsStuck = loadingRef.current && !state.isStreaming && !errorRef.current && !state.error;

      if (hadError || wasStreaming || seemsStuck) {
        loadThread(currentThreadId)
          .then(() => {
            setError(null);
            resetStreaming();
          })
          .catch(() => {})
          .finally(() => {
            setLoading(false);
          });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadThread, resetStreaming]);


  // Load starter prompts and category welcome for single-category threads
  useEffect(() => {
    const loadCategoryData = async () => {
      if (!activeThread || messages.length > 0) {
        setStarterPrompts([]);
        setFetchedCategoryWelcome(null);
        return;
      }

      const categories = activeThread.categories || [];
      if (categories.length !== 1) {
        setStarterPrompts([]);
        setFetchedCategoryWelcome(null);
        return;
      }

      setLoadingStarters(true);
      try {
        const response = await fetch(`/api/categories/${categories[0].id}/prompt`);
        if (response.ok) {
          const data = await response.json();
          setStarterPrompts(data.starterPrompts || []);
          if (data.welcomeTitle || data.welcomeMessage) {
            setFetchedCategoryWelcome({
              title: data.welcomeTitle || undefined,
              message: data.welcomeMessage || undefined,
            });
          } else {
            setFetchedCategoryWelcome(null);
          }
        }
      } catch (err) {
        console.error('Failed to load category data:', err);
      } finally {
        setLoadingStarters(false);
      }
    };

    loadCategoryData();
  }, [activeThread, messages.length]);

  // Clear starters when messages are sent
  useEffect(() => {
    if (messages.length > 0) {
      setStarterPrompts([]);
    }
  }, [messages.length]);

  const loadSummaryData = async (id: string) => {
    try {
      const [summaryRes, archivedRes] = await Promise.all([
        fetch(`/api/threads/${id}/summary`),
        fetch(`/api/threads/${id}/archived`),
      ]);
      if (summaryRes.ok) {
        const data = await summaryRes.json();
        if (data.hasSummary && data.summary) {
          setSummaryData({
            summary: data.summary.summary,
            messagesSummarized: data.summary.messagesSummarized,
            createdAt: data.summary.createdAt,
          });
        }
      }
      if (archivedRes.ok) {
        const data = await archivedRes.json();
        if (data.messages?.length > 0) {
          setArchivedMessages(data.messages.map((m: { id: string; role: string; content: string; sourcesJson?: string | null; createdAt: string }) => ({
            id: m.id,
            role: m.role as Message['role'],
            content: m.content,
            sources: m.sourcesJson ? JSON.parse(m.sourcesJson) : undefined,
            timestamp: new Date(m.createdAt),
          })));
        }
      }
    } catch (err) {
      console.error('Failed to load summary:', err);
    }
  };

  // Auto-scroll to bottom (only when user hasn't scrolled up)
  useEffect(() => {
    if (!isScrolledUp) {
      if (streamingState.isStreaming) {
        // Instant scroll during streaming — smooth scroll causes competing animations
        // as the scroll target keeps moving with each chunk, creating visible shake/jitter
        const container = messagesContainerRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      } else {
        // Smooth scroll for new messages (non-streaming)
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }

    // Confirm restored scroll position after messages have rendered
    if (threadId && !streamingState.isStreaming) {
      confirmRestore(threadId);
    }
  }, [messages.length, isScrolledUp, streamingState.isStreaming, threadId, confirmRestore]);

  const handleMessagesScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    setIsScrolledUp(!atBottom);
    // Also update mobile scroll-hide state
    onScrollHide(e);
  }, [onScrollHide]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsScrolledUp(false);
  }, []);

  const createThread = useCallback(async (): Promise<string | null> => {
    try {
      const body: { categoryIds?: number[]; selectedModel?: string } = {};
      if (pendingCategoryId) {
        body.categoryIds = [pendingCategoryId];
      }
      if (pendingModelId) {
        body.selectedModel = pendingModelId;
      }

      const response = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const thread = await response.json();
        setThreadId(thread.id);
        onThreadCreated?.(thread);
        return thread.id;
      }
    } catch (err) {
      console.error('Failed to create thread:', err);
    }
    return null;
  }, [onThreadCreated, pendingCategoryId, pendingModelId]);

  const sendMessage = useCallback(async (content: string, mode?: ChatMode, preferences?: ChatPreferences) => {
    setError(null);

    // Set sending flag BEFORE createThread (which may trigger onThreadCreated → activeThread change)
    isSendingRef.current = true;

    let currentThreadId = threadId;
    if (!currentThreadId) {
      currentThreadId = await createThread();
      if (!currentThreadId) {
        isSendingRef.current = false;
        setError('Failed to create conversation');
        return;
      }
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    // Use provided preferences or fall back to current state
    const prefsToUse = preferences || chatPreferences;
    try {
      await sendStreamingMessage(content, currentThreadId, mode, prefsToUse);
    } finally {
      isSendingRef.current = false;
    }

    // Clear pending uploads/sources after sending — they've been sent to the LLM
    setPendingUploads([]);
    setPendingUrlSources([]);
  }, [threadId, createThread, sendStreamingMessage, chatPreferences]);




  const retry = () => {
    setError(null);
    // Also reset streaming state if there was a streaming error
    if (streamingState.error) {
      resetStreaming();
    }
  };

  // Combined error from local state or streaming state
  const displayError = error || streamingState.error;

  const handleStarterSelect = useCallback((prompt: string) => {
    sendMessage(prompt);
  }, [sendMessage]);

  const handleRegenerate = useCallback((messageId: string) => {
    if (streamingState.isStreaming) return;
    const index = messages.findIndex(m => m.id === messageId);
    if (index < 0) return;
    const message = messages[index];
    if (message.role !== 'assistant') return;
    const precedingUserMsg = [...messages]
      .slice(0, index)
      .reverse()
      .find(m => m.role === 'user');
    if (precedingUserMsg) {
      setMessages(prev => prev.slice(0, index));
      sendMessage(precedingUserMsg.content);
    }
  }, [messages, streamingState.isStreaming, sendMessage]);

  const handleUploadComplete = useCallback((filename: string) => {
    setUploads((prev) => [...prev, filename]);
    setPendingUploads((prev) => [...prev, filename]);
  }, []);

  const handleUrlSourceAdded = useCallback((source: {
    filename: string;
    originalUrl: string;
    sourceType: 'web' | 'youtube';
    title?: string;
  }) => {
    const enriched = { ...source, extractedAt: new Date().toISOString() };
    setUrlSources((prev) => [...prev, enriched]);
    setPendingUrlSources((prev) => [...prev, enriched]);
  }, []);

  const handleRemoveUpload = useCallback((filename: string) => {
    setPendingUploads(prev => prev.filter(f => f !== filename));
    setUploads(prev => prev.filter(f => f !== filename));
  }, []);

  const handleRemoveUrlSource = useCallback((filename: string) => {
    setPendingUrlSources(prev => prev.filter(s => s.filename !== filename));
    setUrlSources(prev => prev.filter(s => s.filename !== filename));
  }, []);

  const handleAbort = useCallback(() => {
    abortStreaming();
    setLoading(false);
  }, [abortStreaming]);

  const categoryChipSlot = useMemo(() => {
    return !threadId ? (
      <CategoryChip
        subscriptions={userSubscriptions}
        selectedCategoryId={pendingCategoryId}
        onSelect={setPendingCategoryId}
        disabled={!!threadId}
        readOnly={!!activeThread}
      />
    ) : null;
  }, [threadId, userSubscriptions, pendingCategoryId, activeThread]);

  const attachmentChipsSlot = useMemo(() => (
    <AttachmentChipsRow
      uploads={uploads}
      urlSources={urlSources}
      pendingUploads={pendingUploads}
      pendingUrlSources={pendingUrlSources}
      onRemoveUpload={handleRemoveUpload}
      onRemoveUrlSource={handleRemoveUrlSource}
    />
  ), [uploads, urlSources, pendingUploads, pendingUrlSources, handleRemoveUpload, handleRemoveUrlSource]);

  return (

    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Summarization Banner */}
      <ChatSummaryBanner
        isSummarized={activeThread?.isSummarized ?? false}
        summaryData={summaryData}
        showSummaryDetails={showSummaryDetails}
        onToggleDetails={() => setShowSummaryDetails(!showSummaryDetails)}
      />

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="flex-1 min-h-0 overflow-y-auto p-4 scroll-container relative"
      >
            {messages.length === 0 && archivedMessages.length === 0 && !loading && (
              <ChatWelcome
                title={welcomeContent.title}
                message={welcomeContent.message}
                starterPrompts={starterPrompts}
                globalStarterPrompts={globalStarterPrompts || []}
                loadingStarters={loadingStarters}
                loading={loading}
                onStarterSelect={handleStarterSelect}
              />
            )}

        {/* Archived messages (from before summarization) */}
        {archivedMessages.map((message) => (
          <MessageBubble
            key={`archived-${message.id}`}
            message={message}
            threadId={threadId}
            showSources={effectiveShowSources}
            showCitationTrajectory={effectiveShowCitationTrajectory}
          />
        ))}

        {/* Summarization divider */}
        {archivedMessages.length > 0 && summaryData && (
          <div className="flex items-center gap-3 my-4 px-2">
            <div className="flex-1 border-t" style={{ borderColor: 'var(--accent-border)' }} />
            <span className="text-xs text-gray-400 whitespace-nowrap">
              Summarized for AI context
            </span>
            <div className="flex-1 border-t" style={{ borderColor: 'var(--accent-border)' }} />
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            threadId={threadId}
            showSources={effectiveShowSources}
            showCitationTrajectory={effectiveShowCitationTrajectory}
            onRegenerate={message.role === 'assistant' ? handleRegenerate : undefined}
          />
        ))}

        {displayError && (
          <div className="flex justify-center mb-4">
            <div className="bg-red-50 text-red-600 rounded-lg px-4 py-3 flex items-center gap-3">
              <span>{displayError}</span>
              <button
                onClick={retry}
                className="flex items-center gap-1 text-sm font-medium hover:underline"
              >
                <RefreshCw size={14} />
                Retry
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />

        {/* Scroll to bottom FAB */}
        {isScrolledUp && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 p-2 bg-white border border-gray-200 rounded-full shadow-md hover:shadow-lg hover:bg-gray-50 transition-all text-gray-600"
            title="Scroll to bottom"
          >
            <ArrowDown size={16} />
          </button>
        )}
      </div>

      {/* Streaming / Processing Area — isolated from message list scroll container
           to prevent SSE-triggered re-layouts from recalculating the virtualized list. */}
      <div className="px-4 shrink-0">
        {/* Processing Indicator - shows detailed status during all phases */}
        {(streamingState.isStreaming || (loading && streamingState.processingDetails.phase !== 'complete')) && (
          <ProcessingIndicator
            details={streamingState.processingDetails}
            onToggleExpand={toggleProcessingDetails}
            onAbort={handleAbort}
            isAutonomous={isAutonomousMode}
            isPaused={streamingState.isPaused}
            isStopped={streamingState.isStopped}
            onPause={pausePlan}
            onResume={resumePlan}
            onStop={stopPlan}
            autonomousPlan={streamingState.autonomousPlan}
            onSkipTask={skipTask}
          />
        )}

        {/* Subagent Panel — card-based task visualization (autonomous mode) */}
        {isAutonomousMode && streamingState.autonomousPlan && (
          <SubagentPanel
            plan={streamingState.autonomousPlan}
            totalCost={streamingState.totalCost}
            isPaused={streamingState.isPaused}
            isStopped={streamingState.isStopped}
            onSkipTask={skipTask}
          />
        )}

        {/* Subagent Tool Approval Card */}
        {streamingState.subagentApprovalEvent && (
          <SubagentApprovalCard
            taskId={streamingState.subagentApprovalEvent.taskId}
            toolName={streamingState.subagentApprovalEvent.toolName}
            args={streamingState.subagentApprovalEvent.args}
            reasoning={streamingState.subagentApprovalEvent.reasoning}
            riskLevel={streamingState.subagentApprovalEvent.riskLevel}
            onApprove={(taskId) => approveSubagentTool(taskId, streamingState.subagentApprovalEvent!.planId, 'approve')}
            onDeny={(taskId) => approveSubagentTool(taskId, streamingState.subagentApprovalEvent!.planId, 'deny')}
            onModify={(taskId, modifiedArgs) => approveSubagentTool(taskId, streamingState.subagentApprovalEvent!.planId, 'modify', modifiedArgs)}
          />
        )}

        {/* Plan Approval Card (autonomous mode HITL) */}
        {streamingState.planApprovalEvent && (
          <PlanApprovalCard
            event={streamingState.planApprovalEvent}
            onApprove={async (feedback) => {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 10000);
              try {
                const res = await fetch(`/api/autonomous/${streamingState.planApprovalEvent!.planId}/approve`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ approved: true, feedback }),
                  signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!res.ok) throw new Error(`Server error: ${res.status}`);
              } catch (e) {
                clearTimeout(timeoutId);
                console.error('[PlanApproval] Approve error:', e);
                setError(e instanceof Error && e.name === 'AbortError'
                  ? 'Approval submission timed out.'
                  : 'Failed to submit plan approval.');
              }
            }}
            onReject={async () => {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 10000);
              try {
                const res = await fetch(`/api/autonomous/${streamingState.planApprovalEvent!.planId}/approve`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ approved: false }),
                  signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!res.ok) throw new Error(`Server error: ${res.status}`);
              } catch (e) {
                clearTimeout(timeoutId);
                console.error('[PlanApproval] Reject error:', e);
                setError(e instanceof Error && e.name === 'AbortError'
                  ? 'Rejection submission timed out.'
                  : 'Failed to submit plan rejection.');
              }
            }}
          />
        )}

        {/* Pre-flight HITL Clarification Card */}
        {streamingState.preflightEvent && (
          <HitlClarificationCard
            event={streamingState.preflightEvent}
            mode="preflight"
            onSubmit={async (responses, freeTextInputs) => {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 10000);
              try {
                const res = await fetch('/api/chat/preflight', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    messageId: streamingState.preflightEvent!.messageId,
                    responses,
                    freeTextInputs,
                  }),
                  signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!res.ok) throw new Error(`Server error: ${res.status}`);
                const data = await res.json();
                if (!data.resolved) {
                  setError('Clarification session expired. Please send your message again.');
                }
              } catch (e) {
                clearTimeout(timeoutId);
                console.error('[HITL Preflight] Submit error:', e);
                setError(e instanceof Error && e.name === 'AbortError'
                  ? 'Clarification submission timed out.'
                  : 'Failed to submit clarification.');
              }
            }}
            onFallback={async (action) => {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 10000);
              try {
                const res = await fetch('/api/chat/preflight', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    messageId: streamingState.preflightEvent!.messageId,
                    fallbackAction: action,
                  }),
                  signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!res.ok) throw new Error(`Server error: ${res.status}`);
                const data = await res.json();
                if (!data.resolved) {
                  setError('Clarification session expired. Please send your message again.');
                }
              } catch (e) {
                clearTimeout(timeoutId);
                console.error('[HITL Preflight] Fallback error:', e);
                setError(e instanceof Error && e.name === 'AbortError'
                  ? 'Clarification submission timed out.'
                  : 'Failed to submit clarification.');
              }
            }}
          />
        )}

        {/* Post-response HITL Clarification Card */}
        {streamingState.hitlEvent && (
          <HitlClarificationCard
            event={streamingState.hitlEvent}
            mode="post-response"
            onSubmit={async (responses, freeTextInputs) => {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 10000);
              try {
                const res = await fetch('/api/chat/hitl', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    messageId: streamingState.hitlEvent!.messageId,
                    responses,
                    freeTextInputs,
                  }),
                  signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!res.ok) throw new Error(`Server error: ${res.status}`);
              } catch (e) {
                clearTimeout(timeoutId);
                console.error('[HITL] Submit error:', e);
                setError(e instanceof Error && e.name === 'AbortError'
                  ? 'Clarification submission timed out.'
                  : 'Failed to submit clarification.');
              }
            }}
            onFallback={async (action) => {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 10000);
              try {
                const res = await fetch('/api/chat/hitl', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    messageId: streamingState.hitlEvent!.messageId,
                    fallbackAction: action,
                  }),
                  signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!res.ok) throw new Error(`Server error: ${res.status}`);
              } catch (e) {
                clearTimeout(timeoutId);
                console.error('[HITL] Fallback error:', e);
                setError(e instanceof Error && e.name === 'AbortError'
                  ? 'Clarification submission timed out.'
                  : 'Failed to submit clarification.');
              }
            }}
          />
        )}

        {/* Skeleton placeholder — shown while loading but no streaming content yet */}
        {loading && !streamingState.isStreaming && !streamingState.currentContent && !streamingState.currentThinkingContent && (
          <SkeletonMessage />
        )}

        {/* Compact skeleton — shown while streaming has started but first tokens haven't arrived */}
        {streamingState.isStreaming && !streamingState.currentContent && !streamingState.currentThinkingContent && (
          <CompactSkeletonMessage />
        )}

        {/* Streaming Content — isolated from scroll container to prevent
            SSE-triggered layout thrashing on the message list */}
        {streamingState.isStreaming && (streamingState.currentContent || streamingState.currentThinkingContent) && (
          <MessageBubble
            message={{
              id: 'streaming',
              role: 'assistant',
              content: streamingState.currentContent,
              sources: streamingState.sources,
              visualizations: streamingState.visualizations,
              generatedDocuments: streamingState.documents,
              generatedImages: streamingState.images,
              timestamp: new Date(),
              thinkingContent: streamingState.currentThinkingContent || undefined,
            }}
            isStreaming={true}
            threadId={threadId}
            showSources={effectiveShowSources}
            showCitationTrajectory={effectiveShowCitationTrajectory}
          />
        )}
      </div>

       {/* Input (wrapped in ErrorBoundary for resilience) */}
       <ErrorBoundary moduleName="MessageInput" fallback={<InputFallback />}>
         <MessageInput
           onSend={sendMessage}
           disabled={loading}
           modelReady={modelReady}
           pendingModelId={pendingModelId}
           onPendingModelChange={setPendingModelId}
           onModelStatusChange={setModelReady}
           threadId={threadId}
           currentUploads={pendingUploads}
           onUploadComplete={handleUploadComplete}
           onUrlSourceAdded={handleUrlSourceAdded}
           preferences={chatPreferences}
           onPreferencesChange={setChatPreferences}
           autonomousAdminDisabled={autonomousAdminDisabled}
           adminSourcesDisabled={!displaySettings.sourcesEnabled}
           adminCitationTrajectoryDisabled={!displaySettings.citationTrajectoryEnabled}
           onFocus={onInputFocus}
           onBlur={onInputBlur}
           categoryChipSlot={categoryChipSlot}
           attachmentChipsSlot={attachmentChipsSlot}
         />
       </ErrorBoundary>


    </div>
  );
});

export default ChatWindow;

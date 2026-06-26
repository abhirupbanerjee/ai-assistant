'use client';

import { Fragment, useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import dynamic from 'next/dynamic';
import { RefreshCw, ArrowDown } from 'lucide-react';
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
const SubagentPanel = dynamic(() => import('./SubagentPanel'), { ssr: false, loading: () => <div className="h-24 animate-pulse bg-gray-100 rounded-lg mb-3" /> });
const HitlClarificationCard = dynamic(() => import('./HitlClarificationCard'), { ssr: false, loading: () => <div className="h-32 animate-pulse bg-gray-100 rounded-lg mb-3" /> });
const PlanApprovalCard = dynamic(() => import('./PlanApprovalCard'), { ssr: false, loading: () => <div className="h-40 animate-pulse bg-gray-100 rounded-lg mb-3" /> });
const SubagentApprovalCard = dynamic(() => import('./SubagentApprovalCard'), { ssr: false, loading: () => <div className="h-32 animate-pulse bg-gray-100 rounded-lg mb-3" /> });


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
  const [lastAutoPick, setLastAutoPick] = useState<string | null>(null);

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
  // Height of the bottom spacer that keeps the new user message pinned to the
  // top of the viewport during streaming. Collapses automatically once the
  // streaming response grows past the visible area.
  const [bottomSpacerHeight, setBottomSpacerHeight] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // Anchor placed just before the streaming content — scrolled to top on send
  const newTurnAnchorRef = useRef<HTMLDivElement>(null);
  // Ref on the .streaming-live div — measured to decide when to collapse spacer
  const streamingLiveRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  // Latch: once the user scrolls up during streaming, pause auto-scroll for the
  // rest of that turn. Reset on every new send.
  const streamScrollPausedRef = useRef(false);

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

  const handleModelSwitch = useCallback((originalModel: string, newModel: string, _reason: string, message: string) => {
    // When Auto mode picks a model, store the display name for the selector subtitle
    if (originalModel === 'auto') {
      // Extract display name from the SSE message: "Auto-selected GPT-4o (tool preference)"
      const match = message.match(/^Auto-selected\s+(.+?)\s*\(/);
      setLastAutoPick(match ? match[1] : newModel);
    }
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
    onModelSwitch: handleModelSwitch,
  });

  // Always-current streaming flag for scroll handler (avoids recreating callback)
  const isStreamingRef = useRef(streamingState.isStreaming);
  isStreamingRef.current = streamingState.isStreaming;

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

    // Reset pending uploads/sources and auto-pick when switching threads
    setPendingUploads([]);
    setPendingUrlSources([]);
    setLastAutoPick(null);

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

  // ── Anchor-to-top: pin new user message at viewport top on send ─────────
  // useLayoutEffect runs after DOM mutations but before paint, so the scroll
  // happens before the user sees the frame — eliminating the flash-to-bottom.
  useLayoutEffect(() => {
    if (!loading) return;
    const container = messagesContainerRef.current;
    const anchor = newTurnAnchorRef.current;
    if (!container || !anchor) return;
    // Manual scroll calculation avoids iOS Safari scrollIntoView quirks
    container.scrollTop = anchor.offsetTop;
  }, [loading]);

  // ── Spacer collapse: remove reserved space once response fills the screen ─
  // Measured on every streamed chunk. Once the streaming content div is tall
  // enough that a spacer is no longer needed, collapse it so there's no
  // visible gap after a short response.
  useEffect(() => {
    if (!streamingState.isStreaming || bottomSpacerHeight === 0) return;
    const streamingDiv = streamingLiveRef.current;
    const container = messagesContainerRef.current;
    if (!streamingDiv || !container) return;
    // Collapse when streaming content height exceeds 55% of container height —
    // at that point the viewport is filled and the spacer causes no benefit.
    if (streamingDiv.scrollHeight > container.clientHeight * 0.55) {
      setBottomSpacerHeight(0);
    }
  }, [streamingState.currentContent, streamingState.currentThinkingContent, streamingState.isStreaming, bottomSpacerHeight]);

  // Reset spacer when the turn completes or is aborted
  useEffect(() => {
    if (!streamingState.isStreaming && !loading) {
      setBottomSpacerHeight(0);
    }
  }, [streamingState.isStreaming, loading]);

  // Auto-scroll to bottom (only when user hasn't scrolled up).
  // Depends on streaming content chunks so the main container follows the live
  // response token-by-token — same single-container model used by Claude / ChatGPT.
  // When the spacer is still active (user message pinned at top), skip
  // bottom-follow — the anchor-to-top scroll already placed us correctly.
  useEffect(() => {
    if (!isScrolledUp) {
      if (streamingState.isStreaming) {
        // While the spacer is active, the user message is pinned — don't scroll
        if (bottomSpacerHeight > 0) return;
        // If the user manually scrolled up during this streaming turn, stay paused
        if (streamScrollPausedRef.current) return;
        // Spacer collapsed: resume normal bottom-follow with reflow guard
        const container = messagesContainerRef.current;
        if (container) {
          const distanceFromBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight;
          if (distanceFromBottom > 8) {
            container.scrollTop = container.scrollHeight;
          }
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
  }, [messages.length, isScrolledUp, streamingState.isStreaming, streamingState.currentContent, streamingState.currentThinkingContent, threadId, confirmRestore, bottomSpacerHeight]);

  const handleMessagesScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    setIsScrolledUp(!atBottom);
    // If user scrolls up while streaming, latch the pause so auto-scroll stays off
    // for the rest of this streaming turn (resets on next send).
    if (isStreamingRef.current && !atBottom) {
      streamScrollPausedRef.current = true;
    }
    // Also update mobile scroll-hide state
    onScrollHide(e);
  }, [onScrollHide]);

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
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

    // Pre-measure spacer so the auto-scroll effect sees bottomSpacerHeight > 0 on the first render
    const container = messagesContainerRef.current;
    if (container) {
      setBottomSpacerHeight(container.clientHeight);
    }
    // Reset the streaming scroll-pause latch for the new turn
    streamScrollPausedRef.current = false;

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
    const currentMessages = messagesRef.current;
    const index = currentMessages.findIndex(m => m.id === messageId);
    if (index < 0) return;
    const message = currentMessages[index];
    if (message.role !== 'assistant') return;
    const precedingUserMsg = [...currentMessages]
      .slice(0, index)
      .reverse()
      .find(m => m.role === 'user');
    if (precedingUserMsg) {
      setMessages(prev => prev.slice(0, index));
      sendMessage(precedingUserMsg.content);
    }
  }, [streamingState.isStreaming, sendMessage]);

  // Edit a user message in-place and re-run from that point.
  // Truncates the message list to just before the edited message (removing
  // the original user message and all subsequent assistant replies), then
  // sends the edited content as a new message — same pattern as handleRegenerate.
  const handleEditMessage = useCallback((messageId: string, newContent: string) => {
    if (streamingState.isStreaming) return;
    const currentMessages = messagesRef.current;
    const index = currentMessages.findIndex(m => m.id === messageId);
    if (index < 0) return;
    // Slice off the edited message and everything after it
    setMessages(prev => prev.slice(0, index));
    sendMessage(newContent);
  }, [streamingState.isStreaming, sendMessage]);

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
    // Capture partial content BEFORE aborting so it isn't lost when streaming
    // state resets. Matches Claude's behaviour: Stop keeps what was streamed.
    const partialContent = streamingState.currentContent;
    const partialThinking = streamingState.currentThinkingContent;
    const partialSources = streamingState.sources;
    const partialDocuments = streamingState.documents;
    const partialImages = streamingState.images;

    abortStreaming();
    setLoading(false);

    if (partialContent || partialThinking) {
      const stoppedMessage: Message = {
        id: `stopped-${Date.now()}`,
        role: 'assistant',
        content: partialContent || '',
        sources: partialSources.length > 0 ? partialSources : undefined,
        generatedDocuments: partialDocuments.length > 0 ? partialDocuments : undefined,
        generatedImages: partialImages.length > 0 ? partialImages : undefined,
        timestamp: new Date(),
        thinkingContent: partialThinking || undefined,
        // Tag so the bubble can optionally show a "Stopped" indicator
        metadata: { stopped: true } as Message['metadata'],
      };
      setMessages(prev => [...prev, stoppedMessage]);
    }
  }, [abortStreaming, streamingState]);

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
  }, [threadId, userSubscriptions, pendingCategoryId, activeThread?.id]);

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
        className={`flex-1 min-h-0 overflow-y-auto p-4 scroll-container relative${streamingState.isStreaming ? ' is-streaming' : ''}`}
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

        {messages.map((message, idx) => (
          <Fragment key={message.id}>
            {idx === messages.length - 1 && (loading || streamingState.isStreaming) && (
              <div ref={newTurnAnchorRef} aria-hidden="true" />
            )}
            <MessageBubble
              message={message}
              threadId={threadId}
              showSources={effectiveShowSources}
              showCitationTrajectory={effectiveShowCitationTrajectory}
              onRegenerate={message.role === 'assistant' ? handleRegenerate : undefined}
              onEdit={message.role === 'user' ? handleEditMessage : undefined}
            />
          </Fragment>
        ))}

        {/* Skeleton placeholder — shown while loading but no streaming content yet */}
        {loading && !streamingState.isStreaming && !streamingState.currentContent && !streamingState.currentThinkingContent && (
          <SkeletonMessage />
        )}

        {/* Compact skeleton — shown while streaming has started but first tokens haven't arrived */}
        {streamingState.isStreaming && !streamingState.currentContent && !streamingState.currentThinkingContent && (
          <CompactSkeletonMessage />
        )}

        {/* Streaming Content — rendered inside the same scroll container as settled messages
            so the user can scroll freely while the response grows (single-container model).
            .streaming-live overrides contain-intrinsic-size so the growing bubble
            doesn't get a fixed 200px placeholder that causes scroll-anchor micro-jitter. */}
        {streamingState.isStreaming && (streamingState.currentContent || streamingState.currentThinkingContent) && (
          <div className="streaming-live" ref={streamingLiveRef}>
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
          </div>
        )}

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

        {/* Bottom spacer — keeps the new user message pinned to the top of
            the viewport while the response streams. Height is set on send and
            collapses automatically once the streaming content fills the screen,
            then zeroed on completion. Transition smooths the collapse. */}
        {bottomSpacerHeight > 0 && (
          <div
            style={{ minHeight: bottomSpacerHeight, transition: 'min-height 0.2s ease' }}
            aria-hidden="true"
          />
        )}

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

      {/* Ephemeral processing/control strip — sits above the input bar, never scrolls.
          Contains only status indicators and approval cards, NOT the live response text.
          The live response is now rendered inside the main scroll container above
          so the user can scroll freely during streaming (single-container model). */}
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
           lastAutoPick={lastAutoPick}
         />
       </ErrorBoundary>


    </div>
  );
});

export default ChatWindow;

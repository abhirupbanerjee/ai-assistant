'use client';

import { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { MessageSquare, RefreshCw, BookOpen, ChevronDown, ChevronUp, ArrowDown } from 'lucide-react';
import type { Message, MessageMetadata, Thread, UserSubscription, Source, MessageVisualization, GeneratedDocumentInfo, GeneratedImageInfo, UrlSource, ChatPreferences, DiagramHint, PodcastHint } from '@/types';
import { DEFAULT_CHAT_PREFERENCES } from '@/types/stream';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import Spinner from '@/components/ui/Spinner';
import StarterButtons, { StarterPrompt } from './StarterButtons';
import ProcessingIndicator from './ProcessingIndicator';

import { useStreamingChat, AutonomousPlanState, AutonomousTaskState } from '@/hooks/useStreamingChat';
import HitlClarificationCard from './HitlClarificationCard';
import PlanApprovalCard from './PlanApprovalCard';
import { useScrollHide } from '@/hooks/useScrollHide';
import { useMobileMenuOptional } from '@/contexts/MobileMenuContext';

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

const ChatWindow = forwardRef<ChatWindowRef, ChatWindowProps>(function ChatWindow({
  activeThread,
  onThreadCreated,
  userSubscriptions = [],
  brandingName = 'Policy Bot',
  brandingSubtitle,
  globalWelcome,
  categoryWelcome,
  onArtifactsChange,
  onInputFocus,
  onInputBlur,
}, ref) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [uploads, setUploads] = useState<string[]>([]);
  const [urlSources, setUrlSources] = useState<UrlSource[]>([]);
  const [showSummaryDetails, setShowSummaryDetails] = useState(false);
  const [summaryData, setSummaryData] = useState<ThreadSummary | null>(null);
  const [archivedMessages, setArchivedMessages] = useState<Message[]>([]);
  const [starterPrompts, setStarterPrompts] = useState<StarterPrompt[]>([]);
  const [loadingStarters, setLoadingStarters] = useState(false);
  const [fetchedCategoryWelcome, setFetchedCategoryWelcome] = useState<WelcomeConfig | null>(null);

  const [chatPreferences, setChatPreferences] = useState<ChatPreferences>(DEFAULT_CHAT_PREFERENCES);
  const [autonomousAdminDisabled, setAutonomousAdminDisabled] = useState(false);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    removeUpload: (filename: string) => {
      setUploads(prev => prev.filter(f => f !== filename));
    },
    removeUrlSource: (filename: string) => {
      setUrlSources(prev => prev.filter(s => s.filename !== filename));
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
  } = useStreamingChat({
    onComplete: handleStreamComplete,
    onError: handleStreamError,
  });

  // Determine if we're in autonomous mode
  const isAutonomousMode = Boolean(streamingState.autonomousPlan);

  // Compute generated docs, images, and podcasts from all messages + streaming state
  const { generatedDocs, generatedImages, generatedPodcasts } = useMemo(() => {
    const docs: GeneratedDocumentInfo[] = [];
    const images: GeneratedImageInfo[] = [];
    const podcasts: PodcastHint[] = [];
    // Include artifacts from saved messages
    for (const msg of messages) {
      if (msg.generatedDocuments) docs.push(...msg.generatedDocuments);
      if (msg.generatedImages) images.push(...msg.generatedImages);
      if (msg.generatedPodcasts) podcasts.push(...msg.generatedPodcasts);
    }
    // Include real-time streaming artifacts (for sidebar updates during generation)
    if (streamingState.documents) {
      for (const doc of streamingState.documents) {
        // Avoid duplicates by checking id
        if (!docs.some(d => d.id === doc.id)) {
          docs.push(doc);
        }
      }
    }
    if (streamingState.images) {
      for (const img of streamingState.images) {
        if (!images.some(i => i.id === img.id)) {
          images.push(img);
        }
      }
    }
    if (streamingState.podcasts) {
      for (const podcast of streamingState.podcasts) {
        if (!podcasts.some(p => p.id === podcast.id)) {
          podcasts.push(podcast);
        }
      }
    }
    return { generatedDocs: docs, generatedImages: images, generatedPodcasts: podcasts };
  }, [messages, streamingState.documents, streamingState.images, streamingState.podcasts]);

  // Notify parent of artifacts changes
  useEffect(() => {
    onArtifactsChange?.({
      threadId,
      uploads,
      generatedDocs,
      generatedImages,
      generatedPodcasts,
      urlSources,
    });
  }, [threadId, uploads, generatedDocs, generatedImages, generatedPodcasts, urlSources, onArtifactsChange]);

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
  }, []);

  // Load thread messages when active thread changes
  useEffect(() => {
    resetStreaming();

    if (activeThread) {
      setThreadId(activeThread.id);
      loadThread(activeThread.id);
      if (activeThread.isSummarized) {
        loadSummaryData(activeThread.id);
      } else {
        setSummaryData(null);
        setArchivedMessages([]);
      }
    } else {
      setThreadId(null);
      setMessages([]);
      setUploads([]);
      setSummaryData(null);
      setArchivedMessages([]);
    }
  }, [activeThread, resetStreaming]);

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
  }, [messages, streamingState.currentContent, isScrolledUp, streamingState.isStreaming, streamingState.planApprovalEvent, streamingState.preflightEvent]);

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

  const loadThread = async (id: string) => {
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
  };

  const createThread = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  }, [onThreadCreated]);

  const sendMessage = useCallback(async (content: string, mode?: 'normal' | 'autonomous', preferences?: ChatPreferences) => {
    setError(null);

    let currentThreadId = threadId;
    if (!currentThreadId) {
      currentThreadId = await createThread();
      if (!currentThreadId) {
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
    await sendStreamingMessage(content, currentThreadId, mode, prefsToUse);
  }, [threadId, createThread, sendStreamingMessage, chatPreferences]);

  const handleUploadComplete = (filename: string) => {
    setUploads((prev) => [...prev, filename]);
  };

  const handleUrlSourceAdded = (source: {
    filename: string;
    originalUrl: string;
    sourceType: 'web' | 'youtube';
    title?: string;
  }) => {
    setUrlSources((prev) => [
      ...prev,
      {
        ...source,
        extractedAt: new Date().toISOString(),
      },
    ]);
  };

  const retry = () => {
    setError(null);
    // Also reset streaming state if there was a streaming error
    if (streamingState.error) {
      resetStreaming();
    }
  };

  // Combined error from local state or streaming state
  const displayError = error || streamingState.error;

  const handleStarterSelect = (prompt: string) => {
    sendMessage(prompt);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Summarization Banner */}
      {activeThread?.isSummarized && summaryData && (
        <div
          className="border-b px-6 py-3"
          style={{
            backgroundColor: 'var(--accent-lighter)',
            borderColor: 'var(--accent-border)',
          }}
        >
          <button
            onClick={() => setShowSummaryDetails(!showSummaryDetails)}
            className="w-full flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-2" style={{ color: 'var(--accent-text)' }}>
              <BookOpen size={18} />
              <span className="text-sm font-medium">
                This conversation has been summarized ({summaryData.messagesSummarized} messages compressed)
              </span>
            </div>
            {showSummaryDetails ? (
              <ChevronUp size={18} style={{ color: 'var(--accent-color)' }} />
            ) : (
              <ChevronDown size={18} style={{ color: 'var(--accent-color)' }} />
            )}
          </button>
          {showSummaryDetails && (
            <div
              className="mt-3 p-3 bg-white rounded-lg border"
              style={{ borderColor: 'var(--accent-border)' }}
            >
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{summaryData.summary}</p>
              <p className="text-xs text-gray-500 mt-2">
                Summarized on {new Date(summaryData.createdAt).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="flex-1 min-h-0 overflow-y-auto p-4 scroll-container relative"
      >
        {messages.length === 0 && archivedMessages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare className="w-12 h-12 text-gray-300 mb-4" />
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              {welcomeContent.title}
            </h2>
            <p className="text-gray-500 max-w-md mb-6">
              {starterPrompts.length > 0
                ? 'Click a quick start button below or type your own question.'
                : `${welcomeContent.message} or upload a document to check for compliance. Start by typing a question below.`
              }
            </p>

            {/* Starter Prompts */}
            {starterPrompts.length > 0 && (
              <div className="max-w-2xl w-full">
                <StarterButtons
                  starters={starterPrompts}
                  onSelect={handleStarterSelect}
                  disabled={loading || loadingStarters}
                />
              </div>
            )}
          </div>
        )}

        {/* Archived messages (from before summarization) */}
        {archivedMessages.map((message) => (
          <MessageBubble
            key={`archived-${message.id}`}
            message={message}
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

        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            onRegenerate={
              message.role === 'assistant' && !streamingState.isStreaming
                ? () => {
                    // Find the most recent user message before this assistant message
                    const precedingUserMsg = [...messages]
                      .slice(0, index)
                      .reverse()
                      .find(m => m.role === 'user');
                    if (precedingUserMsg) {
                      // Remove this assistant message and resend the user message
                      setMessages(prev => prev.slice(0, index));
                      sendMessage(precedingUserMsg.content);
                    }
                  }
                : undefined
            }
          />
        ))}

        {/* Streaming UI - Processing Indicator */}
        {streamingState.isStreaming && (
          <ProcessingIndicator
            details={streamingState.processingDetails}
            onToggleExpand={toggleProcessingDetails}
            onAbort={() => {
              abortStreaming();
              setLoading(false);
            }}
            isAutonomous={isAutonomousMode}
            isPaused={streamingState.isPaused}
            isStopped={streamingState.isStopped}
            onPause={() => pausePlan()}
            onResume={() => resumePlan()}
            onStop={() => stopPlan()}
            autonomousPlan={streamingState.autonomousPlan}
            onSkipTask={(taskId) => skipTask(taskId)}
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

        {/* Restored plan info is now shown inline via per-task progressive updates (Phase 1.4) */}

        {/* Streaming Content */}
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
          />
        )}

        {/* Legacy loading indicator */}
        {loading && !streamingState.isStreaming && (
          <div className="flex justify-start mb-4">
            <div className="bg-gray-100 rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2">
                <Spinner size="sm" />
                <span className="text-gray-600 text-sm">Thinking...</span>
              </div>
            </div>
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

        {/* Scroll to bottom FAB */}
        {isScrolledUp && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-4 float-right mr-2 p-2 bg-white border border-gray-200 rounded-full shadow-md hover:shadow-lg hover:bg-gray-50 transition-all text-gray-600"
            title="Scroll to bottom"
          >
            <ArrowDown size={16} />
          </button>
        )}
      </div>

      {/* Input */}
      <MessageInput
        onSend={sendMessage}
        disabled={loading}
        modelReady={modelReady}
        onModelStatusChange={setModelReady}
        threadId={threadId}
        currentUploads={uploads}
        onUploadComplete={handleUploadComplete}
        onUrlSourceAdded={handleUrlSourceAdded}
        preferences={chatPreferences}
        onPreferencesChange={setChatPreferences}
        autonomousAdminDisabled={autonomousAdminDisabled}
        onFocus={onInputFocus}
        onBlur={onInputBlur}
      />

    </div>
  );
});

export default ChatWindow;

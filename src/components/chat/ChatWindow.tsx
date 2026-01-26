'use client';

import { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { MessageSquare, RefreshCw, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import type { Message, Thread, UserSubscription, Source, MessageVisualization, GeneratedDocumentInfo, GeneratedImageInfo, UrlSource, ChatPreferences } from '@/types';
import { DEFAULT_CHAT_PREFERENCES } from '@/types/stream';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import Spinner from '@/components/ui/Spinner';
import StarterButtons, { StarterPrompt } from './StarterButtons';
import ProcessingIndicator from './ProcessingIndicator';
import AutonomousTaskList from './AutonomousTaskList';
import ShareModal from '@/components/sharing/ShareModal';
import { useStreamingChat, AutonomousPlanState, AutonomousTaskState } from '@/hooks/useStreamingChat';

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
  showShareModal?: boolean;
  onCloseShareModal?: () => void;
  // Callbacks for artifacts data
  onArtifactsChange?: (data: {
    threadId: string | null;
    uploads: string[];
    generatedDocs: GeneratedDocumentInfo[];
    generatedImages: GeneratedImageInfo[];
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
  showShareModal = false,
  onCloseShareModal,
  onArtifactsChange,
  onInputFocus,
  onInputBlur,
}, ref) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [uploads, setUploads] = useState<string[]>([]);
  const [urlSources, setUrlSources] = useState<UrlSource[]>([]);
  const [showSummaryDetails, setShowSummaryDetails] = useState(false);
  const [summaryData, setSummaryData] = useState<ThreadSummary | null>(null);
  const [starterPrompts, setStarterPrompts] = useState<StarterPrompt[]>([]);
  const [loadingStarters, setLoadingStarters] = useState(false);
  const [fetchedCategoryWelcome, setFetchedCategoryWelcome] = useState<WelcomeConfig | null>(null);
  const [restoredPlan, setRestoredPlan] = useState<AutonomousPlanState | null>(null);
  const [chatPreferences, setChatPreferences] = useState<ChatPreferences>(DEFAULT_CHAT_PREFERENCES);

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
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);


  // Streaming chat hook
  const handleStreamComplete = useCallback((
    messageId: string,
    content: string,
    sources: Source[],
    visualizations: MessageVisualization[],
    documents: GeneratedDocumentInfo[],
    images: GeneratedImageInfo[]
  ) => {
    const assistantMessage: Message = {
      id: messageId,
      role: 'assistant',
      content,
      sources: sources.length > 0 ? sources : undefined,
      visualizations: visualizations.length > 0 ? visualizations : undefined,
      generatedDocuments: documents.length > 0 ? documents : undefined,
      generatedImages: images.length > 0 ? images : undefined,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, assistantMessage]);
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

  // Compute generated docs and images from all messages + streaming state
  const { generatedDocs, generatedImages } = useMemo(() => {
    const docs: GeneratedDocumentInfo[] = [];
    const images: GeneratedImageInfo[] = [];
    // Include artifacts from saved messages
    for (const msg of messages) {
      if (msg.generatedDocuments) docs.push(...msg.generatedDocuments);
      if (msg.generatedImages) images.push(...msg.generatedImages);
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
    return { generatedDocs: docs, generatedImages: images };
  }, [messages, streamingState.documents, streamingState.images]);

  // Notify parent of artifacts changes
  useEffect(() => {
    onArtifactsChange?.({
      threadId,
      uploads,
      generatedDocs,
      generatedImages,
      urlSources,
    });
  }, [threadId, uploads, generatedDocs, generatedImages, urlSources, onArtifactsChange]);

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
      }
    } else {
      setThreadId(null);
      setMessages([]);
      setUploads([]);
      setSummaryData(null);
      setRestoredPlan(null);
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
      const response = await fetch(`/api/threads/${id}/summary`);
      if (response.ok) {
        const data = await response.json();
        if (data.hasSummary && data.summary) {
          setSummaryData({
            summary: data.summary.summary,
            messagesSummarized: data.summary.messagesSummarized,
            createdAt: data.summary.createdAt,
          });
        }
      }
    } catch (err) {
      console.error('Failed to load summary:', err);
    }
  };

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingState.currentContent]);

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

        // Restore task plan if available (from autonomous mode)
        if (data.taskPlan) {
          const plan = data.taskPlan;
          // Map DB task status to UI status
          const mapStatus = (s: string): AutonomousTaskState['status'] => {
            if (s === 'complete' || s === 'done') return 'done';
            if (s === 'in_progress' || s === 'running') return 'running';
            if (s === 'failed') return 'error';
            if (s === 'skipped') return 'skipped';
            if (s === 'needs_review') return 'needs_review';
            return 'pending';
          };

          const tasks: AutonomousTaskState[] = plan.tasks.map((t: any) => ({
            id: t.id,
            description: t.description,
            type: t.type || 'analyze',
            status: mapStatus(t.status),
            confidence: t.confidence_score,
            result: t.result,
            checkerNotes: t.review_notes,
          }));

          // Calculate stats
          const completedTasks = tasks.filter(t => t.status === 'done').length;
          const failedTasks = tasks.filter(t => t.status === 'error').length;
          const skippedTasks = tasks.filter(t => t.status === 'skipped').length;
          const needsReviewTasks = tasks.filter(t => t.status === 'needs_review').length;
          const confidences = tasks.filter(t => t.confidence !== undefined).map(t => t.confidence!);
          const avgConfidence = confidences.length > 0
            ? confidences.reduce((a, b) => a + b, 0) / confidences.length
            : 0;

          setRestoredPlan({
            planId: plan.id,
            title: plan.title,
            tasks,
            stats: {
              total_tasks: tasks.length,
              completed_tasks: completedTasks,
              failed_tasks: failedTasks,
              skipped_tasks: skippedTasks,
              needs_review_tasks: needsReviewTasks,
              average_confidence: avgConfidence,
            },
          });
        } else {
          setRestoredPlan(null);
        }
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
      <div className="flex-1 min-h-0 overflow-y-auto p-4 scroll-container">
        {messages.length === 0 && !loading && (
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

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
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
          />
        )}

        {/* Autonomous Task List - Show streaming plan or restored plan */}
        {streamingState.autonomousPlan ? (
          <div className="mb-4">
            <AutonomousTaskList
              plan={streamingState.autonomousPlan}
              toolsExecuted={streamingState.processingDetails.toolsExecuted}
              isPaused={streamingState.isPaused}
              isStopped={streamingState.isStopped}
              onSkipTask={(taskId) => skipTask(taskId)}
            />
          </div>
        ) : restoredPlan ? (
          <div className="mb-4">
            <AutonomousTaskList
              plan={restoredPlan}
              isExpanded={false}
            />
          </div>
        ) : null}

        {/* Streaming Content */}
        {streamingState.isStreaming && streamingState.currentContent && (
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
      </div>

      {/* Input */}
      <MessageInput
        onSend={sendMessage}
        disabled={loading}
        threadId={threadId}
        currentUploads={uploads}
        onUploadComplete={handleUploadComplete}
        onUrlSourceAdded={handleUrlSourceAdded}
        preferences={chatPreferences}
        onPreferencesChange={setChatPreferences}
        onFocus={onInputFocus}
        onBlur={onInputBlur}
      />

      {/* Share Modal */}
      {activeThread && (
        <ShareModal
          isOpen={showShareModal}
          onClose={() => onCloseShareModal?.()}
          threadId={activeThread.id}
          threadTitle={activeThread.title}
        />
      )}
    </div>
  );
});

export default ChatWindow;

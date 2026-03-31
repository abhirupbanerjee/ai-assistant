'use client';

/**
 * Workspace Chat
 *
 * Main 2-column layout for standalone workspace mode.
 * Combines thread sidebar with chat interface.
 */

import { useState, useEffect, useCallback } from 'react';
import type { WorkspaceThread } from '@/types/workspace';
import type { Source, MessageMetadata } from '@/types';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceThreadSidebar } from './WorkspaceThreadSidebar';
import { WorkspaceChatInterface, type WorkspaceChatMessage } from './WorkspaceChatInterface';
import { useWorkspaceChat } from './useWorkspaceChat';

interface WorkspaceConfig {
  primaryColor: string;
  logoUrl: string | null;
  chatTitle: string | null;
  greetingMessage: string;
  suggestedPrompts: string[] | null;
  voiceEnabled: boolean;
  fileUploadEnabled: boolean;
  maxFileSizeMb: number;
}

interface WorkspaceChatProps {
  workspaceSlug: string;
  workspaceName: string;
  config: WorkspaceConfig;
  initialThreadId?: string;
}

export function WorkspaceChat({
  workspaceSlug,
  workspaceName,
  config,
  initialThreadId,
}: WorkspaceChatProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [threads, setThreads] = useState<WorkspaceThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThreadId || null);
  const [messages, setMessages] = useState<WorkspaceChatMessage[]>([]);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [user, setUser] = useState<{ id: string; email: string; name: string } | null>(null);

  // Initialize session
  useEffect(() => {
    async function initSession() {
      try {
        const response = await fetch(`/api/w/${workspaceSlug}/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to initialize session');
        }

        const data = await response.json();
        setSessionId(data.sessionId);

        // Capture user info if authenticated
        if (data.user) {
          setUser(data.user);
        }

        // Use activeThreadId from init response if available and not already set
        if (data.activeThreadId && !initialThreadId) {
          setActiveThreadId(data.activeThreadId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize');
      }
    }

    initSession();
  }, [workspaceSlug, initialThreadId]);

  // Load threads when session is ready
  useEffect(() => {
    if (!sessionId) return;

    const currentSessionId = sessionId;

    async function loadThreads() {
      setIsLoadingThreads(true);
      try {
        const response = await fetch(`/api/w/${workspaceSlug}/threads`, {
          headers: {
            'X-Session-Id': currentSessionId,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to load threads');
        }

        const data = await response.json();
        setThreads(data.threads || []);

        // If no active thread and threads exist, select the first one
        if (!activeThreadId && data.threads?.length > 0) {
          setActiveThreadId(data.threads[0].id);
        }
      } catch (err) {
        console.error('Failed to load threads:', err);
      } finally {
        setIsLoadingThreads(false);
      }
    }

    loadThreads();
  }, [sessionId, workspaceSlug, activeThreadId]);

  // Load messages when active thread changes
  useEffect(() => {
    if (!sessionId || !activeThreadId) {
      setMessages([]);
      return;
    }

    const currentSessionId = sessionId;
    const currentThreadId = activeThreadId;

    async function loadMessages() {
      setIsLoadingMessages(true);
      try {
        const response = await fetch(`/api/w/${workspaceSlug}/threads/${currentThreadId}`, {
          headers: {
            'X-Session-Id': currentSessionId,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to load messages');
        }

        const data = await response.json();
        // API returns { thread: { ...thread, messages: [...] } }
        const threadMessages = data.thread?.messages || [];
        const loadedMessages: WorkspaceChatMessage[] = threadMessages.map((m: {
          id: string;
          role: 'user' | 'assistant';
          content: string;
          created_at: string;
          sources_json?: string;
          model?: string;
          tokens_used?: number;
          latency_ms?: number;
        }) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.created_at),
          sources: m.sources_json ? JSON.parse(m.sources_json) : undefined,
          metadata: (m.model || m.tokens_used) ? {
            model: m.model || undefined,
            completionTokens: m.tokens_used || undefined,
            totalMs: m.latency_ms || undefined,
          } : undefined,
        }));
        setMessages(loadedMessages);
      } catch (err) {
        console.error('Failed to load messages:', err);
      } finally {
        setIsLoadingMessages(false);
      }
    }

    loadMessages();
  }, [sessionId, activeThreadId, workspaceSlug]);

  // Streaming chat hook
  const {
    state: chatState,
    sendMessage: sendStreamingMessage,
  } = useWorkspaceChat({
    workspaceSlug,
    sessionId: sessionId || '',
    threadId: activeThreadId || undefined,
    onComplete: (_messageId: string, content: string, sources: Source[], metadata?: MessageMetadata) => {
      // Add the completed assistant message
      const assistantMessage: WorkspaceChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content,
        timestamp: new Date(),
        sources,
        metadata,
      };
      setMessages(prev => [...prev, assistantMessage]);
    },
    onError: (errorMsg: string) => {
      setError(errorMsg);
    },
  });

  const isStreaming = chatState.isStreaming;
  const streamingContent = chatState.currentContent;
  const streamingSources = chatState.sources;

  // Handle sending a message
  const handleSendMessage = useCallback(async (content: string, attachments?: string[]) => {
    if (!sessionId) return;

    setError(null);

    // Create thread if needed
    let threadId = activeThreadId;
    if (!threadId) {
      try {
        const titleContent = content || (attachments?.length ? 'File attachment' : 'New chat');
        const response = await fetch(`/api/w/${workspaceSlug}/threads`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': sessionId,
          },
          body: JSON.stringify({
            title: titleContent.slice(0, 50) + (titleContent.length > 50 ? '...' : ''),
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to create thread');
        }

        const data = await response.json();
        threadId = data.thread.id;
        setActiveThreadId(threadId);
        setThreads(prev => [data.thread, ...prev]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create thread');
        return;
      }
    }

    // Add user message to UI
    const displayContent = attachments?.length
      ? content + (content ? '\n' : '') + `[${attachments.length} file(s) attached]`
      : content;
    const userMessage: WorkspaceChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: displayContent,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    // Send to streaming endpoint with attachments
    sendStreamingMessage(content, threadId || undefined, attachments);
  }, [sessionId, activeThreadId, workspaceSlug, sendStreamingMessage]);

  // Handle creating a new thread
  const handleNewThread = useCallback(() => {
    setActiveThreadId(null);
    setMessages([]);
  }, []);

  // Handle selecting a thread
  const handleSelectThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
  }, []);

  // Handle renaming a thread
  const handleRenameThread = useCallback(async (threadId: string, newTitle: string) => {
    if (!sessionId) return;

    try {
      const response = await fetch(`/api/w/${workspaceSlug}/threads/${threadId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId,
        },
        body: JSON.stringify({ title: newTitle }),
      });

      if (!response.ok) {
        throw new Error('Failed to rename thread');
      }

      setThreads(prev =>
        prev.map(t => (t.id === threadId ? { ...t, title: newTitle } : t))
      );
    } catch (err) {
      console.error('Failed to rename thread:', err);
    }
  }, [sessionId, workspaceSlug]);

  // Handle deleting a thread
  const handleDeleteThread = useCallback(async (threadId: string) => {
    if (!sessionId) return;

    try {
      const response = await fetch(`/api/w/${workspaceSlug}/threads/${threadId}`, {
        method: 'DELETE',
        headers: {
          'X-Session-Id': sessionId,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete thread');
      }

      setThreads(prev => prev.filter(t => t.id !== threadId));

      // If we deleted the active thread, clear it
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to delete thread:', err);
    }
  }, [sessionId, activeThreadId, workspaceSlug]);

  // Handle archiving a thread
  const handleArchiveThread = useCallback(async (threadId: string) => {
    if (!sessionId) return;

    try {
      const response = await fetch(`/api/w/${workspaceSlug}/threads/${threadId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId,
        },
        body: JSON.stringify({ action: 'archive' }),
      });

      if (!response.ok) {
        throw new Error('Failed to archive thread');
      }

      setThreads(prev => prev.filter(t => t.id !== threadId));

      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to archive thread:', err);
    }
  }, [sessionId, activeThreadId, workspaceSlug]);

  // Handle retry
  const handleRetry = useCallback(() => {
    setError(null);
    // Re-send the last user message if there is one
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMessage) {
      // Remove the last user message from the list
      setMessages(prev => prev.filter(m => m.id !== lastUserMessage.id));
      // Re-send it
      handleSendMessage(lastUserMessage.content);
    }
  }, [messages, handleSendMessage]);

  // Toggle sidebar
  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => !prev);
  }, []);

  if (!sessionId && !error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: config.primaryColor, borderTopColor: 'transparent' }}
          />
          <p className="text-gray-600">Initializing...</p>
        </div>
      </div>
    );
  }

  if (error && !sessionId) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center p-6 max-w-md">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      <WorkspaceHeader
        logoUrl={config.logoUrl}
        title={config.chatTitle || workspaceName}
        primaryColor={config.primaryColor}
        showMenuButton={true}
        onMenuClick={toggleSidebar}
        user={user}
        onLogout={() => {
          // Redirect to logout then back to this workspace
          window.location.href = `/api/auth/signout?callbackUrl=/${workspaceSlug}`;
        }}
        onLogin={() => {
          // Redirect to login then back to this workspace
          window.location.href = `/api/auth/signin?callbackUrl=/${workspaceSlug}`;
        }}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Thread sidebar */}
        <div
          className={`${
            isSidebarOpen ? 'w-64' : 'w-0'
          } transition-all duration-300 overflow-hidden border-r border-gray-200 bg-gray-50`}
        >
          <WorkspaceThreadSidebar
            threads={threads}
            activeThreadId={activeThreadId}
            isLoading={isLoadingThreads}
            primaryColor={config.primaryColor}
            workspaceSlug={workspaceSlug}
            sessionId={sessionId || ''}
            onSelectThread={handleSelectThread}
            onNewThread={handleNewThread}
            onRenameThread={handleRenameThread}
            onDeleteThread={handleDeleteThread}
            onArchiveThread={handleArchiveThread}
          />
        </div>

        {/* Chat interface */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {isLoadingMessages ? (
            <div className="flex items-center justify-center flex-1">
              <div
                className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: config.primaryColor, borderTopColor: 'transparent' }}
              />
            </div>
          ) : (
            <WorkspaceChatInterface
              messages={messages}
              isStreaming={isStreaming}
              streamingContent={streamingContent}
              streamingSources={streamingSources}
              error={error}
              greetingMessage={config.greetingMessage}
              suggestedPrompts={config.suggestedPrompts}
              primaryColor={config.primaryColor}
              disabled={!sessionId}
              voiceEnabled={config.voiceEnabled}
              fileUploadEnabled={config.fileUploadEnabled}
              maxFileSizeMb={config.maxFileSizeMb}
              workspaceSlug={workspaceSlug}
              sessionId={sessionId}
              onSendMessage={handleSendMessage}
              onRetry={handleRetry}
            />
          )}
        </div>
      </div>
    </div>
  );
}

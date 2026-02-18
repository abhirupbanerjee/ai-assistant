/**
 * Embed Chat Hook
 *
 * Manages chat state and streaming for the embed widget.
 */

import { useState, useCallback, useRef } from 'react';
import type { EmbedMessage, EmbedConfig, EmbedSource, EmbedRateLimit } from '../types';

interface UseEmbedChatOptions {
  workspaceSlug: string;
  apiBaseUrl: string;
  onError?: (error: string) => void;
}

interface UseEmbedChatReturn {
  messages: EmbedMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  config: EmbedConfig | null;
  rateLimit: EmbedRateLimit | null;
  sessionId: string | null;
  error: string | null;
  initialize: () => Promise<boolean>;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

export function useEmbedChat({
  workspaceSlug,
  apiBaseUrl,
  onError,
}: UseEmbedChatOptions): UseEmbedChatReturn {
  const [messages, setMessages] = useState<EmbedMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [config, setConfig] = useState<EmbedConfig | null>(null);
  const [rateLimit, setRateLimit] = useState<EmbedRateLimit | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const initialize = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/w/${workspaceSlug}/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          visitorId: getVisitorId(),
          referrerUrl: window.location.href,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to initialize workspace');
      }

      const data = await response.json();

      setSessionId(data.sessionId);
      setConfig({
        workspaceId: data.workspaceId,
        sessionId: data.sessionId,
        primaryColor: data.config.primary_color,
        logoUrl: data.config.logo_url,
        chatTitle: data.config.chat_title,
        greetingMessage: data.config.greeting_message,
        suggestedPrompts: data.config.suggested_prompts,
        footerText: data.config.footer_text,
        voiceEnabled: data.config.voice_enabled,
        fileUploadEnabled: data.config.file_upload_enabled,
        maxFileSizeMb: data.config.max_file_size_mb,
      });

      if (data.rateLimit) {
        setRateLimit({
          remaining: data.rateLimit.remaining,
          dailyUsed: data.rateLimit.daily_used,
          dailyLimit: data.rateLimit.daily_limit,
          sessionLimit: data.rateLimit.session_limit,
          resetAt: data.rateLimit.resetAt,
        });
      }

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to initialize';
      setError(errorMessage);
      onError?.(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [workspaceSlug, apiBaseUrl, onError]);

  const sendMessage = useCallback(async (content: string): Promise<void> => {
    if (!sessionId || isStreaming) return;

    // Add user message
    const userMessage: EmbedMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    // Add placeholder for assistant message
    const assistantMessageId = generateId();
    const assistantMessage: EmbedMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };
    setMessages(prev => [...prev, assistantMessage]);

    setIsStreaming(true);
    setError(null);

    // Abort any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`${apiBaseUrl}/api/w/${workspaceSlug}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: content,
          sessionId,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to send message');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';
      let sources: EmbedSource[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);

            switch (event.type) {
              case 'chunk':
                accumulatedContent += event.content;
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantMessageId
                      ? { ...m, content: accumulatedContent }
                      : m
                  )
                );
                break;

              case 'sources':
                sources = event.data.map((s: { documentName: string; pageNumber: number; chunkText: string; score: number }) => ({
                  documentName: s.documentName,
                  pageNumber: s.pageNumber,
                  chunkText: s.chunkText,
                  score: s.score,
                }));
                break;

              case 'done':
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantMessageId
                      ? { ...m, isStreaming: false, sources }
                      : m
                  )
                );
                break;

              case 'error':
                throw new Error(event.message);
            }
          } catch (parseError) {
            // Ignore parse errors for incomplete events
            if (parseError instanceof SyntaxError) continue;
            throw parseError;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;

      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMessage);
      onError?.(errorMessage);

      // Remove the placeholder assistant message on error
      setMessages(prev => prev.filter(m => m.id !== assistantMessageId));
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [sessionId, isStreaming, workspaceSlug, apiBaseUrl, onError]);

  const clearMessages = useCallback(() => {
    // Abort any ongoing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setMessages([]);
    setIsStreaming(false);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    isStreaming,
    config,
    rateLimit,
    sessionId,
    error,
    initialize,
    sendMessage,
    clearMessages,
  };
}

// Helper functions
function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function getVisitorId(): string {
  const key = 'embed_visitor_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = generateId() + generateId();
    localStorage.setItem(key, id);
  }
  return id;
}

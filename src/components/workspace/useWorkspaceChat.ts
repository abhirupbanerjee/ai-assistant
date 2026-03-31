/**
 * Workspace Chat Hook
 *
 * React hook for workspace streaming chat.
 * Handles both embed and standalone modes.
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import type { StreamEvent, StreamPhase, Source, MessageVisualization, GeneratedDocumentInfo, GeneratedImageInfo, MessageMetadata } from '@/types';

export interface WorkspaceMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: Source[];
  isStreaming?: boolean;
  metadata?: MessageMetadata;
}

export interface WorkspaceStreamingState {
  isStreaming: boolean;
  phase: StreamPhase | null;
  currentContent: string;
  sources: Source[];
  visualizations: MessageVisualization[];
  documents: GeneratedDocumentInfo[];
  images: GeneratedImageInfo[];
  error: string | null;
}

export interface UseWorkspaceChatOptions {
  workspaceSlug: string;
  sessionId: string;
  threadId?: string;
  onComplete?: (messageId: string, content: string, sources: Source[], metadata?: MessageMetadata) => void;
  onError?: (message: string) => void;
}

export interface UseWorkspaceChatReturn {
  state: WorkspaceStreamingState;
  sendMessage: (message: string, overrideThreadId?: string, attachments?: string[]) => Promise<void>;
  abort: () => void;
  reset: () => void;
}

const initialState: WorkspaceStreamingState = {
  isStreaming: false,
  phase: null,
  currentContent: '',
  sources: [],
  visualizations: [],
  documents: [],
  images: [],
  error: null,
};

export function useWorkspaceChat({
  workspaceSlug,
  sessionId,
  threadId,
  onComplete,
  onError,
}: UseWorkspaceChatOptions): UseWorkspaceChatReturn {
  const [state, setState] = useState<WorkspaceStreamingState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const contentBufferRef = useRef<string>('');
  const accumulatedContentRef = useRef<string>(''); // Track total accumulated content
  const rafRef = useRef<number | null>(null);

  const flushBuffer = useCallback(() => {
    if (contentBufferRef.current) {
      const newContent = contentBufferRef.current;
      accumulatedContentRef.current += newContent; // Track total content
      setState(prev => ({
        ...prev,
        currentContent: prev.currentContent + newContent,
      }));
      contentBufferRef.current = '';
    }
    rafRef.current = null;
  }, []);

  const sendMessage = useCallback(async (message: string, overrideThreadId?: string, attachments?: string[]) => {
    // Abort any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    contentBufferRef.current = '';
    accumulatedContentRef.current = ''; // Reset accumulated content

    setState({
      isStreaming: true,
      phase: 'init',
      currentContent: '',
      sources: [],
      visualizations: [],
      documents: [],
      images: [],
      error: null,
    });

    let accumulatedSources: Source[] = [];
    let messageId = '';
    let completedMetadata: MessageMetadata | undefined;

    try {
      const response = await fetch(`/api/w/${workspaceSlug}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          sessionId,
          threadId: overrideThreadId || threadId,
          attachments,
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
            const event: StreamEvent = JSON.parse(data);

            switch (event.type) {
              case 'status':
                setState(prev => ({ ...prev, phase: event.phase }));
                break;

              case 'chunk':
                contentBufferRef.current += event.content;
                if (!rafRef.current) {
                  rafRef.current = requestAnimationFrame(flushBuffer);
                }
                break;

              case 'sources':
                accumulatedSources = event.data;
                setState(prev => ({ ...prev, sources: event.data }));
                break;

              case 'artifact':
                // Handle artifacts for standalone mode (full feature support)
                if (event.subtype === 'visualization') {
                  setState(prev => ({
                    ...prev,
                    visualizations: [...prev.visualizations, event.data as MessageVisualization],
                  }));
                } else if (event.subtype === 'document') {
                  const doc = event.data as GeneratedDocumentInfo;
                  setState(prev => ({
                    ...prev,
                    documents: [...prev.documents, doc],
                  }));
                  // Also append document link to content for inline display
                  const fileIcon = doc.fileType === 'docx' ? '📄' : doc.fileType === 'pdf' ? '📕' : '📝';
                  contentBufferRef.current += `\n\n${fileIcon} **Generated Document:** [${doc.filename}](${doc.downloadUrl}) (${doc.fileSizeFormatted})`;
                  if (!rafRef.current) {
                    rafRef.current = requestAnimationFrame(flushBuffer);
                  }
                } else if (event.subtype === 'image') {
                  const img = event.data as GeneratedImageInfo;
                  setState(prev => ({
                    ...prev,
                    images: [...prev.images, img],
                  }));
                  // Also append image to content for inline display
                  contentBufferRef.current += `\n\n![${img.alt || 'Generated image'}](${img.url})`;
                  if (!rafRef.current) {
                    rafRef.current = requestAnimationFrame(flushBuffer);
                  }
                }
                break;

              case 'done':
                messageId = event.messageId;
                completedMetadata = (event.model || event.totalMs || event.completionTokens)
                  ? {
                      model: event.model,
                      totalMs: event.totalMs,
                      llmMs: event.llmMs,
                      ragMs: event.ragMs,
                      completionTokens: event.completionTokens,
                      tokensEstimated: event.tokensEstimated,
                    }
                  : undefined;
                // Flush any remaining content immediately (not via RAF)
                if (contentBufferRef.current) {
                  const finalContent = contentBufferRef.current;
                  accumulatedContentRef.current += finalContent;
                  contentBufferRef.current = '';
                  setState(prev => ({
                    ...prev,
                    currentContent: prev.currentContent + finalContent,
                    isStreaming: false,
                    phase: 'complete',
                  }));
                } else {
                  setState(prev => ({
                    ...prev,
                    isStreaming: false,
                    phase: 'complete',
                  }));
                }
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

      // Call onComplete callback with accumulated content from ref (avoids stale closure)
      if (onComplete && messageId) {
        onComplete(messageId, accumulatedContentRef.current, accumulatedSources, completedMetadata);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        setState(prev => ({ ...prev, isStreaming: false }));
        return;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({
        ...prev,
        isStreaming: false,
        error: errorMessage,
      }));
      onError?.(errorMessage);
    } finally {
      abortControllerRef.current = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
  }, [workspaceSlug, sessionId, threadId, onComplete, onError, flushBuffer]);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setState(prev => ({ ...prev, isStreaming: false }));
  }, []);

  const reset = useCallback(() => {
    abort();
    contentBufferRef.current = '';
    accumulatedContentRef.current = '';
    setState(initialState);
  }, [abort]);

  return {
    state,
    sendMessage,
    abort,
    reset,
  };
}

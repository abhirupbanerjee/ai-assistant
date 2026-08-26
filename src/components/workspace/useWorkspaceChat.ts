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

// If no new content arrives within this window after the last chunk and no
// `done` event has been received, finalize optimistically so the input never
// stays stuck in a "streaming" state.
const STALL_TIMEOUT_MS = 2500;

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
  const completedRef = useRef(false);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  // Finalize the turn: flush any buffered content, stop the streaming state,
  // and surface the completed message to the parent via onComplete.
  const finalizeComplete = useCallback((msgId: string, sources: Source[], metadata?: MessageMetadata) => {
    if (completedRef.current) return;
    completedRef.current = true;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (contentBufferRef.current) {
      accumulatedContentRef.current += contentBufferRef.current;
      contentBufferRef.current = '';
    }
    clearStallTimer();
    setState(prev => ({
      ...prev,
      currentContent: accumulatedContentRef.current,
      isStreaming: false,
      phase: 'complete',
    }));
    if (onComplete) {
      onComplete(msgId, accumulatedContentRef.current, sources, metadata);
    }
  }, [onComplete, clearStallTimer]);

  const sendMessage = useCallback(async (message: string, overrideThreadId?: string, attachments?: string[]) => {
    // Abort any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    contentBufferRef.current = '';
    accumulatedContentRef.current = ''; // Reset accumulated content
    completedRef.current = false;
    clearStallTimer();

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
                // Re-arm the stall watchdog: if no further content or `done`
                // arrives shortly, finalize so the UI is never left stuck.
                clearStallTimer();
                stallTimerRef.current = setTimeout(() => {
                  finalizeComplete(`stall-${Date.now()}`, accumulatedSources, undefined);
                }, STALL_TIMEOUT_MS);
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
                finalizeComplete(event.messageId, accumulatedSources, completedMetadata);
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

      // Safety: if the stream closed without an explicit `done` event, finalize
      // with whatever content was buffered so the UI is never left stuck.
      if (!completedRef.current) {
        completedRef.current = true;
        clearStallTimer();
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        if (contentBufferRef.current) {
          accumulatedContentRef.current += contentBufferRef.current;
          contentBufferRef.current = '';
        }
        setState(prev => ({
          ...prev,
          currentContent: accumulatedContentRef.current,
          isStreaming: false,
          phase: 'complete',
        }));
        if (onComplete && (messageId || accumulatedContentRef.current)) {
          onComplete(messageId || `partial-${Date.now()}`, accumulatedContentRef.current, accumulatedSources, completedMetadata);
        }
      }
    } catch (error) {
      clearStallTimer();
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
      clearStallTimer();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
  }, [workspaceSlug, sessionId, threadId, onComplete, onError, flushBuffer, clearStallTimer, finalizeComplete]);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    clearStallTimer();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setState(prev => ({ ...prev, isStreaming: false }));
  }, [clearStallTimer]);

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

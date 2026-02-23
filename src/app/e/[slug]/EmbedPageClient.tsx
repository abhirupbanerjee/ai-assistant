'use client';

/**
 * Embed Page Client Component
 *
 * Full-page embed chat experience with TEXT-ONLY responses.
 * Supports voice input and file upload when enabled.
 *
 * Note: This is a lightweight embed mode. Visual artifacts (images, charts,
 * documents) are NOT supported. The LLM is instructed to provide text-based
 * alternatives (ASCII tables, formatted lists, etc.) instead.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';
import VoiceInput from '@/components/chat/VoiceInput';
import { WorkspaceFileUpload, AttachmentChip } from '@/components/workspace/WorkspaceFileUpload';
import './embed.css';

interface EmbedConfig {
  primaryColor: string;
  logoUrl: string | null;
  chatTitle: string | null;
  greetingMessage: string;
  suggestedPrompts: string[] | null;
  footerText: string | null;
  voiceEnabled: boolean;
  fileUploadEnabled: boolean;
  maxFileSizeMb: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

interface UploadedFile {
  filename: string;
  originalName: string;
  isImage: boolean;
}

interface EmbedPageClientProps {
  workspaceSlug: string;
  config: EmbedConfig;
}

export function EmbedPageClient({ workspaceSlug, config }: EmbedPageClientProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize session
  useEffect(() => {
    async function initSession() {
      try {
        const response = await fetch(`/api/w/${workspaceSlug}/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            visitorId: getVisitorId(),
            referrerUrl: window.location.href,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to initialize');
        }

        const data = await response.json();
        setSessionId(data.sessionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize chat');
      } finally {
        setIsInitializing(false);
      }
    }

    initSession();
  }, [workspaceSlug]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  const sendMessage = useCallback(async (content: string, messageAttachments?: string[]) => {
    if (!sessionId || isStreaming) return;

    // Build display content with attachments
    const displayContent = messageAttachments?.length
      ? content + (content ? '\n' : '') + `[${messageAttachments.length} file(s) attached]`
      : content;

    // Add user message
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: displayContent,
    };
    setMessages(prev => [...prev, userMessage]);

    // Add placeholder for assistant
    const assistantMessageId = generateId();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };
    setMessages(prev => [...prev, assistantMessage]);

    setIsStreaming(true);
    setError(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`/api/w/${workspaceSlug}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          sessionId,
          attachments: messageAttachments,
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

            if (event.type === 'chunk') {
              accumulatedContent += event.content;
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMessageId
                    ? { ...m, content: accumulatedContent }
                    : m
                )
              );
            } else if (event.type === 'done') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMessageId
                    ? { ...m, isStreaming: false }
                    : m
                )
              );
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;

      setError(err instanceof Error ? err.message : 'Failed to send message');
      setMessages(prev => prev.filter(m => m.id !== assistantMessageId));
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [sessionId, isStreaming, workspaceSlug]);

  const handleSubmit = () => {
    if ((inputValue.trim() || attachments.length > 0) && !isStreaming) {
      const attachmentFilenames = attachments.map(a => a.filename);
      sendMessage(inputValue.trim(), attachmentFilenames.length > 0 ? attachmentFilenames : undefined);
      setInputValue('');
      setAttachments([]);
    }
  };

  const handleVoiceTranscript = useCallback((text: string) => {
    setInputValue(prev => prev ? `${prev} ${text}` : text);
    textareaRef.current?.focus();
  }, []);

  const handleFileUploaded = useCallback((file: UploadedFile) => {
    setAttachments(prev => [...prev, file]);
  }, []);

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // Shift+Enter or Ctrl/Cmd+Enter = new line
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        return; // Allow default new line behavior
      }
      // Enter alone = submit
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleClear = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setMessages([]);
    setAttachments([]);
    setIsStreaming(false);
    setError(null);
  };

  if (isInitializing) {
    return (
      <div className="embed-page">
        <div className="embed-loading">
          <div className="embed-spinner" style={{ borderTopColor: config.primaryColor }} />
        </div>
      </div>
    );
  }

  return (
    <div className="embed-page">
      {/* Header */}
      <header className="embed-header" style={{ backgroundColor: config.primaryColor }}>
        <div className="embed-header-content">
          {config.logoUrl && (
            <img src={config.logoUrl} alt="" className="embed-logo" />
          )}
          <span className="embed-title">{config.chatTitle || 'Chat'}</span>
        </div>
      </header>

      {/* Messages */}
      <main className="embed-messages">
        {messages.length === 0 ? (
          <div className="embed-welcome">
            <p className="embed-welcome-text">{config.greetingMessage}</p>
            {config.suggestedPrompts && config.suggestedPrompts.length > 0 && (
              <div className="embed-prompts">
                {config.suggestedPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    className="embed-prompt-btn"
                    onClick={() => sendMessage(prompt)}
                    disabled={isStreaming}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`embed-message ${
                  message.role === 'user' ? 'embed-message-user' : 'embed-message-assistant'
                }`}
                style={message.role === 'user' ? { backgroundColor: config.primaryColor } : undefined}
                onMouseEnter={() => message.role === 'assistant' && setHoveredId(message.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {message.role === 'assistant' ? (
                  <div className="embed-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  message.content
                )}
                {message.isStreaming && (
                  <span className="embed-cursor" />
                )}
                {message.role === 'assistant' && !message.isStreaming && hoveredId === message.id && (
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(message.content);
                        setCopiedId(message.id);
                        setTimeout(() => setCopiedId(null), 2000);
                      } catch {
                        // clipboard access denied
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginTop: '6px',
                      padding: '3px 6px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#9ca3af',
                      fontSize: '11px',
                    }}
                    title={copiedId === message.id ? 'Copied!' : 'Copy'}
                  >
                    {copiedId === message.id
                      ? <Check size={12} color="#16a34a" />
                      : <Copy size={12} />
                    }
                  </button>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}

        {error && (
          <div className="embed-error">{error}</div>
        )}
      </main>

      {/* Input */}
      <footer className="embed-footer">
        {/* Attachments display */}
        {attachments.length > 0 && (
          <div className="embed-attachments">
            {attachments.map((file, index) => (
              <AttachmentChip
                key={`${file.filename}-${index}`}
                file={file}
                onRemove={() => handleRemoveAttachment(index)}
                disabled={isStreaming}
              />
            ))}
          </div>
        )}

        <div className="embed-input-container">
          {/* File upload button */}
          {config.fileUploadEnabled && (
            <WorkspaceFileUpload
              workspaceSlug={workspaceSlug}
              sessionId={sessionId}
              maxFileSizeMb={config.maxFileSizeMb}
              disabled={isStreaming || !sessionId}
              onFileUploaded={handleFileUploaded}
              primaryColor={config.primaryColor}
            />
          )}

          {/* Voice input button */}
          {config.voiceEnabled && (
            <VoiceInput
              onTranscript={handleVoiceTranscript}
              disabled={isStreaming || !sessionId}
            />
          )}

          <textarea
            ref={textareaRef}
            className="embed-textarea"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            disabled={isStreaming || !sessionId}
          />
          <button
            className="embed-send-btn"
            onClick={handleSubmit}
            disabled={(!inputValue.trim() && attachments.length === 0) || isStreaming || !sessionId}
            style={{ backgroundColor: config.primaryColor }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="white">
              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
            </svg>
          </button>
        </div>

        <div className="embed-actions">
          <button
            className="embed-clear-btn"
            onClick={handleClear}
            disabled={messages.length === 0}
          >
            Clear chat
          </button>
          {messages.length > 0 && sessionId && (
            <a
              href={`/api/w/${workspaceSlug}/session/export?sessionId=${sessionId}`}
              download
              className="embed-clear-btn"
            >
              Export chat
            </a>
          )}
          {config.footerText && (
            <span className="embed-footer-text">{config.footerText}</span>
          )}
        </div>
      </footer>
    </div>
  );
}

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

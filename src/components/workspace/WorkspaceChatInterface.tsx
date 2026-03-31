'use client';

/**
 * Workspace Chat Interface
 *
 * Message list and input for standalone workspace mode.
 * Supports voice input and file upload when enabled.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, RefreshCw, ArrowDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Source } from '@/types';
import { MarkdownComponents } from '@/components/markdown/MarkdownRenderers';
import VoiceInput from '@/components/chat/VoiceInput';
import { WorkspaceFileUpload, AttachmentChip } from './WorkspaceFileUpload';
import { useIsTouchDevice } from '@/hooks/useIsTouchDevice';
import MessageActions from '@/components/chat/MessageActions';
import type { MessageMetadata } from '@/types';

export interface WorkspaceChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: Source[];
  isStreaming?: boolean;
  metadata?: MessageMetadata;
}

interface UploadedFile {
  filename: string;
  originalName: string;
  isImage: boolean;
}

interface WorkspaceChatInterfaceProps {
  messages: WorkspaceChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  streamingSources: Source[];
  error: string | null;
  greetingMessage: string;
  suggestedPrompts?: string[] | null;
  primaryColor: string;
  disabled?: boolean;
  voiceEnabled?: boolean;
  fileUploadEnabled?: boolean;
  maxFileSizeMb?: number;
  workspaceSlug: string;
  sessionId: string | null;
  onSendMessage: (message: string, attachments?: string[]) => void;
  onRetry?: () => void;
}

export function WorkspaceChatInterface({
  messages,
  isStreaming,
  streamingContent,
  streamingSources,
  error,
  greetingMessage,
  suggestedPrompts,
  primaryColor,
  disabled = false,
  voiceEnabled = false,
  fileUploadEnabled = false,
  maxFileSizeMb = 5,
  workspaceSlug,
  sessionId,
  onSendMessage,
  onRetry,
}: WorkspaceChatInterfaceProps) {
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isTouchDevice = useIsTouchDevice();

  // Scroll to bottom on new messages (only if user hasn't scrolled up)
  useEffect(() => {
    if (isScrolledUp) return;
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, streamingContent, isScrolledUp]);

  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setIsScrolledUp(distanceFromBottom > 100);
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
    setIsScrolledUp(false);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [inputValue]);

  const handleSubmit = useCallback(() => {
    if ((inputValue.trim() || attachments.length > 0) && !isStreaming && !disabled) {
      const attachmentFilenames = attachments.map(a => a.filename);
      onSendMessage(inputValue.trim(), attachmentFilenames.length > 0 ? attachmentFilenames : undefined);
      setInputValue('');
      setAttachments([]);
    }
  }, [inputValue, attachments, isStreaming, disabled, onSendMessage]);

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

  const showWelcome = messages.length === 0 && !isStreaming;

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-y-auto p-4 relative"
      >
        {showWelcome ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <p className="text-lg text-gray-600 mb-6 max-w-md">
              {greetingMessage}
            </p>

            {suggestedPrompts && suggestedPrompts.length > 0 && (
              <div className="flex flex-col gap-2 w-full max-w-md">
                {suggestedPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => onSendMessage(prompt)}
                    disabled={disabled}
                    className="text-left px-4 py-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg text-sm text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                primaryColor={primaryColor}
              />
            ))}

            {/* Streaming message */}
            {isStreaming && (
              <MessageBubble
                message={{
                  id: 'streaming',
                  role: 'assistant',
                  content: streamingContent,
                  timestamp: new Date(),
                  sources: streamingSources,
                  isStreaming: true,
                }}
                primaryColor={primaryColor}
              />
            )}

            {/* Error */}
            {error && (
              <div className="flex items-center justify-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <span>{error}</span>
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="flex items-center gap-1 px-2 py-1 bg-red-100 hover:bg-red-200 rounded text-red-800 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry
                  </button>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Scroll to bottom FAB */}
        {isScrolledUp && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 z-10 w-8 h-8 rounded-full bg-white shadow-md border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 transition-colors"
            title="Scroll to bottom"
          >
            <ArrowDown size={16} />
          </button>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 bg-white p-4">
        <div className="max-w-3xl mx-auto">
          {/* Attachments display */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
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

          <div className="flex items-end gap-2 bg-gray-50 rounded-2xl border border-gray-200 p-3">
            {/* File upload button */}
            {fileUploadEnabled && (
              <WorkspaceFileUpload
                workspaceSlug={workspaceSlug}
                sessionId={sessionId}
                maxFileSizeMb={maxFileSizeMb}
                disabled={isStreaming || disabled}
                onFileUploaded={handleFileUploaded}
                primaryColor={primaryColor}
              />
            )}

            {/* Voice input button */}
            {voiceEnabled && (
              <VoiceInput
                onTranscript={handleVoiceTranscript}
                disabled={isStreaming || disabled}
              />
            )}

            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={isStreaming || disabled}
              rows={1}
              enterKeyHint={isTouchDevice ? 'enter' : 'send'}
              className="flex-1 bg-transparent resize-none focus:outline-none text-gray-900 placeholder-gray-400 min-h-[24px] max-h-[150px]"
            />
            <button
              onClick={handleSubmit}
              disabled={(!inputValue.trim() && attachments.length === 0) || isStreaming || disabled}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: primaryColor }}
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Metadata footer sub-component
function MetadataFooter({ metadata }: { metadata: MessageMetadata }) {
  const [expanded, setExpanded] = useState(false);

  const modelLabel = metadata.model
    ? metadata.model.replace(/^(gpt-|claude-|gemini-)/i, '').replace(/-(\d)/g, ' $1').replace(/-/g, ' ').trim()
    : null;
  const totalSec = metadata.totalMs ? (metadata.totalMs / 1000).toFixed(1) + 's' : null;

  return (
    <div className="text-xs text-gray-400 flex items-center gap-2 mt-1">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 hover:text-gray-600 transition-colors"
        title="Response details"
      >
        {modelLabel && <span>{modelLabel}</span>}
        {totalSec && <span>{totalSec}</span>}
        {metadata.completionTokens && <span>{metadata.tokensEstimated ? '~' : ''}{metadata.completionTokens} tok</span>}
      </button>
      {expanded && (metadata.llmMs || metadata.ragMs) && (
        <span className="text-gray-300">
          {metadata.llmMs ? `LLM ${(metadata.llmMs / 1000).toFixed(1)}s` : ''}
          {metadata.llmMs && metadata.ragMs ? ' · ' : ''}
          {metadata.ragMs ? `RAG ${(metadata.ragMs / 1000).toFixed(1)}s` : ''}
        </span>
      )}
    </div>
  );
}

// Message bubble component
interface MessageBubbleProps {
  message: WorkspaceChatMessage;
  primaryColor: string;
}

function MessageBubble({ message, primaryColor }: MessageBubbleProps) {
  const [showSources, setShowSources] = useState(false);
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} group`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser ? 'text-white' : 'bg-gray-100 text-gray-900'
        }`}
        style={isUser ? { backgroundColor: primaryColor } : undefined}
      >
        <div className={`markdown-content ${isUser ? 'text-white' : ''}`}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={MarkdownComponents}
          >
            {message.content}
          </ReactMarkdown>
          {message.isStreaming && !message.content && (
            <div className="flex gap-1 py-1">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          )}
          {message.isStreaming && message.content && (
            <span className="inline-block w-0.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-middle" />
          )}
        </div>

        {/* Sources */}
        {!isUser && message.sources && message.sources.length > 0 && !message.isStreaming && (
          <div className="mt-2 pt-2 border-t border-gray-200">
            <button
              onClick={() => setShowSources(!showSources)}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <span>{showSources ? '▼' : '▶'}</span>
              {message.sources.length} source{message.sources.length !== 1 ? 's' : ''}
            </button>

            {showSources && (
              <div className="mt-2 space-y-1">
                {message.sources.slice(0, 5).map((source, idx) => (
                  <div
                    key={idx}
                    className="text-xs bg-gray-50 p-2 rounded text-gray-600"
                  >
                    <span className="font-medium">{source.documentName}</span>
                    <span className="text-gray-400 ml-1">(Page {source.pageNumber})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Metadata footer (assistant only, not while streaming) */}
        {!isUser && !message.isStreaming && message.metadata && (
          <MetadataFooter metadata={message.metadata} />
        )}

        {/* Action bar: copy + read aloud (assistant only, not while streaming) */}
        {!isUser && !message.isStreaming && (
          <MessageActions content={message.content} />
        )}
      </div>
    </div>
  );
}

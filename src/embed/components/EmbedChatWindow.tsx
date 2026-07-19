/**
 * Embed Chat Window Component
 *
 * The main chat window for the embed widget.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { EmbedMessage } from './EmbedMessage';
import type { EmbedMessage as EmbedMessageType, EmbedConfig } from '../types';
import ScrollNavButtons from '@/components/chat/ScrollNavButtons';
import { useIsTouchDevice } from '@/hooks/useIsTouchDevice';

interface EmbedChatWindowProps {
  config: EmbedConfig;
  messages: EmbedMessageType[];
  isStreaming: boolean;
  error: string | null;
  onSendMessage: (content: string) => void;
  onClearMessages: () => void;
  onClose: () => void;
  showSources?: boolean;
}

export function EmbedChatWindow({
  config,
  messages,
  isStreaming,
  error,
  onSendMessage,
  onClearMessages,
  onClose,
  showSources = true,
}: EmbedChatWindowProps) {
  const [inputValue, setInputValue] = useState('');
  const [scrollPos, setScrollPos] = useState({ top: 0, height: 0, clientHeight: 0 });
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isTouchDevice = useIsTouchDevice();

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, []);

  const scrollToTop = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Scroll position tracking
  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    setScrollPos({ top: container.scrollTop, height: container.scrollHeight, clientHeight: container.clientHeight });
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  const handleSubmit = () => {
    if (inputValue.trim() && !isStreaming) {
      onSendMessage(inputValue.trim());
      setInputValue('');
    }
  };

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

  const handlePromptClick = (prompt: string) => {
    onSendMessage(prompt);
  };

  const showWelcome = messages.length === 0;

  return (
    <div className="ai-assistant-embed-window">
      {/* Header */}
      <div
        className="ai-assistant-embed-header"
        style={{ backgroundColor: config.primaryColor }}
      >
        <div className="ai-assistant-embed-header-left">
          {config.logoUrl && (
            <img
              src={config.logoUrl}
              alt=""
              className="ai-assistant-embed-logo"
            />
          )}
          <span className="ai-assistant-embed-title">
            {config.chatTitle || 'Chat'}
          </span>
        </div>
        <button className="ai-assistant-embed-close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="ai-assistant-embed-messages ai-assistant-embed-scroll-container"
      >
        {showWelcome ? (
          <div className="ai-assistant-embed-welcome">
            <div className="ai-assistant-embed-welcome-text">
              {config.greetingMessage}
            </div>

            {config.suggestedPrompts && config.suggestedPrompts.length > 0 && (
              <div className="ai-assistant-embed-prompts">
                {config.suggestedPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    className="ai-assistant-embed-prompt-btn"
                    onClick={() => handlePromptClick(prompt)}
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
              <EmbedMessage key={message.id} message={message} showSources={showSources} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}

        {error && (
          <div className="ai-assistant-embed-error">
            {error}
          </div>
        )}

        {/* Scroll navigation buttons */}
        <ScrollNavButtons
          containerRef={messagesContainerRef}
          scrollTop={scrollPos.top}
          scrollHeight={scrollPos.height}
          clientHeight={scrollPos.clientHeight}
          isStreaming={isStreaming}
          isTouchDevice={isTouchDevice}
          className="ai-assistant-embed-scroll-buttons"
          hoverClassName="ai-assistant-embed-scroll-hover"
          buttonClassName="ai-assistant-embed-scroll-btn"
        />
      </div>

      {/* Input area */}
      <div className="ai-assistant-embed-input-area">
        <div className="ai-assistant-embed-input-container">
          <textarea
            ref={textareaRef}
            className="ai-assistant-embed-textarea"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            disabled={isStreaming}
          />
          <button
            className="ai-assistant-embed-send-btn"
            onClick={handleSubmit}
            disabled={!inputValue.trim() || isStreaming}
            style={{ backgroundColor: config.primaryColor }}
          >
            <svg viewBox="0 0 24 24">
              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Actions bar */}
      <div className="ai-assistant-embed-actions">
        <button
          className="ai-assistant-embed-clear-btn"
          onClick={onClearMessages}
          disabled={messages.length === 0}
        >
          Clear chat
        </button>
        {config.footerText && (
          <span>{config.footerText}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Embed Chat Window Component
 *
 * The main chat window for the embed widget.
 */

import React, { useState, useRef, useEffect } from 'react';
import { EmbedMessage } from './EmbedMessage';
import type { EmbedMessage as EmbedMessageType, EmbedConfig } from '../types';

interface EmbedChatWindowProps {
  config: EmbedConfig;
  messages: EmbedMessageType[];
  isStreaming: boolean;
  error: string | null;
  onSendMessage: (content: string) => void;
  onClearMessages: () => void;
  onClose: () => void;
}

export function EmbedChatWindow({
  config,
  messages,
  isStreaming,
  error,
  onSendMessage,
  onClearMessages,
  onClose,
}: EmbedChatWindowProps) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom when messages change
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
    <div className="policybot-embed-window">
      {/* Header */}
      <div
        className="policybot-embed-header"
        style={{ backgroundColor: config.primaryColor }}
      >
        <div className="policybot-embed-header-left">
          {config.logoUrl && (
            <img
              src={config.logoUrl}
              alt=""
              className="policybot-embed-logo"
            />
          )}
          <span className="policybot-embed-title">
            {config.chatTitle || 'Chat'}
          </span>
        </div>
        <button className="policybot-embed-close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Messages area */}
      <div className="policybot-embed-messages">
        {showWelcome ? (
          <div className="policybot-embed-welcome">
            <div className="policybot-embed-welcome-text">
              {config.greetingMessage}
            </div>

            {config.suggestedPrompts && config.suggestedPrompts.length > 0 && (
              <div className="policybot-embed-prompts">
                {config.suggestedPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    className="policybot-embed-prompt-btn"
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
              <EmbedMessage key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}

        {error && (
          <div className="policybot-embed-error">
            {error}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="policybot-embed-input-area">
        <div className="policybot-embed-input-container">
          <textarea
            ref={textareaRef}
            className="policybot-embed-textarea"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            disabled={isStreaming}
          />
          <button
            className="policybot-embed-send-btn"
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
      <div className="policybot-embed-actions">
        <button
          className="policybot-embed-clear-btn"
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

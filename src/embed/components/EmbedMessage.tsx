/**
 * Embed Message Component
 *
 * Renders a single message in the embed widget.
 */

import React, { useState } from 'react';
import type { EmbedMessage as EmbedMessageType } from '../types';

interface EmbedMessageProps {
  message: EmbedMessageType;
  showSources?: boolean;
}

export function EmbedMessage({ message, showSources: showSourcesProp = true }: EmbedMessageProps) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const isUser = message.role === 'user';

  // Simple markdown-like rendering
  const renderContent = (content: string) => {
    // Convert markdown bold
    let html = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Convert markdown italic
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Convert markdown code
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');
    // Convert line breaks
    html = html.replace(/\n/g, '<br/>');

    return { __html: html };
  };

  return (
    <div
      className={`policybot-embed-message ${
        isUser ? 'policybot-embed-message-user' : 'policybot-embed-message-assistant'
      }`}
    >
      <div dangerouslySetInnerHTML={renderContent(message.content)} />

      {message.isStreaming && (
        <div className="policybot-embed-typing">
          <span className="policybot-embed-typing-dot" />
          <span className="policybot-embed-typing-dot" />
          <span className="policybot-embed-typing-dot" />
        </div>
      )}

      {!isUser && showSourcesProp && message.sources && message.sources.length > 0 && !message.isStreaming && (
        <div className="policybot-embed-sources">
          <button
            className="policybot-embed-sources-toggle"
            onClick={() => setSourcesExpanded(!sourcesExpanded)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{
                transform: sourcesExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {message.sources.length} source{message.sources.length !== 1 ? 's' : ''}
          </button>

          {sourcesExpanded && (
            <div className="policybot-embed-sources-list">
              {message.sources.slice(0, 3).map((source, idx) => (
                <div key={idx} className="policybot-embed-source-item">
                  <span className="policybot-embed-source-title">
                    {source.documentName}
                  </span>
                  <span className="policybot-embed-source-page">
                    (Page {source.pageNumber})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

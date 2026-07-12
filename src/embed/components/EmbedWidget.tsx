/**
 * Embed Widget Component
 *
 * The main floating widget that can be embedded on external websites.
 * Includes the floating button and expandable chat window.
 */

import React, { useState, useEffect } from 'react';
import { EmbedChatWindow } from './EmbedChatWindow';
import { useEmbedChat } from '../hooks/useEmbedChat';
import type { EmbedPosition } from '../types';

interface EmbedWidgetProps {
  workspaceSlug: string;
  apiBaseUrl: string;
  position?: EmbedPosition;
  offsetX?: number;
  offsetY?: number;
}

export function EmbedWidget({
  workspaceSlug,
  apiBaseUrl,
  position = 'bottom-right',
  offsetX = 20,
  offsetY = 20,
}: EmbedWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [showSources, setShowSources] = useState(true);

  const {
    messages,
    isLoading,
    isStreaming,
    config,
    error,
    initialize,
    sendMessage,
    clearMessages,
  } = useEmbedChat({
    workspaceSlug,
    apiBaseUrl,
    onError: (err) => console.error('[AI Assistant Embed]', err),
  });

  // Initialize on first open
  useEffect(() => {
    if (isOpen && !initialized) {
      initialize().then((success) => {
        if (success) {
          setInitialized(true);
        }
      });
    }
  }, [isOpen, initialized, initialize]);

  // Use workspace-level sources setting from init config
  useEffect(() => {
    if (config && typeof config.sourcesEnabled === 'boolean') {
      setShowSources(config.sourcesEnabled);
    }
  }, [config]);

  // Calculate position styles
  const positionStyles: React.CSSProperties = {
    [position.includes('right') ? 'right' : 'left']: offsetX,
    bottom: offsetY,
  };

  const windowPositionStyles: React.CSSProperties = {
    [position.includes('right') ? 'right' : 'left']: offsetX,
    bottom: offsetY + 70, // Above the button
  };

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  // Apply primary color from config
  const primaryColor = config?.primaryColor || '#2563eb';

  return (
    <div className="policybot-embed-widget">
      {/* Floating button */}
      {!isOpen && (
        <button
          className="policybot-embed-button"
          onClick={handleToggle}
          style={{ ...positionStyles, backgroundColor: primaryColor }}
          aria-label="Open chat"
        >
          <svg viewBox="0 0 24 24">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
            <path d="M7 9h10v2H7zm0-3h10v2H7z" />
          </svg>
        </button>
      )}

      {/* Chat window */}
      {isOpen && (
        <>
          {isLoading ? (
            <div className="policybot-embed-window" style={windowPositionStyles}>
              <div className="policybot-embed-loading">
                <div className="policybot-embed-spinner" />
              </div>
            </div>
          ) : config ? (
            <div style={windowPositionStyles}>
              <EmbedChatWindow
                config={config}
                messages={messages}
                isStreaming={isStreaming}
                error={error}
                onSendMessage={sendMessage}
                onClearMessages={clearMessages}
                onClose={handleClose}
                showSources={showSources}
              />
            </div>
          ) : error ? (
            <div className="policybot-embed-window" style={windowPositionStyles}>
              <div className="policybot-embed-error">
                {error}
                <br />
                <button
                  onClick={() => {
                    setInitialized(false);
                    initialize();
                  }}
                  style={{ marginTop: 8, textDecoration: 'underline' }}
                >
                  Retry
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

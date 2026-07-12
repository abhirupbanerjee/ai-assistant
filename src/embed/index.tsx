/**
 * Embed Widget Entry Point
 *
 * This file is the entry point for the embed widget bundle.
 * It can be loaded on external websites via a script tag.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { EmbedWidget } from './components/EmbedWidget';
import './styles/embed.css';

interface AIAssistantEmbedOptions {
  workspaceId: string;
  apiBaseUrl?: string;
  position?: 'bottom-right' | 'bottom-left';
  offsetX?: number;
  offsetY?: number;
}

// Global initialization function
function initAIAssistantEmbed(options: AIAssistantEmbedOptions) {
  const {
    workspaceId,
    apiBaseUrl = window.location.origin,
    position = 'bottom-right',
    offsetX = 20,
    offsetY = 20,
  } = options;

  // Create container element
  const containerId = 'ai-assistant-embed-container';
  let container = document.getElementById(containerId);

  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    document.body.appendChild(container);
  }

  // Render the widget
  const root = createRoot(container);
  root.render(
    <EmbedWidget
      workspaceSlug={workspaceId}
      apiBaseUrl={apiBaseUrl}
      position={position}
      offsetX={offsetX}
      offsetY={offsetY}
    />
  );

  return {
    destroy: () => {
      root.unmount();
      container?.remove();
    },
  };
}

// Auto-initialize from script attributes
function autoInit() {
  // Find the script tag
  const scripts = document.getElementsByTagName('script');
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];
    const workspaceId = script.getAttribute('data-workspace-id');

    if (workspaceId && script.src.includes('workspace.js')) {
      initAIAssistantEmbed({
        workspaceId,
        apiBaseUrl: script.getAttribute('data-api-base') || undefined,
        position: (script.getAttribute('data-position') as 'bottom-right' | 'bottom-left') || undefined,
        offsetX: script.getAttribute('data-offset-x')
          ? parseInt(script.getAttribute('data-offset-x')!, 10)
          : undefined,
        offsetY: script.getAttribute('data-offset-y')
          ? parseInt(script.getAttribute('data-offset-y')!, 10)
          : undefined,
      });
      break;
    }
  }
}

// Export for manual initialization
if (typeof window !== 'undefined') {
  (window as typeof window & { AIAssistantEmbed: typeof initAIAssistantEmbed }).AIAssistantEmbed = initAIAssistantEmbed;

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
}

export { initAIAssistantEmbed, EmbedWidget };

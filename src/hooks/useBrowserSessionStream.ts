'use client';

import { useEffect, useState } from 'react';
import type { BrowserSessionState, BrowserCheckpoint } from '@/types/browser';

export interface BrowserSessionStreamState {
  state: BrowserSessionState | null;
  url: string | null;
  title: string | null;
  checkpoint: BrowserCheckpoint | null;
  frameDataUrl: string | null;
  connected: boolean;
}

/**
 * Subscribes to `/api/browser-sessions/:id/stream` (same-origin EventSource,
 * so the session cookie is sent automatically) and returns the latest frame +
 * state for the BrowserSessionViewer.
 */
export function useBrowserSessionStream(sessionId: string | null): BrowserSessionStreamState {
  const [state, setState] = useState<BrowserSessionState | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [checkpoint, setCheckpoint] = useState<BrowserCheckpoint | null>(null);
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    const es = new EventSource(`/api/browser-sessions/${encodeURIComponent(sessionId)}/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as Record<string, unknown>;
        if (event.type === 'frame' && typeof event.dataUrl === 'string') {
          setFrameDataUrl(event.dataUrl);
        } else if (event.type === 'state') {
          if (typeof event.state === 'string') setState(event.state as BrowserSessionState);
          if (typeof event.url === 'string') setUrl(event.url);
          if (typeof event.title === 'string') setTitle(event.title);
          setCheckpoint((event.checkpoint as BrowserCheckpoint | null) ?? null);
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    return () => {
      es.close();
    };
  }, [sessionId]);

  return { state, url, title, checkpoint, frameDataUrl, connected };
}

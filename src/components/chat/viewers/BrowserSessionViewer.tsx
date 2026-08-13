'use client';

import { useEffect, useState } from 'react';
import { X, Globe, Hand, RotateCcw, ShieldAlert, Loader2 } from 'lucide-react';
import { useBrowserSessionStream } from '@/hooks/useBrowserSessionStream';
import type { BrowserSessionState } from '@/types/browser';

interface BrowserSessionViewerProps {
  sessionId: string;
  onClose: () => void;
}

const STATE_STYLES: Record<BrowserSessionState, string> = {
  created: 'bg-gray-600',
  observing: 'bg-emerald-600',
  needs_form_input: 'bg-amber-500',
  takeover: 'bg-blue-600',
  final_confirm: 'bg-orange-600',
  completed: 'bg-emerald-600',
  expired: 'bg-gray-500',
  terminated: 'bg-gray-500',
  error: 'bg-red-600',
};

export default function BrowserSessionViewer({ sessionId, onClose }: BrowserSessionViewerProps) {
  const { state, url, title, checkpoint, frameDataUrl, connected } = useBrowserSessionStream(sessionId);
  const [busy, setBusy] = useState<'takeover' | 'resume' | null>(null);
  const [task, setTask] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/browser-sessions/${encodeURIComponent(sessionId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.session?.task && typeof d.session.task === 'string') setTask(d.session.task);
      })
      .catch(() => {
        /* task is optional display */
      });
  }, [sessionId]);

  const isTakeover = state === 'takeover';
  const isFinalConfirm = checkpoint === 'final_confirm' || state === 'final_confirm';
  const displayState = state ?? 'created';

  const post = async (path: string, action: 'takeover' | 'resume') => {
    setBusy(action);
    try {
      await fetch(`/api/browser-sessions/${encodeURIComponent(sessionId)}${path}`, { method: 'POST' });
    } catch {
      /* the SSE stream will reconcile state */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-700 px-4 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Globe className="h-4 w-4 shrink-0 text-gray-400" />
            <span className="truncate">{title || task || 'Browser session'}</span>
          </div>
          {task && <div className="truncate text-xs text-gray-300">{task}</div>}
          <div className="truncate text-xs text-gray-500">{url || 'connecting…'}</div>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
          aria-label="Close browser panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-2 border-b border-gray-700 px-4 py-1.5 text-xs">
        <span className={`rounded px-1.5 py-0.5 font-medium text-white ${STATE_STYLES[displayState]}`}>
          {displayState.replace(/_/g, ' ')}
        </span>
        {checkpoint && (
          <span className="rounded bg-amber-600/80 px-1.5 py-0.5 text-white">
            checkpoint: {checkpoint.replace(/_/g, ' ')}
          </span>
        )}
        {!connected && (
          <span className="flex items-center gap-1 text-red-400">
            <Loader2 className="h-3 w-3 animate-spin" /> reconnecting…
          </span>
        )}
      </div>

      {/* Screenshot viewport */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
        {frameDataUrl ? (
          <img
            src={frameDataUrl}
            alt="Live browser view"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="px-4 text-sm text-gray-500">Waiting for first frame…</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-gray-700 px-4 py-3">
        {isFinalConfirm ? (
          <div className="flex flex-1 items-center justify-center gap-2 rounded-md bg-orange-600/20 px-3 py-2 text-sm font-medium text-orange-300">
            <ShieldAlert className="h-4 w-4" />
            Final action requires you — review the summary in chat
          </div>
        ) : isTakeover ? (
          <button
            onClick={() => post('/resume', 'resume')}
            disabled={busy !== null}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            {busy === 'resume' ? 'Resuming…' : 'Return control to agent'}
          </button>
        ) : (
          <button
            onClick={() => post('/takeover', 'takeover')}
            disabled={busy !== null}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Hand className="h-4 w-4" />
            {busy === 'takeover' ? 'Taking over…' : 'Take over'}
          </button>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowLeft, Download, Maximize2, Minimize2, Copy, Check } from 'lucide-react';
import type { ArtifactCanvasItem } from '@/types';

interface CanvasToolbarProps {
  title: string;
  downloadUrl?: string;
  onClose: () => void;
  artifact?: ArtifactCanvasItem;
}

/**
 * Canvas toolbar with back, fullscreen toggle, and contextual quick actions.
 * The fullscreen toggle uses the browser Fullscreen API on the nearest
 * ancestor container (passed via a ref-less lookup of the parent element).
 */
export default function CanvasToolbar({ title, downloadUrl, onClose, artifact }: CanvasToolbarProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  const handleFullscreen = useCallback(() => {
    const container = toolbarRef.current?.parentElement;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen?.().catch(() => { /* user denied or unsupported */ });
    } else {
      document.exitFullscreen?.().catch(() => { /* noop */ });
    }
  }, []);

  const hasRawCode = Boolean(
    artifact && (
      artifact.artifactType === 'diagram' && artifact.mermaidCode ||
      artifact.artifactType === 'html'
    )
  );

  const handleCopyCode = useCallback(async () => {
    if (!artifact) return;
    const code =
      artifact.artifactType === 'diagram'
        ? artifact.mermaidCode || ''
        : artifact.artifactType === 'html'
          ? (artifact as ArtifactCanvasItem & { htmlContent?: string }).htmlContent || ''
          : '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, [artifact]);

  return (
    <div
      ref={toolbarRef}
      className="flex items-center justify-between px-3 py-2 border-b bg-white shrink-0"
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={onClose}
          className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
          title="Back to artifacts"
          aria-label="Back to artifacts"
        >
          <ArrowLeft size={18} />
        </button>
        <h3 className="text-sm font-medium text-gray-900 truncate" title={title}>
          {title}
        </h3>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {hasRawCode && (
          <button
            onClick={handleCopyCode}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            title="Copy source code"
            aria-label="Copy source code"
          >
            {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        )}

        {downloadUrl ? (
          <a
            href={downloadUrl}
            download
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            title="Download artifact"
          >
            <Download size={15} />
            <span className="hidden sm:inline">Download</span>
          </a>
        ) : null}

        <button
          onClick={handleFullscreen}
          className="flex items-center gap-1.5 p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
    </div>
  );
}

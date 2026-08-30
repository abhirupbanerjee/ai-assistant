'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Maximize2, Minimize2, Copy, Check, MessageSquarePlus, MessageSquare } from 'lucide-react';
import type { ArtifactCanvasItem } from '@/types';

interface CanvasToolbarProps {
  title: string;
  downloadUrl?: string;
  onClose: () => void;
  artifact?: ArtifactCanvasItem;
  hasPrev?: boolean;
  hasNext?: boolean;
  indexText?: string;
  onPrev?: () => void;
  onNext?: () => void;
  commentCount?: number;
  onOpenComments?: () => void;
  showCommentsButton?: boolean;
  onAddComment?: () => void;
  showAddCommentButton?: boolean;
  onAddImageComment?: () => void;
  showImageCommentButton?: boolean;
}

/**
 * Canvas toolbar with back, fullscreen toggle, and contextual quick actions.
 * The fullscreen toggle uses the browser Fullscreen API on the nearest
 * ancestor container (passed via a ref-less lookup of the parent element).
 */
export default function CanvasToolbar({
  title,
  downloadUrl,
  onClose,
  artifact,
  hasPrev = false,
  hasNext = false,
  indexText,
  onPrev,
  onNext,
  commentCount = 0,
  onOpenComments,
  showCommentsButton = false,
  onAddComment,
  showAddCommentButton = false,
  onAddImageComment,
  showImageCommentButton = false,
}: CanvasToolbarProps) {
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
        {indexText && (onPrev || onNext) && (
          <div className="flex items-center gap-0.5 border-l border-gray-200 pl-2 ml-1 shrink-0">
            <button
              onClick={onPrev}
              disabled={!hasPrev}
              className="p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              title="Previous artifact (Left Arrow)"
              aria-label="Previous artifact"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-gray-500 font-mono px-1 tabular-nums" aria-live="polite">
              {indexText}
            </span>
            <button
              onClick={onNext}
              disabled={!hasNext}
              className="p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              title="Next artifact (Right Arrow)"
              aria-label="Next artifact"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
        <h3 className="text-sm font-medium text-gray-900 truncate" title={title}>
          {title}
        </h3>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {showAddCommentButton && onAddComment && (
          <button
            type="button"
            onClick={onAddComment}
            className="flex min-h-11 items-center gap-1.5 rounded-lg bg-gray-100 px-2.5 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
            title="Add comment"
            aria-label="Add comment"
          >
            <MessageSquarePlus size={15} />
            <span className="hidden sm:inline">Comment</span>
          </button>
        )}
        {showImageCommentButton && onAddImageComment && (
          <button
            onClick={onAddImageComment}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            title="Comment on image"
            aria-label="Comment on image"
          >
            <MessageSquarePlus size={15} />
            <span className="hidden sm:inline">Comment</span>
          </button>
        )}

        {showCommentsButton && onOpenComments ? (
          <button
            type="button"
            onClick={onOpenComments}
            className="flex min-h-11 items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
            aria-label={`Open comments, ${commentCount} pending`}
          >
            <MessageSquare size={15} />
            <span className="hidden min-[390px]:inline">Comments</span>
            <span aria-live="polite">{commentCount}</span>
          </button>
        ) : commentCount > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg">
            <MessageSquare size={15} />
            <span>{commentCount}</span>
          </div>
        )}

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

'use client';

import { ArrowLeft, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import type { ArtifactCanvasItem } from '@/types';
import ArtifactCanvas from '@/components/chat/ArtifactCanvas';

interface MobileArtifactCanvasProps {
  artifact: ArtifactCanvasItem;
  onClose: () => void;
  siblings?: ArtifactCanvasItem[];
  onNavigate?: (index: number) => void;
}

export default function MobileArtifactCanvas({ artifact, onClose, siblings, onNavigate }: MobileArtifactCanvasProps) {
  const hasNav = Boolean(siblings && siblings.length > 1 && onNavigate);
  const currentIndex = siblings && siblings.length > 0
    ? siblings.findIndex((s) => s.artifactId === artifact.artifactId)
    : -1;
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const hasPrev = hasNav && safeIndex > 0;
  const hasNext = hasNav && siblings ? safeIndex < siblings.length - 1 : false;
  const indexText = hasNav && siblings ? `${safeIndex + 1} / ${siblings.length}` : undefined;

  const handlePrev = () => {
    if (hasPrev && onNavigate) onNavigate(safeIndex - 1);
  };
  const handleNext = () => {
    if (hasNext && onNavigate) onNavigate(safeIndex + 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white w-screen h-screen">
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-white shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onClose}
            className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          {hasNav && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={handlePrev}
                disabled={!hasPrev}
                className="p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                aria-label="Previous artifact"
              >
                <ChevronLeft size={18} />
              </button>
              {indexText && (
                <span className="text-xs text-gray-500 font-mono px-1 tabular-nums">{indexText}</span>
              )}
              <button
                onClick={handleNext}
                disabled={!hasNext}
                className="p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                aria-label="Next artifact"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
          <h3 className="text-sm font-medium text-gray-900 truncate" title={artifact.title}>
            {artifact.title}
          </h3>
        </div>

        {artifact.downloadUrl ? (
          <a
            href={artifact.downloadUrl}
            download
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
            aria-label="Download artifact"
          >
            <Download size={20} />
          </a>
        ) : null}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ArtifactCanvas
          artifact={artifact}
          onClose={onClose}
          threadId={null}
          siblings={siblings}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}

'use client';

import { useState, useRef } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import type { ArtifactCanvasItem } from '@/types';

interface ImageViewerProps {
  artifact: ArtifactCanvasItem;
  onAddImageComment?: () => void;
}

export default function ImageViewer({ artifact, onAddImageComment }: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale(prev => Math.min(Math.max(prev + delta, 0.5), 4));
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      className="relative w-full h-full overflow-auto flex items-center justify-center bg-gray-100 p-4"
    >
      {onAddImageComment && (
        <button
          onClick={onAddImageComment}
          className="absolute top-4 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white/90 hover:bg-white border border-gray-200 rounded-lg shadow-sm transition-colors"
          title="Comment on image"
          aria-label="Comment on image"
        >
          <MessageSquarePlus size={15} />
          <span className="hidden sm:inline">Comment on image</span>
        </button>
      )}
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <img
          src={artifact.downloadUrl}
          alt={artifact.title}
          onError={() => setError('Failed to load image')}
          style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
          className="max-w-full max-h-full object-contain shadow-lg transition-transform"
        />
      )}
    </div>
  );
}

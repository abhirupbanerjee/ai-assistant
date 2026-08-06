'use client';

import { useState, useRef } from 'react';
import type { ArtifactCanvasItem } from '@/types';

interface ImageViewerProps {
  artifact: ArtifactCanvasItem;
}

export default function ImageViewer({ artifact }: ImageViewerProps) {
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
      className="w-full h-full overflow-auto flex items-center justify-center bg-gray-100 p-4"
    >
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

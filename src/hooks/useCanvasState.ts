'use client';

import { useState, useCallback } from 'react';
import type { CanvasMode, ArtifactCanvasItem } from '@/types/artifact-canvas';

export interface CanvasState {
  mode: CanvasMode;
  artifact: ArtifactCanvasItem | null;
  openCanvas: (item: ArtifactCanvasItem) => void;
  closeCanvas: () => void;
}

export function useCanvasState(): CanvasState {
  const [mode, setMode] = useState<CanvasMode>('normal');
  const [artifact, setArtifact] = useState<ArtifactCanvasItem | null>(null);

  const openCanvas = useCallback((item: ArtifactCanvasItem) => {
    setArtifact(item);
    setMode('canvas');
  }, []);

  const closeCanvas = useCallback(() => {
    setMode('normal');
    setArtifact(null);
  }, []);

  return { mode, artifact, openCanvas, closeCanvas };
}

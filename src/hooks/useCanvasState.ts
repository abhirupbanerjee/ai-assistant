'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { CanvasMode, ArtifactCanvasItem } from '@/types/artifact-canvas';

export interface CanvasState {
  mode: CanvasMode;
  artifact: ArtifactCanvasItem | null;
  /** Ordered list of viewable artifacts for prev/next navigation. */
  siblings: ArtifactCanvasItem[];
  openCanvas: (item: ArtifactCanvasItem, siblings?: ArtifactCanvasItem[]) => void;
  closeCanvas: () => void;
  /** Navigate to a sibling by index (clamped to valid range). */
  navigateTo: (index: number) => void;
}

export function useCanvasState(): CanvasState {
  const [mode, setMode] = useState<CanvasMode>('normal');
  const [artifact, setArtifact] = useState<ArtifactCanvasItem | null>(null);
  const [siblings, setSiblings] = useState<ArtifactCanvasItem[]>([]);

  // Mirror siblings in a ref so navigateTo can read the current value without
  // nesting a setState call inside another setState updater (which violates
  // React's updater purity requirement and double-fires in StrictMode).
  const siblingsRef = useRef<ArtifactCanvasItem[]>([]);
  useEffect(() => {
    siblingsRef.current = siblings;
  }, [siblings]);

  const openCanvas = useCallback((item: ArtifactCanvasItem, list?: ArtifactCanvasItem[]) => {
    const next = list && list.length > 0 ? list : [item];
    siblingsRef.current = next;
    setArtifact(item);
    setSiblings(next);
    setMode('canvas');
  }, []);

  const closeCanvas = useCallback(() => {
    siblingsRef.current = [];
    setMode('normal');
    setArtifact(null);
    setSiblings([]);
  }, []);

  const navigateTo = useCallback((index: number) => {
    const currentSiblings = siblingsRef.current;
    if (currentSiblings.length === 0) return;
    const clamped = Math.max(0, Math.min(index, currentSiblings.length - 1));
    const next = currentSiblings[clamped];
    if (next) {
      setArtifact(next);
    }
  }, []);

  return { mode, artifact, siblings, openCanvas, closeCanvas, navigateTo };
}

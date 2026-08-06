'use client';

import type { ArtifactCanvasItem } from '@/types';

interface PdfViewerProps {
  artifact: ArtifactCanvasItem;
}

export default function PdfViewer({ artifact }: PdfViewerProps) {
  return (
    <iframe
      title={artifact.title}
      src={artifact.downloadUrl}
      className="w-full h-full border-0 bg-white"
    />
  );
}

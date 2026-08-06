'use client';

import type { ArtifactCanvasItem } from '@/types';

interface DriveEmbedViewerProps {
  artifact: ArtifactCanvasItem;
}

export default function DriveEmbedViewer({ artifact }: DriveEmbedViewerProps) {
  const embedUrl = artifact.embedUrl;

  if (!embedUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-gray-50">
        <p className="text-sm text-gray-600 mb-2">This file needs to be uploaded to Google Drive before it can be viewed inline.</p>
        <p className="text-xs text-gray-500">Drive upload consent is required.</p>
      </div>
    );
  }

  return (
    <iframe
      title={artifact.title}
      src={embedUrl}
      className="w-full h-full border-0 bg-white"
      allow="autoplay"
      sandbox="allow-scripts allow-same-origin allow-popups"
    />
  );
}

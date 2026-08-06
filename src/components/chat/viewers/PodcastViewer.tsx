'use client';

import PodcastPlayer from '../PodcastPlayer';
import type { ArtifactCanvasItem } from '@/types';

interface PodcastViewerProps {
  artifact: ArtifactCanvasItem;
}

export default function PodcastViewer({ artifact }: PodcastViewerProps) {
  const podcast = {
    id: artifact.artifactId,
    filename: artifact.title,
    duration: 0,
    format: 'mp3' as const,
    downloadUrl: artifact.downloadUrl,
    streamUrl: artifact.downloadUrl,
    expiresAt: null,
  };

  return (
    <div className="w-full h-full overflow-auto bg-gray-50 p-4 flex items-start justify-center">
      <div className="w-full max-w-2xl">
        <PodcastPlayer podcast={podcast} />
      </div>
    </div>
  );
}

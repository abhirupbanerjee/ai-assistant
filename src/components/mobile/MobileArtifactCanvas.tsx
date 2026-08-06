'use client';

import { ArrowLeft, Download } from 'lucide-react';
import type { ArtifactCanvasItem } from '@/types';
import ArtifactCanvas from '@/components/chat/ArtifactCanvas';

interface MobileArtifactCanvasProps {
  artifact: ArtifactCanvasItem;
  onClose: () => void;
}

export default function MobileArtifactCanvas({ artifact, onClose }: MobileArtifactCanvasProps) {
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
        <ArtifactCanvas artifact={artifact} onClose={onClose} threadId={null} />
      </div>
    </div>
  );
}

'use client';

import type { ArtifactCanvasItem, ArtifactComment } from '@/types';
import ArtifactCanvas from '@/components/chat/ArtifactCanvas';

interface MobileArtifactCanvasProps {
  artifact: ArtifactCanvasItem;
  onClose: () => void;
  threadId: string | null;
  siblings?: ArtifactCanvasItem[];
  onNavigate?: (index: number) => void;
  onSendComments?: (comments: ArtifactComment[]) => void;
}

export default function MobileArtifactCanvas({ artifact, onClose, threadId, siblings, onNavigate, onSendComments }: MobileArtifactCanvasProps) {
  return (
    <div className="fixed inset-0 z-50 flex h-dvh w-screen flex-col bg-white">
      <ArtifactCanvas
        artifact={artifact}
        onClose={onClose}
        threadId={threadId}
        siblings={siblings}
        onNavigate={onNavigate}
        onSendComments={onSendComments}
      />
    </div>
  );
}

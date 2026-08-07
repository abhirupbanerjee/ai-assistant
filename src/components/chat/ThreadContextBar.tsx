'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Cpu, FolderOpen } from 'lucide-react';
import type { Thread } from '@/types';

interface ThreadContextBarProps {
  thread: Thread | null;
}

interface ThreadModelResponse {
  selectedModel: string | null;
  effectiveModel: string;
  effectiveModelValid: boolean;
}

/**
 * Compact context sub-bar shown at the top of the chat window.
 * Displays the active thread title, effective model, and scoped categories.
 */
export default function ThreadContextBar({ thread }: ThreadContextBarProps) {
  const [effectiveModel, setEffectiveModel] = useState<string | null>(null);

  useEffect(() => {
    if (!thread) {
      setEffectiveModel(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/threads/${thread.id}/model`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ThreadModelResponse | null) => {
        if (cancelled || !data) return;
        setEffectiveModel(data.effectiveModel || null);
      })
      .catch(() => {
        if (!cancelled) setEffectiveModel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [thread]);

  if (!thread) return null;

  const categoryNames = thread.categories?.map((c) => c.name).filter(Boolean) ?? [];

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-gray-100 bg-white/80 backdrop-blur-sm text-xs text-gray-600 shrink-0 min-h-0">
      <span className="flex items-center gap-1.5 min-w-0">
        <MessageSquare size={13} className="text-gray-400 shrink-0" />
        <span className="font-medium text-gray-800 truncate max-w-[40%]" title={thread.title}>
          {thread.title}
        </span>
      </span>

      {effectiveModel && (
        <span className="flex items-center gap-1 shrink-0">
          <Cpu size={13} className="text-gray-400" />
          <span className="truncate max-w-[180px]" title={effectiveModel}>
            {effectiveModel}
          </span>
        </span>
      )}

      {categoryNames.length > 0 && (
        <span className="flex items-center gap-1.5 min-w-0 ml-auto">
          <FolderOpen size={13} className="text-gray-400 shrink-0" />
          <span className="truncate" title={categoryNames.join(', ')}>
            {categoryNames.join(' · ')}
          </span>
        </span>
      )}
    </div>
  );
}

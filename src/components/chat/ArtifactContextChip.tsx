'use client';

import { useState } from 'react';
import { MessageSquare, Image as ImageIcon, X } from 'lucide-react';
import type { ArtifactComment } from '@/types';

interface ArtifactContextChipProps {
  comment: ArtifactComment;
  index: number;
  total: number;
  onRemove?: (commentId: string) => void;
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '…';
}

export default function ArtifactContextChip({
  comment,
  index,
  total,
  onRemove,
}: ArtifactContextChipProps) {
  const [expanded, setExpanded] = useState(false);
  const isImage = Boolean(comment.imageUrl);
  const label = isImage
    ? `Image: ${comment.artifactTitle}`
    : comment.selectedText
      ? `“${truncate(comment.selectedText, 40)}”`
      : comment.artifactTitle;

  return (
    <div className="relative inline-flex items-center gap-1.5 max-w-full">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-gray-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-full transition-colors"
        title={comment.commentText}
      >
        {isImage ? <ImageIcon size={12} /> : <MessageSquare size={12} />}
        <span className="truncate">{label}</span>
        {total > 1 && (
          <span className="text-[10px] text-blue-500">{index + 1}/{total}</span>
        )}
      </button>

      {expanded && (
        <div className="absolute bottom-full left-0 mb-2 z-20 w-64 bg-white rounded-lg shadow-lg border border-gray-200 p-3 text-left">
          <p className="text-xs font-medium text-gray-900 mb-1">
            {comment.artifactTitle}
          </p>
          {comment.pageNumber && (
            <p className="text-[10px] text-gray-500 mb-1">Page {comment.pageNumber}</p>
          )}
          {comment.selectedText && (
            <p className="text-xs text-gray-600 italic mb-2 border-l-2 border-gray-300 pl-2">
              “{truncate(comment.selectedText, 180)}”
            </p>
          )}
          <p className="text-xs text-gray-800">{comment.commentText}</p>
        </div>
      )}

      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(comment.commentId)}
          className="text-gray-400 hover:text-red-600 p-0.5 rounded"
          aria-label="Remove artifact comment"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

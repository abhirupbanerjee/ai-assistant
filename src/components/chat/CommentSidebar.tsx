'use client';

import { MessageSquare, Image as ImageIcon, X, Send } from 'lucide-react';
import type { ArtifactComment } from '@/types';

interface CommentSidebarProps {
  comments: ArtifactComment[];
  onRemove: (commentId: string) => void;
  onSendAll: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '…';
}

export default function CommentSidebar({
  comments,
  onRemove,
  onSendAll,
  collapsed = false,
  onToggleCollapse,
}: CommentSidebarProps) {
  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        className="flex flex-col items-center gap-1 px-2 py-3 border-l bg-gray-50 hover:bg-gray-100 transition-colors"
        title="Show comments"
        aria-label="Show comments"
      >
        <MessageSquare size={18} className="text-gray-600" />
        {comments.length > 0 && (
          <span className="text-xs font-medium text-white bg-blue-600 rounded-full min-w-[18px] px-1 py-0.5 text-center">
            {comments.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="w-72 sm:w-80 flex flex-col h-full border-l bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h4 className="text-sm font-semibold text-gray-900">
          Comments {comments.length > 0 && `(${comments.length})`}
        </h4>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="text-gray-400 hover:text-gray-600 p-1"
            aria-label="Collapse comments"
          >
            <MessageSquare size={16} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {comments.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            Select text or add an image comment to get started.
          </div>
        ) : (
          comments.map((comment) => (
            <div
              key={comment.commentId}
              className="group bg-gray-50 rounded-lg p-3 border border-gray-100"
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 text-gray-400">
                  {comment.imageUrl ? <ImageIcon size={14} /> : <MessageSquare size={14} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 font-medium break-words">
                    {comment.commentText}
                  </p>
                  {comment.selectedText && (
                    <p className="mt-1.5 text-xs text-gray-500 italic border-l-2 border-gray-300 pl-2">
                      “{truncate(comment.selectedText, 140)}”
                    </p>
                  )}
                  {comment.pageNumber && (
                    <p className="mt-1 text-xs text-gray-400">Page {comment.pageNumber}</p>
                  )}
                </div>
                <button
                  onClick={() => onRemove(comment.commentId)}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 p-0.5 rounded transition-opacity"
                  aria-label="Remove comment"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t bg-white">
        <button
          onClick={onSendAll}
          disabled={comments.length === 0}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          <Send size={15} />
          Send All {comments.length > 0 && `(${comments.length})`}
        </button>
      </div>
    </div>
  );
}

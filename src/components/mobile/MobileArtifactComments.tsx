'use client';

import { ArrowLeft, Image as ImageIcon, MessageSquare, Send, X } from 'lucide-react';
import type { ArtifactComment } from '@/types';

interface MobileArtifactCommentsProps {
  comments: ArtifactComment[];
  onRemove: (commentId: string) => void;
  onBackToDocument: () => void;
  onSendAll: () => void;
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

/**
 * Full-screen mobile comment review. It intentionally has no artifact viewer:
 * mobile users either read the artifact or review comments, never both at once.
 */
export default function MobileArtifactComments({
  comments,
  onRemove,
  onBackToDocument,
  onSendAll,
}: MobileArtifactCommentsProps) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-white" aria-labelledby="mobile-artifact-comments-title">
      <header className="flex shrink-0 items-center gap-2 border-b bg-white px-3 py-2">
        <button
          type="button"
          onClick={onBackToDocument}
          className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
          aria-label="Back to document"
        >
          <ArrowLeft size={18} />
          <span>Document</span>
        </button>
        <h2 id="mobile-artifact-comments-title" tabIndex={-1} className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
          Comments ({comments.length})
        </h2>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
        {comments.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            Select text or add an artifact comment to get started.
          </div>
        ) : (
          comments.map((comment) => (
            <article key={comment.commentId} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 text-gray-400" aria-hidden="true">
                  {comment.imageUrl ? <ImageIcon size={15} /> : <MessageSquare size={15} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium text-gray-900">{comment.commentText}</p>
                  {comment.selectedText && (
                    <p className="mt-1.5 border-l-2 border-gray-300 pl-2 text-xs italic text-gray-500">
                      “{truncate(comment.selectedText, 180)}”
                    </p>
                  )}
                  {comment.pageNumber && <p className="mt-1 text-xs text-gray-400">Page {comment.pageNumber}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(comment.commentId)}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white hover:text-red-600"
                  aria-label="Remove comment"
                >
                  <X size={17} />
                </button>
              </div>
            </article>
          ))
        )}
      </div>

      <footer className="shrink-0 border-t bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onSendAll}
          disabled={comments.length === 0}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send size={16} />
          Send all{comments.length > 0 ? ` (${comments.length})` : ''}
        </button>
      </footer>
    </section>
  );
}

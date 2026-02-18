'use client';

/**
 * Workspace Thread Sidebar
 *
 * Displays list of threads for standalone workspace mode.
 */

import { useState } from 'react';
import { Plus, MessageSquare, Archive, MoreVertical, Trash2, Edit2, Download } from 'lucide-react';
import type { WorkspaceThread } from '@/types/workspace';

interface WorkspaceThreadSidebarProps {
  threads: WorkspaceThread[];
  activeThreadId: string | null;
  isLoading: boolean;
  primaryColor: string;
  workspaceSlug: string;
  sessionId: string;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onRenameThread?: (threadId: string, newTitle: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onArchiveThread?: (threadId: string) => void;
}

export function WorkspaceThreadSidebar({
  threads,
  activeThreadId,
  isLoading,
  primaryColor,
  workspaceSlug,
  sessionId,
  onSelectThread,
  onNewThread,
  onRenameThread,
  onDeleteThread,
  onArchiveThread,
}: WorkspaceThreadSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const handleStartEdit = (thread: WorkspaceThread) => {
    setEditingId(thread.id);
    setEditTitle(thread.title);
    setMenuOpenId(null);
  };

  const handleSaveEdit = (threadId: string) => {
    if (editTitle.trim() && onRenameThread) {
      onRenameThread(threadId, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle('');
  };

  const handleKeyDown = (e: React.KeyboardEvent, threadId: string) => {
    if (e.key === 'Enter') {
      handleSaveEdit(threadId);
    } else if (e.key === 'Escape') {
      setEditingId(null);
      setEditTitle('');
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 border-r border-gray-200">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <button
          onClick={onNewThread}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white font-medium transition-colors hover:opacity-90"
          style={{ backgroundColor: primaryColor }}
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div
              className="w-6 h-6 border-2 border-gray-300 border-t-current rounded-full animate-spin"
              style={{ borderTopColor: primaryColor }}
            />
          </div>
        ) : threads.length === 0 ? (
          <div className="text-center py-8 px-4 text-gray-500 text-sm">
            No conversations yet.
            <br />
            Start a new chat to begin.
          </div>
        ) : (
          <div className="py-2">
            {threads.map((thread) => (
              <div
                key={thread.id}
                className={`group relative mx-2 mb-1 rounded-lg transition-colors ${
                  activeThreadId === thread.id
                    ? 'bg-white shadow-sm border border-gray-200'
                    : 'hover:bg-white/60'
                }`}
              >
                {editingId === thread.id ? (
                  <div className="p-3">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => handleSaveEdit(thread.id)}
                      onKeyDown={(e) => handleKeyDown(e, thread.id)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => onSelectThread(thread.id)}
                    className="w-full text-left p-3"
                  >
                    <div className="flex items-start gap-3">
                      <MessageSquare
                        className="w-4 h-4 mt-0.5 flex-shrink-0"
                        style={{ color: activeThreadId === thread.id ? primaryColor : '#9ca3af' }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-sm font-medium truncate ${
                              activeThreadId === thread.id ? 'text-gray-900' : 'text-gray-700'
                            }`}
                          >
                            {thread.title}
                          </span>
                          <span className="text-xs text-gray-400 flex-shrink-0">
                            {formatDate(thread.updated_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                )}

                {/* Actions menu */}
                {editingId !== thread.id && (onRenameThread || onDeleteThread || onArchiveThread) && (
                  <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === thread.id ? null : thread.id);
                      }}
                      className="p-1 rounded hover:bg-gray-100"
                    >
                      <MoreVertical className="w-4 h-4 text-gray-400" />
                    </button>

                    {menuOpenId === thread.id && (
                      <div className="absolute right-0 top-8 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10 min-w-[140px]">
                        {onRenameThread && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartEdit(thread);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <Edit2 className="w-4 h-4" />
                            Rename
                          </button>
                        )}
                        {onArchiveThread && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onArchiveThread(thread.id);
                              setMenuOpenId(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <Archive className="w-4 h-4" />
                            Archive
                          </button>
                        )}
                        <a
                          href={`/api/w/${workspaceSlug}/threads/${thread.id}/export?sessionId=${sessionId}`}
                          download
                          onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          <Download className="w-4 h-4" />
                          Export as Markdown
                        </a>
                        {onDeleteThread && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteThread(thread.id);
                              setMenuOpenId(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

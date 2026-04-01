'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, MessageSquare, Trash2, Settings, LogOut, Brain, BookOpen, Star,
  Download, Home
} from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import type { Thread } from '@/types';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import MobileMenuDrawer from '@/components/ui/MobileMenuDrawer';
import CategorySelector from '@/components/ui/CategorySelector';
import { useMobileMenu } from '@/contexts/MobileMenuContext';

// Color palette for category badges
const CATEGORY_COLORS = [
  { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
  { bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-200' },
  { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-200' },
  { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200' },
];

const getCategoryColor = (categoryId: number) => {
  return CATEGORY_COLORS[categoryId % CATEGORY_COLORS.length];
};

interface MobileThreadsMenuProps {
  onThreadSelect: (thread: Thread | null) => void;
  onThreadCreated: (thread: Thread) => void;
  selectedThreadId?: string | null;
}

export default function MobileThreadsMenu({
  onThreadSelect,
  onThreadCreated,
  selectedThreadId,
}: MobileThreadsMenuProps) {
  const { data: session } = useSession();
  const { isThreadsMenuOpen, closeThreadsMenu } = useMobileMenu();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteThread, setDeleteThread] = useState<Thread | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showNewThreadModal, setShowNewThreadModal] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [newThreadCategories, setNewThreadCategories] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [availableCategories, setAvailableCategories] = useState<{id: number; name: string}[]>([]);

  const userRole = (session?.user as { role?: string })?.role;
  const isAdmin = userRole === 'admin';
  const isSuperUser = userRole === 'superuser';
  const isRegularUser = userRole === 'user';
  const requiresSingleCategory = isRegularUser;

  const loadThreads = useCallback(async () => {
    try {
      const response = await fetch('/api/threads');
      if (response.ok) {
        const data = await response.json();
        setThreads(data.threads.map((t: Thread) => ({
          ...t,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
        })));
      }
    } catch (err) {
      console.error('Failed to load threads:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isThreadsMenuOpen) {
      loadThreads();
    }
  }, [isThreadsMenuOpen, loadThreads]);

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const response = await fetch('/api/user/categories');
        if (response.ok) {
          const data = await response.json();
          setAvailableCategories(data.categories || []);
        }
      } catch (err) {
        console.error('Failed to load categories:', err);
      }
    };
    loadCategories();
  }, []);

  const handleSelectThread = (thread: Thread) => {
    onThreadSelect(thread);
    closeThreadsMenu();
  };

  const createNewThread = async () => {
    setCreating(true);
    try {
      const body: { title?: string; categoryIds?: number[] } = {};
      if (newThreadTitle.trim()) body.title = newThreadTitle.trim();
      if (newThreadCategories.length > 0) body.categoryIds = newThreadCategories;

      const response = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const thread = await response.json();
        const newThread = {
          ...thread,
          createdAt: new Date(thread.createdAt),
          updatedAt: new Date(thread.updatedAt),
        };
        setThreads((prev) => [newThread, ...prev]);
        onThreadSelect(newThread);
        onThreadCreated(newThread);
        setShowNewThreadModal(false);
        closeThreadsMenu();
      }
    } catch (err) {
      console.error('Failed to create thread:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteThread) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/threads/${deleteThread.id}`, { method: 'DELETE' });
      if (response.ok) {
        setThreads((prev) => prev.filter((t) => t.id !== deleteThread.id));
        if (selectedThreadId === deleteThread.id) {
          onThreadSelect(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete thread:', err);
    } finally {
      setDeleting(false);
      setDeleteThread(null);
    }
  };

  const handleTogglePin = async (thread: Thread, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch(`/api/threads/${thread.id}/pin`, { method: 'POST' });
      if (response.ok) {
        const updatedThread = await response.json();
        setThreads((prev) =>
          prev.map((t) => t.id === thread.id ? { ...t, isPinned: updatedThread.isPinned } : t)
        );
      }
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'long' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const filteredThreads = selectedCategoryId === null
    ? threads
    : threads.filter(thread => thread.categories?.some(cat => cat.id === selectedCategoryId));

  const pinnedThreads = filteredThreads.filter(t => t.isPinned);
  const otherThreads = filteredThreads.filter(t => !t.isPinned);

  return (
    <>
      <MobileMenuDrawer
        isOpen={isThreadsMenuOpen}
        onClose={closeThreadsMenu}
        title="Threads"
        side="left"
        headerRight={
          <div className="flex items-center gap-1">
            <Link
              href="/chat"
              onClick={closeThreadsMenu}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              style={{ color: 'var(--accent-color)' }}
            >
              <Home size={20} />
            </Link>
            <button
              onClick={() => {
                setNewThreadTitle('');
                setNewThreadCategories([]);
                setShowNewThreadModal(true);
              }}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              style={{ color: 'var(--accent-color)' }}
            >
              <Plus size={20} />
            </button>
          </div>
        }
      >
        {/* Category Filter */}
        {availableCategories.length > 0 && (
          <div className="px-4 py-2 border-b">
            <select
              value={selectedCategoryId ?? ''}
              onChange={(e) => setSelectedCategoryId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Categories</option>
              {availableCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-pulse text-gray-400">Loading...</div>
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No threads yet</p>
              <p className="text-xs">Start a new conversation</p>
            </div>
          ) : (
            <>
              {/* Pinned */}
              {pinnedThreads.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-xs font-medium text-gray-500 uppercase px-2 mb-2 flex items-center gap-1">
                    <Star size={12} className="fill-yellow-400 text-yellow-400" />
                    Favorites
                  </h3>
                  <div className="space-y-1">
                    {pinnedThreads.map((thread) => (
                      <ThreadItem
                        key={thread.id}
                        thread={thread}
                        isSelected={selectedThreadId === thread.id}
                        onSelect={() => handleSelectThread(thread)}
                        onTogglePin={(e) => handleTogglePin(thread, e)}

                        onDelete={() => setDeleteThread(thread)}
                        formatDate={formatDate}
                        getCategoryColor={getCategoryColor}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Others */}
              {otherThreads.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-xs font-medium text-gray-500 uppercase px-2 mb-2">
                    {pinnedThreads.length > 0 ? 'Others' : 'Recent'}
                  </h3>
                  <div className="space-y-1">
                    {otherThreads.map((thread) => (
                      <ThreadItem
                        key={thread.id}
                        thread={thread}
                        isSelected={selectedThreadId === thread.id}
                        onSelect={() => handleSelectThread(thread)}
                        onTogglePin={(e) => handleTogglePin(thread, e)}

                        onDelete={() => setDeleteThread(thread)}
                        formatDate={formatDate}
                        getCategoryColor={getCategoryColor}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 space-y-2">
          {isAdmin && (
            <Link href="/admin" onClick={closeThreadsMenu} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
              <Settings size={16} />
              Admin Dashboard
            </Link>
          )}
          {isSuperUser && (
            <Link href="/superuser" onClick={closeThreadsMenu} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
              <Settings size={16} />
              Manage
            </Link>
          )}
          {session?.user && (
            <Link href="/profile" onClick={closeThreadsMenu} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
              <Brain size={16} />
              Your Memory
            </Link>
          )}
          {session?.user && (
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-medium text-sm shrink-0">
                  {session.user.name?.[0] || session.user.email?.[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {session.user.name || session.user.email?.split('@')[0]}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{session.user.email}</p>
                </div>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: '/auth/signin' })}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                title="Sign out"
              >
                <LogOut size={16} />
              </button>
            </div>
          )}
        </div>
      </MobileMenuDrawer>

      {/* Delete Modal */}
      <Modal isOpen={!!deleteThread} onClose={() => setDeleteThread(null)} title="Delete Thread?">
        <p className="text-gray-600 mb-4">
          Are you sure you want to delete &quot;{deleteThread?.title}&quot;?
        </p>
        <p className="text-sm text-gray-500 mb-6">
          This will permanently remove all messages and documents. This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleteThread(null)} disabled={deleting}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} loading={deleting}>Delete</Button>
        </div>
      </Modal>

      {/* New Thread Modal */}
      <Modal isOpen={showNewThreadModal} onClose={() => setShowNewThreadModal(false)} title="New Thread" allowOverflow>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title (optional)</label>
            <input
              type="text"
              value={newThreadTitle}
              onChange={(e) => setNewThreadTitle(e.target.value)}
              placeholder="New Thread"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category{requiresSingleCategory ? ' *' : ' (optional)'}
            </label>
            <CategorySelector
              selectedIds={newThreadCategories}
              onChange={setNewThreadCategories}
              placeholder={requiresSingleCategory ? 'Select a category...' : 'All available documents'}
              singleSelect={requiresSingleCategory}
            />
            {requiresSingleCategory && newThreadCategories.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">You must select a category to create a thread</p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={() => setShowNewThreadModal(false)} disabled={creating}>Cancel</Button>
          <Button onClick={createNewThread} loading={creating} disabled={requiresSingleCategory && newThreadCategories.length === 0}>
            Create Thread
          </Button>
        </div>
      </Modal>
    </>
  );
}

// Thread item component
interface ThreadItemProps {
  thread: Thread;
  isSelected: boolean;
  onSelect: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
  onDelete: () => void;
  formatDate: (date: Date) => string;
  getCategoryColor: (id: number) => { bg: string; text: string; border: string };
}

function ThreadItem({
  thread,
  isSelected,
  onSelect,
  onTogglePin,
  onDelete,
  formatDate,
  getCategoryColor,
}: ThreadItemProps) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer ${
        isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100 text-gray-700'
      }`}
      onClick={onSelect}
    >
      <MessageSquare size={16} className="shrink-0 opacity-50" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{thread.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-gray-500">{formatDate(thread.updatedAt)}</span>
          {thread.isSummarized && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-blue-50 text-blue-600 rounded text-[9px] font-medium">
              <BookOpen size={10} />
              <span>Summarized</span>
            </span>
          )}
        </div>
        {thread.categories && thread.categories.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {thread.categories.map((cat) => {
              const colors = getCategoryColor(cat.id);
              return (
                <span key={cat.id} className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${colors.bg} ${colors.text} ${colors.border}`}>
                  {cat.name}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onTogglePin}
          className={`p-1 rounded ${thread.isPinned ? 'text-yellow-500' : 'text-gray-400'}`}
        >
          <Star size={14} className={thread.isPinned ? 'fill-current' : ''} />
        </button>
        <a
          href={`/api/threads/${thread.id}/export`}
          download
          onClick={(e) => e.stopPropagation()}
          className="p-1 text-gray-400"
        >
          <Download size={14} />
        </a>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 text-gray-400">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

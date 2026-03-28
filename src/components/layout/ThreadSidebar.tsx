'use client';

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  Plus, MessageSquare, Trash2, Settings, LogOut, Brain, BookOpen, Star,
  PanelLeftClose, PanelLeftOpen, Download, ChevronDown, ChevronRight, Search, X
} from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import type { Thread } from '@/types';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import CategorySelector from '@/components/ui/CategorySelector';
import { useResizableSidebar } from '@/hooks/useResizableSidebar';
import ResizeHandle from '@/components/ui/ResizeHandle';

// Color palette for subscription badges
const SUBSCRIPTION_COLORS = [
  { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
  { bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-200' },
  { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-200' },
  { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200' },
  { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-200' },
  { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-200' },
];

// Get consistent color for a category based on its ID
const getCategoryColor = (categoryId: number) => {
  return SUBSCRIPTION_COLORS[categoryId % SUBSCRIPTION_COLORS.length];
};

// Date grouping helpers
type DateGroup = 'today' | 'yesterday' | 'lastWeek' | 'lastMonth' | 'older';

const DATE_GROUP_LABELS: Record<DateGroup, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  lastWeek: 'Last Week',
  lastMonth: 'Last Month',
  older: 'Older',
};

const DATE_GROUP_ORDER: DateGroup[] = ['today', 'yesterday', 'lastWeek', 'lastMonth', 'older'];

const getDateGroup = (date: Date): DateGroup => {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'lastWeek';
  if (days < 30) return 'lastMonth';
  return 'older';
};

const groupThreadsByDate = (threads: Thread[]): Record<DateGroup, Thread[]> => {
  const groups: Record<DateGroup, Thread[]> = {
    today: [], yesterday: [], lastWeek: [], lastMonth: [], older: [],
  };
  threads.forEach(thread => {
    groups[getDateGroup(thread.updatedAt)].push(thread);
  });
  return groups;
};

interface ThreadSidebarProps {
  onThreadSelect?: (thread: Thread | null) => void;
  onThreadCreated?: (thread: Thread) => void;
  selectedThreadId?: string | null;
  hidden?: boolean; // For mobile: hide when input is focused
}

export interface ThreadSidebarRef {
  setCollapsed: (collapsed: boolean) => void;
}

const ThreadSidebar = forwardRef<ThreadSidebarRef, ThreadSidebarProps>(function ThreadSidebar({
  onThreadSelect,
  onThreadCreated,
  selectedThreadId,
  hidden = false,
}, ref) {
  const { data: session } = useSession();
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
  const [searchQuery, setSearchQuery] = useState('');

  // Section collapse state with localStorage persistence
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sidebar-favorites-collapsed') === 'true';
    }
    return false;
  });
  const [othersCollapsed, setOthersCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sidebar-others-collapsed') === 'true';
    }
    return false;
  });
  const [collapsedDateGroups, setCollapsedDateGroups] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      try {
        return JSON.parse(localStorage.getItem('sidebar-collapsed-date-groups') || '{}');
      } catch { return {}; }
    }
    return {};
  });

  // Resizable sidebar hook - handles width and collapsed state
  const {
    width,
    isCollapsed,
    isResizing,
    setIsCollapsed,
    handleMouseDown,
  } = useResizableSidebar({
    storageKeyPrefix: 'thread-sidebar',
    defaultWidth: 288,
    minWidth: 200,
    maxWidth: 500,
    collapseThreshold: 120,
    side: 'left',
  });

  // Expose setCollapsed for external control (e.g. swipe gestures)
  useImperativeHandle(ref, () => ({
    setCollapsed: (collapsed: boolean) => setIsCollapsed(collapsed),
  }), [setIsCollapsed]);

  const userRole = (session?.user as { role?: string })?.role;
  const isAdmin = userRole === 'admin';
  const isSuperUser = userRole === 'superuser';
  const isRegularUser = userRole === 'user';

  // Regular users must select exactly one category per thread
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
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    localStorage.setItem('sidebar-favorites-collapsed', String(favoritesCollapsed));
  }, [favoritesCollapsed]);

  useEffect(() => {
    localStorage.setItem('sidebar-others-collapsed', String(othersCollapsed));
  }, [othersCollapsed]);

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed-date-groups', JSON.stringify(collapsedDateGroups));
  }, [collapsedDateGroups]);

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

  const openNewThreadModal = () => {
    setNewThreadTitle('');
    setNewThreadCategories([]);
    setShowNewThreadModal(true);
  };

  const createNewThread = async () => {
    setCreating(true);
    try {
      const body: { title?: string; categoryIds?: number[] } = {};
      if (newThreadTitle.trim()) {
        body.title = newThreadTitle.trim();
      }
      if (newThreadCategories.length > 0) {
        body.categoryIds = newThreadCategories;
      }

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
        onThreadSelect?.(newThread);
        onThreadCreated?.(newThread);
        setShowNewThreadModal(false);
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
      const response = await fetch(`/api/threads/${deleteThread.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setThreads((prev) => prev.filter((t) => t.id !== deleteThread.id));
        if (selectedThreadId === deleteThread.id) {
          onThreadSelect?.(null);
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
      const response = await fetch(`/api/threads/${thread.id}/pin`, {
        method: 'POST',
      });

      if (response.ok) {
        const updatedThread = await response.json();
        setThreads((prev) =>
          prev.map((t) =>
            t.id === thread.id ? { ...t, isPinned: updatedThread.isPinned } : t
          )
        );
      }
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const toggleDateGroup = (section: 'favorites' | 'others', group: DateGroup) => {
    const key = `${section}-${group}`;
    setCollapsedDateGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const isDateGroupCollapsed = (section: 'favorites' | 'others', group: DateGroup) => {
    return collapsedDateGroups[`${section}-${group}`] ?? false;
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'long' });
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    }
  };

  // Apply category filter
  const filteredThreads = selectedCategoryId === null
    ? threads
    : threads.filter(thread =>
        thread.categories?.some(cat => cat.id === selectedCategoryId)
      );

  // Apply search filter
  const searchedThreads = searchQuery.trim()
    ? filteredThreads.filter(thread =>
        thread.title.toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : filteredThreads;

  // Then apply pin grouping
  const pinnedThreads = searchedThreads.filter(t => t.isPinned);
  const otherThreads = searchedThreads.filter(t => !t.isPinned);

  // Hidden state (mobile input focused)
  if (hidden) {
    return null;
  }

  // Collapsed view
  if (isCollapsed) {
    return (
      <>
        <aside className="w-14 bg-white border-r flex flex-col shrink-0 h-full items-center py-4 gap-3">
          <button
            onClick={() => setIsCollapsed(false)}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Expand threads panel"
          >
            <PanelLeftOpen size={20} />
          </button>

          {/* New thread button */}
          <button
            onClick={openNewThreadModal}
            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="New thread"
          >
            <Plus size={20} />
          </button>

          {/* Thread count */}
          {threads.length > 0 && (
            <div className="flex flex-col items-center gap-1">
              <MessageSquare size={16} className="text-gray-400" />
              <span className="text-xs font-medium text-gray-600">{threads.length}</span>
            </div>
          )}
        </aside>

        {/* New Thread modal (still needed when collapsed) */}
        <Modal
          isOpen={showNewThreadModal}
          onClose={() => setShowNewThreadModal(false)}
          title="New Thread"
          allowOverflow
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="thread-title" className="block text-sm font-medium text-gray-700 mb-1">
                Title (optional)
              </label>
              <input
                id="thread-title"
                type="text"
                value={newThreadTitle}
                onChange={(e) => setNewThreadTitle(e.target.value)}
                placeholder="New Thread"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category{requiresSingleCategory ? ' *' : ' (optional)'}
              </label>
              <p className="text-xs text-gray-500 mb-2">
                {requiresSingleCategory
                  ? 'Select a category for this thread'
                  : 'Select categories to scope RAG queries for this thread'}
              </p>
              <CategorySelector
                selectedIds={newThreadCategories}
                onChange={setNewThreadCategories}
                placeholder={requiresSingleCategory ? 'Select a category...' : 'All available documents'}
                singleSelect={requiresSingleCategory}
              />
              {requiresSingleCategory && newThreadCategories.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  You must select a category to create a thread
                </p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button
              variant="secondary"
              onClick={() => setShowNewThreadModal(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={createNewThread}
              loading={creating}
              disabled={requiresSingleCategory && newThreadCategories.length === 0}
            >
              Create Thread
            </Button>
          </div>
        </Modal>
      </>
    );
  }

  // Expanded view
  return (
    <>
      {/* Sidebar */}
      <aside
        className="bg-white border-r flex flex-col shrink-0 h-full relative"
        style={{ width: `${width}px` }}
      >
        {/* Resize handle - desktop only */}
        <div className="hidden md:block">
          <ResizeHandle
            side="right"
            onMouseDown={handleMouseDown}
            isResizing={isResizing}
          />
        </div>
        {/* Header with collapse button */}
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <span className="font-medium text-gray-900">Threads</span>
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title="Collapse panel"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        {/* New Thread Button */}
        <div className="p-4 border-b">
          <Button onClick={openNewThreadModal} className="w-full">
            <Plus size={18} className="mr-2" />
            New Thread
          </Button>
        </div>

        {/* Category Filter Dropdown */}
        {availableCategories.length > 0 && (
          <div className="px-4 py-2 border-b">
            <select
              value={selectedCategoryId ?? ''}
              onChange={(e) => setSelectedCategoryId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Categories</option>
              {availableCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Search Input */}
        <div className="px-4 py-2 border-b">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search threads..."
              className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-pulse text-gray-400">Loading...</div>
            </div>
          ) : searchedThreads.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {searchQuery ? (
                <>
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No threads matching &quot;{searchQuery}&quot;</p>
                  <button
                    onClick={() => setSearchQuery('')}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-700 underline"
                  >
                    Clear search
                  </button>
                </>
              ) : (
                <>
                  <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  {selectedCategoryId ? (
                    <>
                      <p className="text-sm">No threads in this category</p>
                      <button
                        onClick={() => setSelectedCategoryId(null)}
                        className="mt-2 text-xs text-blue-600 hover:text-blue-700 underline"
                      >
                        Show all categories
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm">No threads yet</p>
                      <p className="text-xs">Start a new conversation</p>
                    </>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              {/* Render thread item */}
              {(() => {
                const renderThread = (thread: Thread) => (
                  <div
                    key={thread.id}
                    className={`
                      group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer
                      ${selectedThreadId === thread.id
                        ? 'bg-blue-50 text-blue-700'
                        : 'hover:bg-gray-100 text-gray-700'
                      }
                    `}
                    onClick={() => onThreadSelect?.(thread)}
                  >
                    <MessageSquare size={16} className="shrink-0 opacity-50" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{thread.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-gray-500">{formatDate(thread.updatedAt)}</span>
                        {thread.isSummarized && (
                          <span className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-blue-50 text-blue-600 rounded text-[9px] font-medium" title="This thread has been summarized">
                            <BookOpen size={10} />
                            <span>Summarized</span>
                          </span>
                        )}
                      </div>
                      {thread.categories && thread.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {thread.categories.map((category) => {
                            const colors = getCategoryColor(category.id);
                            return (
                              <span
                                key={category.id}
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${colors.bg} ${colors.text} ${colors.border}`}
                                title={category.name}
                              >
                                {category.name}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={(e) => handleTogglePin(thread, e)}
                        className={`p-1 rounded transition-colors ${
                          thread.isPinned
                            ? 'text-yellow-500 hover:text-yellow-600'
                            : 'text-gray-400 hover:text-yellow-500'
                        }`}
                        title={thread.isPinned ? 'Unpin thread' : 'Pin thread'}
                      >
                        <Star size={14} className={thread.isPinned ? 'fill-current' : ''} />
                      </button>
                      <a
                        href={`/api/threads/${thread.id}/export`}
                        download
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 text-gray-400 hover:text-green-600 rounded"
                        title="Export as Markdown"
                      >
                        <Download size={14} />
                      </a>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteThread(thread); }}
                        className="p-1 text-gray-400 hover:text-red-600 rounded"
                        title="Delete thread"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );

                const renderDateGroups = (threads: Thread[], section: 'favorites' | 'others') => {
                  const grouped = groupThreadsByDate(threads);
                  return DATE_GROUP_ORDER.map(group => {
                    const groupThreads = grouped[group];
                    if (groupThreads.length === 0) return null;
                    const collapsed = isDateGroupCollapsed(section, group);
                    return (
                      <div key={group}>
                        <button
                          onClick={() => toggleDateGroup(section, group)}
                          className="w-full flex items-center gap-1 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          {collapsed
                            ? <ChevronRight size={10} className="shrink-0" />
                            : <ChevronDown size={10} className="shrink-0" />
                          }
                          <span>{DATE_GROUP_LABELS[group]}</span>
                          <span className="ml-auto">({groupThreads.length})</span>
                        </button>
                        {!collapsed && (
                          <div className="space-y-1">
                            {groupThreads.map(renderThread)}
                          </div>
                        )}
                      </div>
                    );
                  });
                };

                return (
                  <>
                    {/* Pinned Threads Section */}
                    {pinnedThreads.length > 0 && (
                      <div className="mb-4">
                        <button
                          onClick={() => setFavoritesCollapsed(!favoritesCollapsed)}
                          className="w-full flex items-center gap-1 px-2 mb-1 mt-3 text-xs font-medium text-gray-500 uppercase hover:text-gray-700 transition-colors"
                        >
                          {favoritesCollapsed
                            ? <ChevronRight size={12} className="shrink-0" />
                            : <ChevronDown size={12} className="shrink-0" />
                          }
                          <Star size={12} className="fill-yellow-400 text-yellow-400" />
                          Favorites
                          <span className="text-[10px] text-gray-400 normal-case ml-1">
                            ({pinnedThreads.length})
                          </span>
                        </button>
                        {!favoritesCollapsed && (
                          <div className="space-y-1">
                            {renderDateGroups(pinnedThreads, 'favorites')}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Other Threads Section */}
                    {otherThreads.length > 0 && (
                      <div className="mb-4">
                        <button
                          onClick={() => setOthersCollapsed(!othersCollapsed)}
                          className="w-full flex items-center gap-1 px-2 mb-1 mt-3 text-xs font-medium text-gray-500 uppercase hover:text-gray-700 transition-colors"
                        >
                          {othersCollapsed
                            ? <ChevronRight size={12} className="shrink-0" />
                            : <ChevronDown size={12} className="shrink-0" />
                          }
                          {pinnedThreads.length > 0 ? 'Others' : 'Recent'}
                          <span className="text-[10px] text-gray-400 normal-case ml-1">
                            ({otherThreads.length})
                          </span>
                        </button>
                        {!othersCollapsed && (
                          <div className="space-y-1">
                            {renderDateGroups(otherThreads, 'others')}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </div>

        {/* Footer with user info and admin link */}
        <div className="border-t p-4 space-y-2">
          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Settings size={16} />
              Admin Dashboard
            </Link>
          )}
          {isSuperUser && (
            <Link
              href="/superuser"
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Settings size={16} />
              Manage
            </Link>
          )}
          {session?.user && (
            <Link
              href="/profile"
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
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
      </aside>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={!!deleteThread}
        onClose={() => setDeleteThread(null)}
        title="Delete Thread?"
      >
        <p className="text-gray-600 mb-4">
          Are you sure you want to delete &quot;{deleteThread?.title}&quot;?
        </p>
        <p className="text-sm text-gray-500 mb-6">
          This will permanently remove all messages and uploaded documents.
          This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => setDeleteThread(null)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            loading={deleting}
          >
            Delete
          </Button>
        </div>
      </Modal>

      {/* New Thread modal */}
      <Modal
        isOpen={showNewThreadModal}
        onClose={() => setShowNewThreadModal(false)}
        title="New Thread"
        allowOverflow
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="thread-title" className="block text-sm font-medium text-gray-700 mb-1">
              Title (optional)
            </label>
            <input
              id="thread-title"
              type="text"
              value={newThreadTitle}
              onChange={(e) => setNewThreadTitle(e.target.value)}
              placeholder="New Thread"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category{requiresSingleCategory ? ' *' : ' (optional)'}
            </label>
            <p className="text-xs text-gray-500 mb-2">
              {requiresSingleCategory
                ? 'Select a category for this thread'
                : 'Select categories to scope RAG queries for this thread'}
            </p>
            <CategorySelector
              selectedIds={newThreadCategories}
              onChange={setNewThreadCategories}
              placeholder={requiresSingleCategory ? 'Select a category...' : 'All available documents'}
              singleSelect={requiresSingleCategory}
            />
            {requiresSingleCategory && newThreadCategories.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">
                You must select a category to create a thread
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button
            variant="secondary"
            onClick={() => setShowNewThreadModal(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button
            onClick={createNewThread}
            loading={creating}
            disabled={requiresSingleCategory && newThreadCategories.length === 0}
          >
            Create Thread
          </Button>
        </div>
      </Modal>
    </>
  );
});

export default ThreadSidebar;

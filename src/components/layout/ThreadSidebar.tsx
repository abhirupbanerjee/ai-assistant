'use client';

import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  Plus, MessageSquare, Trash2, Settings, LogOut, User, Users, BookOpen, Star,
  PanelLeftClose, PanelLeftOpen, Download, ChevronDown, ChevronRight, Search, X, FolderOpen,
  HelpCircle
} from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import type { Thread } from '@/types';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import CategorySelector from '@/components/ui/CategorySelector';
import BotIcon from '@/components/ui/BotIcon';
import {
  useThreadGroups,
  loadCollapsedGroups,
  saveCollapsedGroups,
  MAX_THREADS_PER_GROUP,
  type ThreadGroup,
} from '@/hooks/useThreadGroups';

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

interface ThreadSidebarProps {
  onThreadSelect?: (thread: Thread | null) => void;
  onThreadCreated?: (thread: Thread) => void;
  onThreadDeleted?: () => void;
  selectedThreadId?: string | null;
  hidden?: boolean; // For mobile: hide when input is focused
  collapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
  brandingName: string;
  brandingBotIcon: string;
  onHomeClick: () => void;
}

export interface ThreadSidebarRef {
  setCollapsed: (collapsed: boolean) => void;
}

const ThreadSidebar = forwardRef<ThreadSidebarRef, ThreadSidebarProps>(function ThreadSidebar({
  onThreadSelect,
  onThreadCreated,
  onThreadDeleted,
  selectedThreadId,
  hidden = false,
  collapsed: collapsedProp = false,
  onCollapseChange,
  brandingName,
  brandingBotIcon,
  onHomeClick,
}, ref) {
  const { data: session } = useSession();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadTotal, setThreadTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleteThread, setDeleteThread] = useState<Thread | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showNewThreadModal, setShowNewThreadModal] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [newThreadCategories, setNewThreadCategories] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);
  const [availableCategories, setAvailableCategories] = useState<{id: number; name: string}[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Per-group collapse state (header chevron) with localStorage persistence.
  // Keyed by CHATS_GROUP_KEY or category id as string. Desktop defaults to
  // expanded (false) for every group until the user toggles something; the
  // persisted state is shared with the mobile drawer via the same key.
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(loadCollapsedGroups);

  // Which groups have been expanded via "Show all" (shows all threads instead
  // of only the latest MAX_THREADS_PER_GROUP). In-memory only — resets on
  // reload, which is the expected behaviour for a transient browse action.
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Refs to group header elements so we can scroll a header into view when a
  // group is collapsed back to its latest-3 preview ("Show less").
  const groupHeaderRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [internalCollapsed, setInternalCollapsed] = useState(collapsedProp);
  const isCollapsed = onCollapseChange ? collapsedProp : internalCollapsed;
  const setIsCollapsed = useCallback((collapsed: boolean) => {
    if (onCollapseChange) {
      onCollapseChange(collapsed);
    } else {
      setInternalCollapsed(collapsed);
    }
  }, [onCollapseChange]);

  // Expose setCollapsed for external control (e.g. swipe gestures)
  useImperativeHandle(ref, () => ({
    setCollapsed: (collapsed: boolean) => setIsCollapsed(collapsed),
  }), [setIsCollapsed]);

  const userRole = (session?.user as { role?: string })?.role;
  const isAdmin = userRole === 'admin' || userRole === 'super_admin';
  const isSuperUser = userRole === 'superuser';
  const isRegularUser = userRole === 'user';

  // Regular users must select exactly one category per thread
  const requiresSingleCategory = isRegularUser;

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/threads?limit=50&offset=0');
      if (response.ok) {
        const data = await response.json();
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[ThreadSidebar] loaded threads', {
            returnedCount: data.threads.length,
            total: data.total,
          });
        }
        setThreadTotal(data.total ?? data.threads.length);
        setThreads(data.threads.map((t: Thread) => ({
          ...t,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
        })));
        setOffset(data.threads?.length ?? 0);
      }
    } catch (err) {
      console.error('Failed to load threads:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const hasMore = threads.length < threadTotal;

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/threads?limit=50&offset=${offset}`);
      if (response.ok) {
        const data = await response.json();
        const incoming = (data.threads as Thread[]).map((t) => ({
          ...t,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
        }));
        setThreads((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          return [...prev, ...incoming.filter((t) => !seen.has(t.id))];
        });
        setThreadTotal(data.total ?? threadTotal);
        setOffset((prev) => prev + (data.threads?.length ?? 0));
      }
    } catch (err) {
      console.error('Failed to load more threads:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [offset, loadingMore, threadTotal]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    saveCollapsedGroups(collapsedGroups);
  }, [collapsedGroups]);

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
        setThreadTotal((prev) => prev + 1);
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
        setThreadTotal((prev) => Math.max(0, prev - 1));
        onThreadDeleted?.();
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

  const toggleGroupCollapse = (key: string) => {
    setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const isGroupCollapsed = (key: string) => collapsedGroups[key] ?? false;

  const toggleGroupExpanded = (key: string) => {
    setExpandedGroups(prev => {
      const next = { ...prev, [key]: !prev[key] };
      // When collapsing back to the latest-3 preview, scroll the group header
      // into view so the user doesn't lose context as rows above vanish.
      if (next[key] === false) {
        requestAnimationFrame(() => {
          groupHeaderRefs.current[key]?.scrollIntoView({ block: 'nearest' });
        });
      }
      return next;
    });
  };

  const isGroupExpanded = (key: string) => expandedGroups[key] ?? false;

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

  // Shared grouping + search-visibility logic (also used by the mobile drawer).
  const { groups, getVisibleThreads, hasAnyVisible, normalizedQuery } =
    useThreadGroups(threads, availableCategories, searchQuery);

  // Hidden state (mobile input focused)
  if (hidden) {
    return null;
  }

  // Collapsed view
  if (isCollapsed) {
    return (
      <>
        <aside className="w-full h-full min-h-0 overflow-y-auto bg-white border-r border-gray-200 flex flex-col items-center py-2 gap-1">
          <Link
            href="/chat"
            onClick={onHomeClick}
            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors shrink-0"
            title={`${brandingName} home`}
            aria-label={`${brandingName} home`}
          >
            <BotIcon iconKey={brandingBotIcon} size={22} />
          </Link>

          <button
            onClick={() => setIsCollapsed(false)}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
            title="Expand threads panel"
            aria-label="Expand threads panel"
          >
            <PanelLeftOpen size={20} />
          </button>

          {/* New thread button */}
          <button
            onClick={openNewThreadModal}
            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors shrink-0"
            title="New thread"
            aria-label="New thread"
          >
            <Plus size={20} />
          </button>

          <div className="mt-auto flex flex-col items-center gap-1 border-t border-gray-200 pt-2 shrink-0">
            <Link
              href="/help"
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Help"
              aria-label="Help"
            >
              <HelpCircle size={20} />
            </Link>
            {(isAdmin || isSuperUser) && (
              <Link
                href={isAdmin ? '/admin' : '/superuser'}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title={isAdmin ? 'Admin Dashboard' : 'Manage'}
                aria-label={isAdmin ? 'Admin Dashboard' : 'Manage'}
              >
                <Settings size={20} />
              </Link>
            )}
            {session?.user && (
              <Link
                href="/profile"
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Profile"
                aria-label="Profile"
              >
                <User size={20} />
              </Link>
            )}
            {session?.user && (
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/auth/signin' })}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut size={20} />
              </button>
            )}
          </div>
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
      <aside className="w-full h-full bg-white border-r border-gray-200 flex flex-col">
        {/* Product identity and panel control */}
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <Link
            href="/chat"
            onClick={onHomeClick}
            className="flex items-center gap-2 min-w-0 text-gray-900 hover:text-blue-600 transition-colors"
            title={`${brandingName} home`}
          >
            <BotIcon iconKey={brandingBotIcon} size={24} className="text-blue-600 shrink-0" />
            <span className="font-semibold truncate">{brandingName}</span>
          </Link>
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors shrink-0"
            title="Collapse panel"
            aria-label="Collapse panel"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        <div className="px-4 py-2 border-b">
          <span className="font-medium text-gray-900">Threads</span>
        </div>

        {/* New Thread Button */}
        <div className="p-4 border-b">
          <Button onClick={openNewThreadModal} className="w-full">
            <Plus size={18} className="mr-2" />
            New Thread
          </Button>
        </div>

        {/* Search Input */}
        <div className="px-4 py-2 border-b">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search threads or categories..."
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
          ) : !hasAnyVisible ? (
            <div className="text-center py-8 text-gray-500">
              {searchQuery ? (
                <>
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No threads matching "{searchQuery}"</p>
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
                  <p className="text-sm">No threads yet</p>
                  <p className="text-xs">Start a new conversation</p>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Render a single thread row */}
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
                        {thread.isPinned && (
                          <Star size={10} className="fill-yellow-400 text-yellow-400" />
                        )}
                        {thread.isSummarized && (
                          <span className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-blue-50 text-blue-600 rounded text-[9px] font-medium" title="This thread has been summarized">
                            <BookOpen size={10} />
                            <span>Summarized</span>
                          </span>
                        )}
                        {thread.threadKind === 'shared_copy' && (
                          <span className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-violet-50 text-violet-600 rounded text-[9px] font-medium" title="This is your independent copy of a shared thread">
                            <Users size={10} />
                            <span>Shared</span>
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

                // Render one category group: collapsible header + latest-3 (or
                // all when expanded / when the category name matches the search)
                // + "Show all" link when there are more than the preview limit.
                const renderGroup = (group: ThreadGroup) => {
                  const visible = getVisibleThreads(group);
                  if (!visible || visible.length === 0) return null;

                  const collapsed = isGroupCollapsed(group.key);
                  // A category-name search match reveals the whole group, so
                  // bypass the latest-3 preview in that case.
                  const categoryMatched =
                    normalizedQuery.length > 0 &&
                    group.categoryId !== null &&
                    group.label.toLowerCase().includes(normalizedQuery);
                  const expanded = categoryMatched || isGroupExpanded(group.key);
                  const previewThreads = expanded
                    ? visible
                    : visible.slice(0, MAX_THREADS_PER_GROUP);
                  const hiddenCount = visible.length - previewThreads.length;

                  return (
                    <div key={group.key} className="mb-4">
                      <button
                        ref={(el) => { groupHeaderRefs.current[group.key] = el; }}
                        onClick={() => toggleGroupCollapse(group.key)}
                        className="w-full flex items-center gap-1 px-2 mb-1 mt-3 text-xs font-medium text-gray-500 uppercase hover:text-gray-700 transition-colors"
                      >
                        {collapsed
                          ? <ChevronRight size={12} className="shrink-0" />
                          : <ChevronDown size={12} className="shrink-0" />
                        }
                        {group.categoryId === null
                          ? <MessageSquare size={12} className="shrink-0 opacity-70" />
                          : <FolderOpen size={12} className="shrink-0 opacity-70" />
                        }
                        <span className="truncate">{group.label}</span>
                        <span className="text-[10px] text-gray-400 normal-case ml-1">
                          ({visible.length})
                        </span>
                      </button>
                      {!collapsed && (
                        <div className="space-y-1">
                          {previewThreads.map(renderThread)}
                          {!categoryMatched && hiddenCount > 0 && (
                            <button
                              onClick={() => toggleGroupExpanded(group.key)}
                              className="w-full text-left px-3 py-1 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              {isGroupExpanded(group.key)
                                ? 'Show less'
                                : `Show all (${visible.length})`}
                            </button>
                          )}
                          {categoryMatched && visible.length > MAX_THREADS_PER_GROUP && (
                            <p className="px-3 py-1 text-[10px] text-gray-400">
                              Showing all {visible.length} threads in this category
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                };

                return (
                  <>
                    {groups.map(renderGroup)}
                    {hasMore && (
                      <button
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="w-full text-center px-3 py-2 mt-2 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {loadingMore ? 'Loading…' : `Load more (${threads.length}/${threadTotal})`}
                      </button>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </div>

        {/* Footer with user info and admin link */}
        <div className="border-t p-4 space-y-2">
          <Link
            href="/help"
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <HelpCircle size={16} />
            Help
          </Link>
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
              <User size={16} />
              Profile
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
          Are you sure you want to delete "{deleteThread?.title}"?
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

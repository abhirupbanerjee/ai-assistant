'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, MessageSquare, Trash2, Settings, LogOut, User, BookOpen, Star,
  Download, Home, ChevronDown, ChevronRight, Search, X, FolderOpen, HelpCircle
} from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import type { Thread } from '@/types';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import MobileMenuDrawer from '@/components/ui/MobileMenuDrawer';
import CategorySelector from '@/components/ui/CategorySelector';
import BotIcon from '@/components/ui/BotIcon';
import { useMobileMenu } from '@/contexts/MobileMenuContext';
import {
  useThreadGroups,
  loadCollapsedGroups,
  saveCollapsedGroups,
  MAX_THREADS_PER_GROUP,
  CHATS_GROUP_KEY,
  type ThreadGroup,
} from '@/hooks/useThreadGroups';

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
  onThreadDeleted: () => void;
  selectedThreadId?: string | null;
  brandingName: string;
  brandingBotIcon: string;
  onHomeClick: () => void;
}

export default function MobileThreadsMenu({
  onThreadSelect,
  onThreadCreated,
  onThreadDeleted,
  selectedThreadId,
  brandingName,
  brandingBotIcon,
  onHomeClick,
}: MobileThreadsMenuProps) {
  const router = useRouter();
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
  const [availableCategories, setAvailableCategories] = useState<{id: number; name: string}[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Per-group collapse state, shared with the desktop sidebar via the same
  // localStorage key. Mobile defaults to collapsed (true) for any group that
  // has never been toggled — the narrow viewport benefits from a compact
  // category-only list until the user taps to expand. Once the user interacts,
  // the persisted value (shared with desktop) takes over.
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(loadCollapsedGroups);

  // Which groups have been expanded via "Show all" (in-memory, resets on close).
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Refs to group header elements so we can scroll a header into view when a
  // group is collapsed back to its latest-3 preview ("Show less").
  const groupHeaderRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const userRole = (session?.user as { role?: string })?.role;
  const isAdmin = userRole === 'admin' || userRole === 'super_admin';
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

  // Re-read persisted collapse state whenever the drawer opens, so changes made
  // on desktop (shared key) are reflected here.
  useEffect(() => {
    if (isThreadsMenuOpen) {
      setCollapsedGroups(loadCollapsedGroups());
      setExpandedGroups({});
      setSearchQuery('');
    }
  }, [isThreadsMenuOpen]);

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

  const handleSelectThread = (thread: Thread) => {
    onThreadSelect(thread);
    closeThreadsMenu();
  };

  // Explicitly navigate in the tap handler. Closing the animated drawer from
  // a nested Link could swallow the first tap in some installed PWAs.
  const navigateFromMenu = useCallback((href: string) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[MobileThreadsMenu] single-tap navigation', { href });
    }
    closeThreadsMenu();
    router.push(href);
  }, [closeThreadsMenu, router]);

  const handleHome = useCallback(() => {
    onHomeClick();
    closeThreadsMenu();
    router.push('/chat');
  }, [closeThreadsMenu, onHomeClick, router]);

  const handleSignOut = useCallback(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[MobileThreadsMenu] single-tap sign out');
    }
    closeThreadsMenu();
    void signOut({ callbackUrl: '/auth/signin' });
  }, [closeThreadsMenu]);

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
        onThreadDeleted();
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

  // Mobile default: collapsed (true) for any group without a persisted value.
  // This keeps the drawer compact on first load. Desktop uses ?? false.
  const isGroupCollapsed = (key: string) => collapsedGroups[key] ?? true;

  const toggleGroupCollapse = (key: string) => {
    setCollapsedGroups(prev => ({ ...prev, [key]: !isGroupCollapsed(key) }));
  };

  const toggleGroupExpanded = (key: string) => {
    setExpandedGroups(prev => {
      const next = { ...prev, [key]: !prev[key] };
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
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'long' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  // Shared grouping + search-visibility logic (also used by the desktop sidebar).
  const { groups, getVisibleThreads, hasAnyVisible, normalizedQuery } =
    useThreadGroups(threads, availableCategories, searchQuery);

  // Render one category group: collapsible header + latest-3 (or all when
  // expanded / when the category name matches the search) + "Show all" link.
  const renderGroup = (group: ThreadGroup) => {
    const visible = getVisibleThreads(group);
    if (!visible || visible.length === 0) return null;

    const collapsed = isGroupCollapsed(group.key);
    // A category-name search match reveals the whole group, so bypass the
    // latest-3 preview in that case.
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
      <div key={group.key} className="mb-2">
        <button
          ref={(el) => { groupHeaderRefs.current[group.key] = el; }}
          onClick={() => toggleGroupCollapse(group.key)}
          className="w-full flex items-center gap-1.5 px-2 py-3 min-h-[44px] text-sm font-medium text-gray-500 uppercase hover:text-gray-700 active:bg-gray-100 rounded-lg transition-colors"
        >
          {collapsed
            ? <ChevronRight size={16} className="shrink-0" />
            : <ChevronDown size={16} className="shrink-0" />
          }
          {group.categoryId === null
            ? <MessageSquare size={16} className="shrink-0 opacity-70" />
            : <FolderOpen size={16} className="shrink-0 opacity-70" />
          }
          <span className="truncate">{group.label}</span>
          <span className="text-xs text-gray-400 normal-case ml-1">
            ({visible.length})
          </span>
        </button>
        {!collapsed && (
          <div className="space-y-1">
            {previewThreads.map((thread) => (
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
            {!categoryMatched && hiddenCount > 0 && (
              <button
                onClick={() => toggleGroupExpanded(group.key)}
                className="w-full text-left px-3 py-2 min-h-[44px] text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
              >
                {isGroupExpanded(group.key)
                  ? 'Show less'
                  : `Show all (${visible.length})`}
              </button>
            )}
            {categoryMatched && visible.length > MAX_THREADS_PER_GROUP && (
              <p className="px-3 py-1 text-xs text-gray-400">
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
      <MobileMenuDrawer
        isOpen={isThreadsMenuOpen}
        onClose={closeThreadsMenu}
        title="Threads"
        titleContent={(
          <span className="flex items-center gap-2 min-w-0">
            <BotIcon iconKey={brandingBotIcon} size={22} className="text-blue-600 shrink-0" />
            <span className="truncate" title={brandingName}>{brandingName}</span>
          </span>
        )}
        side="left"
        headerRight={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleHome}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              style={{ color: 'var(--accent-color)' }}
              aria-label="Chat home"
            >
              <Home size={20} />
            </button>
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
        {/* Search input — sticky so it stays visible while scrolling groups.
            text-base (16px) prevents iOS Safari auto-zoom on focus. */}
        <div className="sticky top-0 z-10 bg-white px-4 py-2 border-b">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search threads or categories..."
              className="w-full pl-9 pr-9 py-2 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
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
            groups.map(renderGroup)
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 space-y-2">
          <button type="button" onClick={() => navigateFromMenu('/help')} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
            <HelpCircle size={16} />
            Help
          </button>
          {isAdmin && (
            <button type="button" onClick={() => navigateFromMenu('/admin')} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
              <Settings size={16} />
              Admin Dashboard
            </button>
          )}
          {isSuperUser && (
            <button type="button" onClick={() => navigateFromMenu('/superuser')} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
              <Settings size={16} />
              Manage
            </button>
          )}
          {session?.user && (
            <button type="button" onClick={() => navigateFromMenu('/profile')} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
              <User size={16} />
              Profile
            </button>
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
                onClick={handleSignOut}
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
          Are you sure you want to delete "{deleteThread?.title}"?
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

// Thread item component — always-visible action icons (no hover gating) and
// 48×48px min touch targets for accessibility on touch devices.
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
          {thread.isPinned && (
            <Star size={10} className="fill-yellow-400 text-yellow-400" />
          )}
          {thread.isSummarized && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-blue-50 text-blue-600 rounded text-xs font-medium">
              <BookOpen size={12} />
              <span>Summarized</span>
            </span>
          )}
        </div>
        {thread.categories && thread.categories.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {thread.categories.map((cat) => {
              const colors = getCategoryColor(cat.id);
              return (
                <span key={cat.id} className={`px-1.5 py-0.5 rounded text-xs font-medium border ${colors.bg} ${colors.text} ${colors.border}`}>
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
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded ${thread.isPinned ? 'text-yellow-500' : 'text-gray-400'}`}
        >
          <Star size={14} className={thread.isPinned ? 'fill-current' : ''} />
        </button>
        <a
          href={`/api/threads/${thread.id}/export`}
          download
          onClick={(e) => e.stopPropagation()}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400"
        >
          <Download size={14} />
        </a>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

'use client';

import { useMemo } from 'react';
import type { Thread } from '@/types';

/**
 * Maximum number of threads to show per group before requiring "Show all".
 */
export const MAX_THREADS_PER_GROUP = 3;

/**
 * Special key used for threads that have no categories.
 */
export const CHATS_GROUP_KEY = '__chats__';

/**
 * A unified group descriptor used for rendering.
 */
export interface ThreadGroup {
  /** CHATS_GROUP_KEY or category id as string */
  key: string;
  /** "Chats" or category name */
  label: string;
  /** null for the Chats group */
  categoryId: number | null;
  /** threads belonging to this group (already sorted) */
  threads: Thread[];
}

/**
 * Sort threads: pinned first, then most-recently-updated.
 */
export const sortThreads = (threads: Thread[]): Thread[] =>
  [...threads].sort((a, b) => {
    if (!!b.isPinned !== !!a.isPinned) return (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0);
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

export interface UseThreadGroupsResult {
  /** Ordered groups: Chats first, then each category (in API order) with threads. */
  groups: ThreadGroup[];
  /**
   * Returns the visible threads for a group given the search query, or null
   * when the group should be hidden entirely (no matches).
   * - No query → all threads in the group.
   * - Category-name match → all threads in the group (category reveal).
   * - Otherwise → only threads whose title matches the query.
   * - The Chats group (categoryId === null) matches by title only.
   */
  getVisibleThreads: (group: ThreadGroup) => Thread[] | null;
  /** Whether any group has visible threads (drives the empty state). */
  hasAnyVisible: boolean;
  /** The normalized (trimmed + lowercased) search query. */
  normalizedQuery: string;
}

/**
 * Shared grouping + search-visibility logic for thread lists.
 *
 * Used by both the desktop [`ThreadSidebar`](../components/layout/ThreadSidebar.tsx)
 * and the mobile [`MobileThreadsMenu`](../components/mobile/MobileThreadsMenu.tsx)
 * so the two views stay perfectly aligned.
 *
 * Threads with no categories go into the "Chats" group (always first); threads
 * belonging to multiple categories are duplicated into each of their category
 * groups. Within each group threads are sorted pinned-first then by
 * `updatedAt` descending.
 */
export function useThreadGroups(
  threads: Thread[],
  availableCategories: { id: number; name: string }[],
  searchQuery: string,
): UseThreadGroupsResult {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  // Build the ordered list of groups: "Chats" first, then each category in the
  // order returned by /api/user/categories. Threads with no categories go into
  // the Chats group; threads belonging to multiple categories are duplicated
  // into each of their category groups.
  const groups: ThreadGroup[] = useMemo(() => {
    const chatsThreads: Thread[] = [];
    const byCategory = new Map<number, Thread[]>();

    for (const thread of threads) {
      const cats = thread.categories ?? [];
      if (cats.length === 0) {
        chatsThreads.push(thread);
      } else {
        for (const cat of cats) {
          const bucket = byCategory.get(cat.id);
          if (bucket) bucket.push(thread);
          else byCategory.set(cat.id, [thread]);
        }
      }
    }

    const result: ThreadGroup[] = [];

    // Chats group (no categories) — always first.
    result.push({
      key: CHATS_GROUP_KEY,
      label: 'Chats',
      categoryId: null,
      threads: sortThreads(chatsThreads),
    });

    // One group per available category, in API order.
    for (const category of availableCategories) {
      const bucket = byCategory.get(category.id);
      if (!bucket || bucket.length === 0) continue; // hide empty categories
      result.push({
        key: String(category.id),
        label: category.name,
        categoryId: category.id,
        threads: sortThreads(bucket),
      });
    }

    return result;
  }, [threads, availableCategories]);

  // Compute the visible threads for a given group based on the search query.
  // - Category name matches the query → show ALL threads in that group.
  // - Otherwise, show only threads whose title matches the query.
  // - The "Chats" group has no category name, so it only matches by title.
  // Returns null to signal "group should be hidden entirely" (no matches).
  const getVisibleThreads = (group: ThreadGroup): Thread[] | null => {
    if (!normalizedQuery) return group.threads;

    // Category-name match → reveal the entire group.
    if (group.categoryId !== null && group.label.toLowerCase().includes(normalizedQuery)) {
      return group.threads;
    }

    // Otherwise, filter by thread title.
    const matched = group.threads.filter(thread =>
      thread.title.toLowerCase().includes(normalizedQuery),
    );
    return matched.length > 0 ? matched : null;
  };

  // Whether any group has visible threads (drives the empty state).
  const hasAnyVisible = groups.some(g => getVisibleThreads(g) !== null);

  return { groups, getVisibleThreads, hasAnyVisible, normalizedQuery };
}

/**
 * Persist per-group collapse state to localStorage so it survives reloads and
 * is shared between the desktop sidebar and the mobile drawer.
 *
 * Both views use the same key (`sidebar-collapsed-groups`) so a group collapsed
 * on one device stays collapsed on the other. The only divergence is the
 * *initial default* when no entry exists yet (desktop expands, mobile
 * collapses) — callers pass `defaultCollapsed` accordingly.
 */
export const COLLAPSED_GROUPS_STORAGE_KEY = 'sidebar-collapsed-groups';

export function loadCollapsedGroups(): Record<string, boolean> {
  if (typeof window !== 'undefined') {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }
  return {};
}

export function saveCollapsedGroups(state: Record<string, boolean>): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }
}

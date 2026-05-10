'use client';

import { useEffect, useCallback, useRef } from 'react';

interface UseDraftPersistenceOptions {
  debounceMs?: number;
}

/**
 * Hook to persist and restore message drafts to localStorage.
 * Saves drafts keyed by thread ID (or 'new' for unsent threads).
 * Automatically restores on mount and when threadId changes.
 */
export function useDraftPersistence(
  threadId: string | null,
  message: string,
  setMessage: (message: string) => void,
  options: UseDraftPersistenceOptions = {}
) {
  const { debounceMs = 300 } = options;
  const restoredForThread = useRef<string | null>(null);

  // Generate storage key based on thread ID
  const getStorageKey = useCallback((id: string | null) => {
    return `policybot:draft:${id || 'new'}`;
  }, []);

  // Save draft to localStorage (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      const key = getStorageKey(threadId);
      if (message.trim()) {
        try {
          localStorage.setItem(key, message);
        } catch (error) {
          console.warn('Failed to save draft to localStorage:', error);
        }
      } else {
        // Clear draft if message is empty
        try {
          localStorage.removeItem(key);
        } catch (error) {
          console.warn('Failed to clear draft from localStorage:', error);
        }
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [message, threadId, debounceMs, getStorageKey]);

  // Restore draft from localStorage on mount or threadId change (once per thread)
  useEffect(() => {
    // Only restore once per threadId to avoid re-restoring when user clears input
    if (restoredForThread.current === threadId) return;
    restoredForThread.current = threadId;

    const key = getStorageKey(threadId);
    try {
      const savedDraft = localStorage.getItem(key);
      if (savedDraft) {
        setMessage(savedDraft);
      }
    } catch (error) {
      console.warn('Failed to restore draft from localStorage:', error);
    }
  }, [threadId, getStorageKey, setMessage]);

  // Clear draft after successful send
  const clearDraft = useCallback(() => {
    const key = getStorageKey(threadId);
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn('Failed to clear draft from localStorage:', error);
    }
  }, [threadId, getStorageKey]);

  return { clearDraft };
}

'use client';

import { useState, useEffect, useRef } from 'react';
import type { ThreadOutputItem } from '@/types';

interface ThreadOutputsData {
  outputs: ThreadOutputItem[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches thread outputs from the durable thread_outputs table.
 * These survive summarization and provide expiration metadata.
 */
export function useThreadOutputs(threadId: string | null): ThreadOutputsData {
  const [outputs, setOutputs] = useState<ThreadOutputItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastThreadId = useRef<string | null>(null);

  useEffect(() => {
    if (!threadId) {
      setOutputs([]);
      setLoading(false);
      setError(null);
      return;
    }

    // Skip if same thread
    if (lastThreadId.current === threadId) return;
    lastThreadId.current = threadId;

    let cancelled = false;

    async function fetchOutputs() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/threads/${threadId}/outputs`);
        if (!res.ok) {
          throw new Error(`Failed to fetch outputs (${res.status})`);
        }
        const data = await res.json();
        if (!cancelled) {
          setOutputs(data.outputs || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchOutputs();

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  return { outputs, loading, error };
}

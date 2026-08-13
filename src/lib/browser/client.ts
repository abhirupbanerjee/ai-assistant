/**
 * HTTP client for the browser-worker sidecar.
 *
 * Authenticates with `Authorization: Bearer <BROWSER_WORKER_SHARED_SECRET>`.
 * The worker is internal-only; user identity/authorization is enforced by the
 * app routes that call this client.
 */

import type { BrowserWorkerClient, BrowserWorkerSnapshot } from './interface';
import type {
  BrowserAction,
  BrowserCommandResult,
  BrowserObservation,
} from '@/types/browser';

const WORKER_URL = (process.env.BROWSER_WORKER_URL || '').replace(/\/+$/, '');
const SHARED_SECRET = process.env.BROWSER_WORKER_SHARED_SECRET || '';

export function isBrowserWorkerConfigured(): boolean {
  return Boolean(WORKER_URL && SHARED_SECRET);
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${SHARED_SECRET}`,
    'Content-Type': 'application/json',
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isBrowserWorkerConfigured()) {
    throw new Error(
      'Browser worker is not configured (set BROWSER_WORKER_URL and BROWSER_WORKER_SHARED_SECRET).'
    );
  }

  const res = await fetch(`${WORKER_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers || {}) },
    cache: 'no-store',
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* keep statusText */
    }
    throw new Error(`Browser worker error ${res.status}: ${detail}`);
  }

  return (await res.json()) as T;
}

class HttpBrowserWorkerClient implements BrowserWorkerClient {
  createSession(sessionId: string, allowlist: string[]): Promise<BrowserWorkerSnapshot> {
    return request<BrowserWorkerSnapshot>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessionId, allowlist }),
    });
  }

  observe(sessionId: string, includeScreenshot: boolean): Promise<BrowserObservation> {
    return request<BrowserObservation>(`/sessions/${encodeURIComponent(sessionId)}/observe`, {
      method: 'POST',
      body: JSON.stringify({ includeScreenshot }),
    });
  }

  executeAction(
    sessionId: string,
    action: BrowserAction,
    confirmToken?: string
  ): Promise<BrowserCommandResult> {
    return request<BrowserCommandResult>(`/sessions/${encodeURIComponent(sessionId)}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, confirmToken }),
    });
  }

  takeover(sessionId: string): Promise<BrowserWorkerSnapshot> {
    return request<BrowserWorkerSnapshot>(`/sessions/${encodeURIComponent(sessionId)}/takeover`, {
      method: 'POST',
    });
  }

  resume(sessionId: string): Promise<BrowserWorkerSnapshot> {
    return request<BrowserWorkerSnapshot>(`/sessions/${encodeURIComponent(sessionId)}/resume`, {
      method: 'POST',
    });
  }

  async terminate(sessionId: string): Promise<void> {
    await request<{ success: boolean }>(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
  }
}

let client: HttpBrowserWorkerClient | null = null;

/** Shared client instance. */
export function getBrowserWorkerClient(): BrowserWorkerClient {
  if (!client) client = new HttpBrowserWorkerClient();
  return client;
}

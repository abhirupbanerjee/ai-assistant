/**
 * Hook to fetch the authenticated user's connected account status.
 *
 * Used by the SaveToDriveButton to decide whether to render the Google Drive
 * save action. The result is fetched once per session and refreshed on focus
 * only when explicitly requested.
 */

import { useEffect, useState, useCallback } from 'react';

export interface ConnectedAccountsStatus {
  google: {
    connected: boolean;
    displayName?: string;
    revoked: boolean;
    scopes?: string;
  };
  microsoft: {
    connected: boolean;
    displayName?: string;
    revoked: boolean;
    scopes?: string;
  };
  github: {
    connected: boolean;
    displayName?: string;
    revoked: boolean;
    scopes?: string;
  };
  notion: {
    connected: boolean;
    displayName?: string;
    revoked: boolean;
    scopes?: string;
  };
  slack: {
    connected: boolean;
    displayName?: string;
    revoked: boolean;
    scopes?: string;
  };
  gitbook: {
    connected: boolean;
    displayName?: string;
    revoked: boolean;
    scopes?: string;
  };
}

export function useConnectedAccounts() {
  const [accounts, setAccounts] = useState<ConnectedAccountsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/connectors/accounts', { credentials: 'same-origin' });
      if (!res.ok) {
        throw new Error(`Failed to fetch connected accounts: ${res.status}`);
      }
      const data = (await res.json()) as ConnectedAccountsStatus;
      setAccounts(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    googleConnected: accounts?.google?.connected ?? false,
    microsoftConnected: accounts?.microsoft?.connected ?? false,
    githubConnected: accounts?.github?.connected ?? false,
    notionConnected: accounts?.notion?.connected ?? false,
    slackConnected: accounts?.slack?.connected ?? false,
    accounts,
    loading,
    error,
    refresh,
  };
}

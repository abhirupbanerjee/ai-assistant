'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HardDrive, AlertTriangle, Loader2, CheckCircle2, XCircle, Plug, Unplug } from 'lucide-react';
import Button from '@/components/ui/Button';

/**
 * Connect/Disconnect UI for Drive connectors (§8 Task 8).
 *
 * Renders the connected state, granted scopes, and a Connect / Disconnect
 * button for each supported provider. Currently supports Google; Microsoft
 * slots in via the same shape (§8 Task 10).
 *
 * The section reads OAuth callback result flags from the URL query params
 * (`?google_connected=1`, `?google_error=...`) to surface success/error
 * messages after the redirect round-trip.
 */

interface ConnectedAccountStatus {
  connected: boolean;
  provider?: string;
  displayName?: string;
  scopes?: string;
  tokenExpiry?: string | null;
  lastError?: string | null;
  connectedAt?: string;
  updatedAt?: string;
}

type ProviderKey = 'google' | 'microsoft';

interface ProviderConfig {
  key: ProviderKey;
  label: string;
  startPath: string;
  disconnectPath: string;
  icon: typeof HardDrive;
  accentColor: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    key: 'google',
    label: 'Google Drive',
    startPath: '/api/connectors/google/start',
    disconnectPath: '/api/connectors/google/disconnect',
    icon: HardDrive,
    accentColor: 'text-blue-600',
  },
  {
    key: 'microsoft',
    label: 'OneDrive',
    startPath: '/api/connectors/microsoft/start',
    disconnectPath: '/api/connectors/microsoft/disconnect',
    icon: HardDrive,
    accentColor: 'text-sky-600',
  },
];

/** Format scope URIs into human-readable labels. */
function formatScope(scope: string): string {
  return scope
    .split(' ')
    .filter(Boolean)
    .map((s) => {
      if (s.startsWith('https://www.googleapis.com/auth/')) {
        return s.replace('https://www.googleapis.com/auth/', '');
      }
      if (s.startsWith('https://graph.microsoft.com/')) {
        return s.replace('https://graph.microsoft.com/', '');
      }
      return s;
    })
    .join(', ');
}

export default function ConnectedAccountsSection() {
  const router = useRouter();
  const [statuses, setStatuses] = useState<Record<ProviderKey, ConnectedAccountStatus | null>>({
    google: null,
    microsoft: null,
  });
  const [loading, setLoading] = useState<Record<ProviderKey, boolean>>({
    google: true,
    microsoft: true,
  });
  const [disconnecting, setDisconnecting] = useState<Record<ProviderKey, boolean>>({
    google: false,
    microsoft: false,
  });
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // ── Load connection status for all providers ─────────────────────────────
  const loadStatus = useCallback(async (provider: ProviderKey) => {
    try {
      const res = await fetch(PROVIDERS.find((p) => p.key === provider)!.disconnectPath);
      if (res.status === 401) {
        router.push('/auth/signin');
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as ConnectedAccountStatus;
        setStatuses((prev) => ({ ...prev, [provider]: data }));
      } else {
        setStatuses((prev) => ({ ...prev, [provider]: { connected: false } }));
      }
    } catch {
      setStatuses((prev) => ({ ...prev, [provider]: { connected: false } }));
    } finally {
      setLoading((prev) => ({ ...prev, [provider]: false }));
    }
  }, [router]);

  useEffect(() => {
    // Check URL for OAuth callback result flags.
    const params = new URLSearchParams(window.location.search);
    if (params.get('google_connected') === '1') {
      setNotice({ type: 'success', message: 'Google Drive connected successfully.' });
    } else if (params.get('google_error')) {
      setNotice({ type: 'error', message: `Google connection failed: ${params.get('google_error')}` });
    } else if (params.get('ms_connected') === '1') {
      setNotice({ type: 'success', message: 'OneDrive connected successfully.' });
    } else if (params.get('ms_error')) {
      setNotice({ type: 'error', message: `OneDrive connection failed: ${params.get('ms_error')}` });
    }
    // Clean the URL so the notice doesn't persist on refresh.
    if (
      params.get('google_connected') ||
      params.get('google_error') ||
      params.get('ms_connected') ||
      params.get('ms_error')
    ) {
      const url = new URL(window.location.href);
      url.searchParams.delete('google_connected');
      url.searchParams.delete('google_error');
      url.searchParams.delete('ms_connected');
      url.searchParams.delete('ms_error');
      window.history.replaceState({}, '', url.toString());
    }

    // Load status for all configured providers.
    PROVIDERS.forEach((p) => loadStatus(p.key));
  }, [loadStatus]);

  // ── Handle Connect (redirect to OAuth start) ─────────────────────────────
  const handleConnect = (provider: ProviderKey) => {
    const config = PROVIDERS.find((p) => p.key === provider)!;
    // Redirect to the OAuth start endpoint with a return-to path.
    window.location.href = `${config.startPath}?redirect=/profile`;
  };

  // ── Handle Disconnect ─────────────────────────────────────────────────────
  const handleDisconnect = async (provider: ProviderKey) => {
    const config = PROVIDERS.find((p) => p.key === provider)!;
    setDisconnecting((prev) => ({ ...prev, [provider]: true }));
    setNotice(null);
    try {
      const res = await fetch(config.disconnectPath, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Disconnect failed' }));
        throw new Error(data.error || 'Disconnect failed');
      }
      setNotice({ type: 'success', message: `${config.label} disconnected. Tokens revoked and vault row deleted.` });
      await loadStatus(provider);
    } catch (err) {
      setNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to disconnect',
      });
    } finally {
      setDisconnecting((prev) => ({ ...prev, [provider]: false }));
    }
  };

  return (
    <div className="bg-white rounded-lg border shadow-sm">
      {/* Header */}
      <div className="px-6 py-4 border-b">
        <div className="flex items-center gap-3">
          <Plug className="text-blue-600" size={24} />
          <div>
            <h2 className="font-semibold text-gray-900">Connected Accounts</h2>
            <p className="text-sm text-gray-500">
              Connect your cloud drives so the assistant can read your files on your behalf
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-6 py-4 space-y-4">
        {/* Global notice (success/error from OAuth callback or disconnect) */}
        {notice && (
          <div
            className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
              notice.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}
          >
            {notice.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{notice.message}</span>
          </div>
        )}

        {/* Provider rows */}
        {PROVIDERS.map((config) => {
          const Icon = config.icon;
          const status = statuses[config.key];
          const isLoading = loading[config.key];
          const isDisconnecting = disconnecting[config.key];

          return (
            <div key={config.key} className="border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Icon className={config.accentColor} size={20} />
                  <div>
                    <h3 className="font-medium text-gray-900">{config.label}</h3>
                    {isLoading ? (
                      <p className="text-xs text-gray-400 flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin" />
                        Checking status...
                      </p>
                    ) : status?.connected ? (
                      <div className="flex items-center gap-1.5 text-xs text-green-700">
                        <CheckCircle2 size={14} />
                        <span>Connected{status.displayName ? ` — ${status.displayName}` : ''}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <XCircle size={14} />
                        <span>Not connected</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action button */}
                <div>
                  {isLoading ? (
                    <Button variant="secondary" size="sm" disabled>
                      <Loader2 size={14} className="mr-1 animate-spin" />
                      ...
                    </Button>
                  ) : status?.connected ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleDisconnect(config.key)}
                      disabled={isDisconnecting}
                      loading={isDisconnecting}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Unplug size={14} className="mr-1" />
                      Disconnect
                    </Button>
                  ) : (
                    <Button variant="primary" size="sm" onClick={() => handleConnect(config.key)}>
                      <Plug size={14} className="mr-1" />
                      Connect
                    </Button>
                  )}
                </div>
              </div>

              {/* Connected details */}
              {status?.connected && (
                <div className="mt-3 pt-3 border-t space-y-1.5 text-xs text-gray-600">
                  {status.scopes && (
                    <div>
                      <span className="font-medium text-gray-700">Scopes: </span>
                      <span className="font-mono">{formatScope(status.scopes)}</span>
                    </div>
                  )}
                  {status.connectedAt && (
                    <div>
                      <span className="font-medium text-gray-700">Connected: </span>
                      {new Date(status.connectedAt).toLocaleDateString()}
                    </div>
                  )}
                  {status.tokenExpiry && (
                    <div>
                      <span className="font-medium text-gray-700">Token expires: </span>
                      {new Date(status.tokenExpiry).toLocaleString()}
                    </div>
                  )}
                  {status.lastError && (
                    <div className="flex items-center gap-1 text-red-700">
                      <AlertTriangle size={12} />
                      <span className="font-medium">Last error: </span>
                      <span>{status.lastError}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Info note */}
        <div className="text-xs text-gray-500 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p>
            Tokens are encrypted at rest. Disconnecting revokes access at the provider and deletes
            the stored tokens. The assistant only accesses files you have explicitly granted
            permission to via these scopes.
          </p>
        </div>
      </div>
    </div>
  );
}

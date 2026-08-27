'use client';

import { useState } from 'react';
import { Check, X, KeyRound, RefreshCw, Layers, Zap, Server } from 'lucide-react';
import Button from '@/components/ui/Button';

interface LLMProvider {
  id: string;
  name: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  apiBase: string | null;
  enabled: boolean;
  kind?: 'direct' | 'aggregator' | 'local' | null;
  lastSyncedAt?: string | null;
}

interface ProviderCardProps {
  provider: LLMProvider;
  onUpdate: (updates: { apiKey?: string; apiBase?: string; enabled?: boolean }) => Promise<void>;
  onTest: () => Promise<{ success: boolean; message: string }>;
  onSync?: () => Promise<void>;
}

export default function ProviderCard({ provider, onUpdate, onTest, onSync }: ProviderCardProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const isOllama = provider.id === 'ollama';
  const isOllamaCloud = provider.id === 'ollama-cloud';
  const isConfigured = provider.apiKeyConfigured || (isOllama && provider.apiBase);

  // Phase 0: kind badge config
  const kindConfig: Record<string, { label: string; icon: typeof Layers; color: string }> = {
    aggregator: { label: 'Aggregator', icon: Layers, color: 'bg-purple-100 text-purple-700' },
    direct: { label: 'Direct SDK', icon: Zap, color: 'bg-blue-100 text-blue-700' },
    local: { label: 'Local', icon: Server, color: 'bg-gray-100 text-gray-700' },
  };
  const kindBadge = provider.kind ? kindConfig[provider.kind] : null;

  const handleSync = async () => {
    if (!onSync) return;
    setIsSyncing(true);
    try {
      await onSync();
    } finally {
      setIsSyncing(false);
    }
  };

  const formatLastSynced = (ts: string | null | undefined) => {
    if (!ts) return null;
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await onTest();
      setTestResult(result);
    } finally {
      setIsTesting(false);
    }
  };

  const handleToggleEnabled = async () => {
    await onUpdate({ enabled: !provider.enabled });
  };

  return (
    <div className={`border rounded-lg p-4 ${!provider.enabled ? 'bg-gray-50 opacity-75' : 'bg-white'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <div className={`w-2 h-2 rounded-full ${isConfigured && provider.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />

          {/* Provider info */}
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-gray-900">{provider.name}</h4>
              {kindBadge && (
                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium ${kindBadge.color}`}>
                  <kindBadge.icon size={10} />
                  {kindBadge.label}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">{provider.id}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {isConfigured && onSync && provider.kind === 'aggregator' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSync}
              disabled={isSyncing || !provider.enabled}
              loading={isSyncing}
            >
              <RefreshCw size={12} className="mr-1" />
              Sync
            </Button>
          )}
          {isConfigured && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleTest}
              disabled={isTesting || !provider.enabled}
              loading={isTesting}
            >
              Test
            </Button>
          )}
        </div>
      </div>

      {/* Last synced timestamp for aggregators */}
      {provider.kind === 'aggregator' && provider.lastSyncedAt && (
        <p className="text-xs text-gray-400 mt-1">Last synced: {formatLastSynced(provider.lastSyncedAt)}</p>
      )}

      {/* Read-only key status */}
      <div className="mt-3 flex items-center justify-between">
        <div className="text-sm">
          {isOllama ? (
            provider.apiBase ? (
              <span className="text-gray-600">{provider.apiBase}</span>
            ) : (
              <span className="text-gray-400">Not configured</span>
            )
          ) : (
            provider.apiKeyConfigured ? (
              <span className="text-gray-600">{provider.apiKey}</span>
            ) : (
              <span className="text-gray-400">Not configured</span>
            )
          )}
        </div>

        <div className="flex items-center gap-2">
          {isConfigured && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={provider.enabled}
                onChange={handleToggleEnabled}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">Enabled</span>
            </label>
          )}
        </div>
      </div>

      {/* Info tip — manage platform keys in Platform Credentials */}
      <div className="mt-2 p-2 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-2">
        <KeyRound size={14} className="text-blue-600 flex-shrink-0" />
        <p className="text-xs text-blue-800">
          API keys are managed in{' '}
          <a href="/admin?tab=settings&section=api-keys" className="text-blue-600 font-medium hover:underline">
            Settings &rarr; Platform Credentials
          </a>
        </p>
      </div>

      {/* Test result */}
      {testResult && (
        <div className={`mt-3 p-2 rounded text-sm flex items-center gap-2 ${
          testResult.success
            ? 'bg-green-50 text-green-700'
            : 'bg-red-50 text-red-700'
        }`}>
          {testResult.success ? (
            <Check size={14} className="flex-shrink-0" />
          ) : (
            <X size={14} className="flex-shrink-0" />
          )}
          <span>{testResult.message}</span>
        </div>
      )}
    </div>
  );
}

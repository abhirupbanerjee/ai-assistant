'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, ChevronUp, ChevronDown, GripVertical, KeyRound } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

// Provider types matching db/config.ts
type RerankerProvider = 'bge-large' | 'cohere' | 'fireworks' | 'bge-base' | 'local';

interface RerankerProviderConfig {
  provider: RerankerProvider;
  enabled: boolean;
}

interface RerankerSettings {
  enabled: boolean;
  providers: RerankerProviderConfig[];
  cohereApiKey?: string;
  hasCohereApiKey?: boolean;
  topKForReranking: number;
  minRerankerScore: number;
  cacheTTLSeconds: number;
  updatedAt?: string;
  updatedBy?: string;
}

interface RerankerProviderStatus {
  provider: string;
  name: string;
  available: boolean;
  configured: boolean;
  error?: string;
  latency?: number;
}

// Provider display info
const RERANKER_PROVIDER_INFO: Record<RerankerProvider, { label: string; description: string }> = {
  'bge-large': {
    label: 'BGE Reranker Large',
    description: 'Best accuracy cross-encoder (~670MB)',
  },
  'cohere': {
    label: 'Cohere API',
    description: 'Fast API-based reranking (requires API key)',
  },
  'fireworks': {
    label: 'Fireworks AI (Qwen3)',
    description: 'Cloud API reranking (requires API key)',
  },
  'bge-base': {
    label: 'BGE Reranker Base',
    description: 'Smaller cross-encoder (~220MB)',
  },
  'local': {
    label: 'Local Bi-encoder',
    description: 'Legacy model, less accurate (~90MB)',
  },
};

// Default providers order
const DEFAULT_PROVIDERS: RerankerProviderConfig[] = [
  { provider: 'bge-large', enabled: true },
  { provider: 'cohere', enabled: true },
  { provider: 'fireworks', enabled: true },
  { provider: 'bge-base', enabled: true },
  { provider: 'local', enabled: true },
];

export default function RerankerSettingsTab({ readOnly = false }: { readOnly?: boolean }) {
  const [settings, setSettings] = useState<RerankerSettings | null>(null);
  const [editedSettings, setEditedSettings] = useState<Omit<RerankerSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  // Cohere API key is now managed in Settings → API Keys
  const [rerankerStatus, setRerankerStatus] = useState<RerankerProviderStatus[]>([]);
  const [isModified, setIsModified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return 'Never';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString();
  };

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);

      // Fetch settings and reranker status in parallel
      const [settingsRes, statusRes] = await Promise.all([
        fetch('/api/admin/settings'),
        fetch('/api/admin/reranker-status'),
      ]);

      if (!settingsRes.ok) throw new Error('Failed to fetch settings');
      const settingsData = await settingsRes.json();

      const rerankerData = settingsData.reranker || {
        enabled: false,
        providers: DEFAULT_PROVIDERS,
        topKForReranking: 50,
        minRerankerScore: 0.3,
        cacheTTLSeconds: 3600,
      };

      // Ensure providers array exists (backward compatibility)
      if (!rerankerData.providers) {
        rerankerData.providers = DEFAULT_PROVIDERS;
      }

      setSettings(rerankerData);
      setEditedSettings({
        enabled: rerankerData.enabled,
        providers: rerankerData.providers,
        topKForReranking: rerankerData.topKForReranking,
        minRerankerScore: rerankerData.minRerankerScore,
        cacheTTLSeconds: rerankerData.cacheTTLSeconds,
      });

      // Load reranker status
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setRerankerStatus((statusData.providers || []).filter(Boolean));
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchRerankerStatus = useCallback(async () => {
    try {
      const statusRes = await fetch('/api/admin/reranker-status');
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setRerankerStatus((statusData.providers || []).filter(Boolean));
      }
    } catch {
      // status refresh is best-effort
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    if (!editedSettings || !isModified) return;

    try {
      setIsSaving(true);

      const settingsToSave = {
        ...editedSettings,
      };

      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'reranker', settings: settingsToSave }),
      });

      if (!res.ok) throw new Error('Failed to save settings');

      const data = await res.json();
      const savedSettings = data.settings;
      setSettings(savedSettings);
      setEditedSettings({
        enabled: savedSettings.enabled,
        providers: savedSettings.providers,
        topKForReranking: savedSettings.topKForReranking,
        minRerankerScore: savedSettings.minRerankerScore,
        cacheTTLSeconds: savedSettings.cacheTTLSeconds,
      });
      setIsModified(false);
      setSuccess('Reranker settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);

      // Refresh availability status only (not full settings, to avoid overwriting saved state)
      fetchRerankerStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (settings) {
      setEditedSettings({
        enabled: settings.enabled,
        providers: settings.providers,
        topKForReranking: settings.topKForReranking,
        minRerankerScore: settings.minRerankerScore,
        cacheTTLSeconds: settings.cacheTTLSeconds,
      });
      setIsModified(false);
    }
  };

  const updateSetting = <K extends keyof Omit<RerankerSettings, 'updatedAt' | 'updatedBy'>>(
    key: K,
    value: Omit<RerankerSettings, 'updatedAt' | 'updatedBy'>[K]
  ) => {
    if (editedSettings) {
      setEditedSettings({ ...editedSettings, [key]: value });
      setIsModified(true);
    }
  };

  // Move provider up in priority
  const moveProviderUp = (index: number) => {
    if (!editedSettings || index === 0) return;
    const newProviders = [...editedSettings.providers];
    [newProviders[index - 1], newProviders[index]] = [newProviders[index], newProviders[index - 1]];
    updateSetting('providers', newProviders);
  };

  // Move provider down in priority
  const moveProviderDown = (index: number) => {
    if (!editedSettings || index === editedSettings.providers.length - 1) return;
    const newProviders = [...editedSettings.providers];
    [newProviders[index], newProviders[index + 1]] = [newProviders[index + 1], newProviders[index]];
    updateSetting('providers', newProviders);
  };

  // Toggle provider enabled/disabled
  const toggleProviderEnabled = (index: number) => {
    if (!editedSettings) return;
    const newProviders = [...editedSettings.providers];
    newProviders[index] = { ...newProviders[index], enabled: !newProviders[index].enabled };
    updateSetting('providers', newProviders);
  };

  // Check if a provider is available
  const isProviderAvailable = (provider: RerankerProvider): boolean => {
    const status = rerankerStatus.find(s => s?.provider === provider);
    return status?.available ?? true;
  };

  // Check if Cohere is enabled in the providers list
  const isCohereEnabled = editedSettings?.providers.some(p => p.provider === 'cohere' && p.enabled);

  return (
    <div className={`space-y-4 ${readOnly ? '[&_input]:pointer-events-none [&_select]:pointer-events-none [&_textarea]:pointer-events-none [&_input]:opacity-75 [&_select]:opacity-75' : ''}`}>
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">×</button>
        </div>
      )}

      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {/* Reranker Status Dashboard */}
      <div className="bg-white rounded-lg border shadow-sm p-4">
        <h3 className="text-sm font-medium text-gray-900 mb-3">Provider Availability</h3>
        <div className="grid grid-cols-2 gap-4">
          {rerankerStatus.map((status) => (
            <div key={status.provider} className={`p-3 rounded-lg border ${
              status.available ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${status.available ? 'bg-green-500' : 'bg-gray-400'}`} />
                  <span className="font-medium text-gray-900">{status.name}</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {status.available ? 'Available' : (status.error || 'Unavailable')}
                {status.latency && ` • ${status.latency}ms`}
              </p>
            </div>
          ))}
          {rerankerStatus.length === 0 && (
            <p className="text-sm text-gray-500 col-span-2">No reranker providers found</p>
          )}
        </div>
      </div>

      {/* Reranker Configuration Card */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">Reranker</h2>
              <p className="text-sm text-gray-500">Configure document reranking for improved RAG quality</p>
            </div>
            {!readOnly && (
              <div className="flex items-center gap-2">
                {isModified && (
                  <Button variant="secondary" onClick={handleReset} disabled={isSaving}>
                    Reset
                  </Button>
                )}
                <Button onClick={handleSave} disabled={!isModified || isSaving} loading={isSaving}>
                  <Save size={18} className="mr-2" />
                  Save
                </Button>
              </div>
            )}
          </div>
        </div>
        {isLoading ? (
          <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
        ) : editedSettings ? (
          <div className="p-6 space-y-6">
            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label className="font-medium text-gray-900">Enable Reranker</label>
                <p className="text-sm text-gray-500">Rerank retrieved chunks for better relevance ordering</p>
              </div>
              <input
                type="checkbox"
                checked={editedSettings.enabled}
                onChange={(e) => updateSetting('enabled', e.target.checked)}
                className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </div>

            {/* Provider Priority List */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">Provider Priority</label>
              <p className="text-xs text-gray-500 mb-3">
                Providers are tried in order from top to bottom. If one fails, the next enabled provider is used.
              </p>
              <div className="space-y-2">
                {editedSettings.providers.map((config, index) => {
                  const info = RERANKER_PROVIDER_INFO[config.provider];
                  const available = isProviderAvailable(config.provider);
                  return (
                    <div
                      key={config.provider}
                      className={`flex items-center gap-3 p-3 rounded-lg border ${
                        config.enabled && available
                          ? 'bg-white border-gray-200'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      {/* Priority indicator */}
                      <div className="flex items-center gap-1 text-gray-400">
                        <GripVertical size={16} />
                        <span className="text-xs font-mono w-4">{index + 1}</span>
                      </div>

                      {/* Up/Down buttons */}
                      <div className="flex flex-col gap-0.5">
                        <button
                          onClick={() => moveProviderUp(index)}
                          disabled={index === 0}
                          className={`p-0.5 rounded ${
                            index === 0
                              ? 'text-gray-300 cursor-not-allowed'
                              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => moveProviderDown(index)}
                          disabled={index === editedSettings.providers.length - 1}
                          className={`p-0.5 rounded ${
                            index === editedSettings.providers.length - 1
                              ? 'text-gray-300 cursor-not-allowed'
                              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>

                      {/* Provider info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${config.enabled ? 'text-gray-900' : 'text-gray-500'}`}>
                            {info.label}
                          </span>
                          {!available && (
                            <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">
                              Unavailable
                            </span>
                          )}
                          {index === 0 && config.enabled && available && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                              Primary
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 truncate">{info.description}</p>
                      </div>

                      {/* Enable toggle */}
                      <input
                        type="checkbox"
                        checked={config.enabled}
                        onChange={() => toggleProviderEnabled(index)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Cohere API Key - show only when Cohere provider is enabled */}
            {isCohereEnabled && (
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Cohere API Key</label>
                <p className="text-sm text-gray-600 mb-2">
                  {settings?.hasCohereApiKey ? (
                    <span className="text-green-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                      Configured
                    </span>
                  ) : (
                    <span className="text-gray-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
                      Not configured
                    </span>
                  )}
                </p>
                <div className="p-2.5 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-2">
                  <KeyRound size={14} className="text-blue-600 flex-shrink-0" />
                  <p className="text-xs text-blue-800">
                    API keys are managed in{' '}
                    <a href="/admin?tab=settings&section=api-keys" className="text-blue-600 font-medium hover:underline">
                      Settings &rarr; API Keys
                    </a>
                  </p>
                </div>
              </div>
            )}

            {/* Settings Grid */}
            <div className="grid grid-cols-2 gap-6">
              {/* Top K for Reranking */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Top K for Reranking</label>
                <input
                  type="number"
                  min="5"
                  max="100"
                  value={editedSettings.topKForReranking}
                  onChange={(e) => updateSetting('topKForReranking', parseInt(e.target.value) || 50)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Number of chunks to rerank (5-100)</p>
              </div>

              {/* Min Score Threshold */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Min Score Threshold</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={editedSettings.minRerankerScore}
                  onChange={(e) => updateSetting('minRerankerScore', parseFloat(e.target.value) || 0.3)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Chunks below this score are filtered (0-1)</p>
              </div>

              {/* Cache TTL */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Cache Duration</label>
                <input
                  type="number"
                  min="60"
                  max="86400"
                  value={editedSettings.cacheTTLSeconds}
                  onChange={(e) => updateSetting('cacheTTLSeconds', parseInt(e.target.value) || 3600)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {Math.floor(editedSettings.cacheTTLSeconds / 60)} minutes (60s - 86,400s)
                </p>
              </div>
            </div>

            {/* Last Updated */}
            {settings?.updatedAt && (
              <p className="text-xs text-gray-500">
                Last updated: {formatDate(settings.updatedAt)} by {settings.updatedBy}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

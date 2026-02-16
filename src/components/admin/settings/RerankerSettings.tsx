'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface RerankerSettings {
  enabled: boolean;
  provider: 'cohere' | 'jina' | 'local';
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

export default function RerankerSettingsTab() {
  const [settings, setSettings] = useState<RerankerSettings | null>(null);
  const [editedSettings, setEditedSettings] = useState<Omit<RerankerSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [cohereApiKeyInput, setCohereApiKeyInput] = useState('');
  const [rerankerStatus, setRerankerStatus] = useState<RerankerProviderStatus[]>([]);
  const [isModified, setIsModified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const formatDate = (date: Date | string) => {
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
        provider: 'cohere',
        topKForReranking: 50,
        minRerankerScore: 0.3,
        cacheTTLSeconds: 3600,
      };

      setSettings(rerankerData);
      setEditedSettings({
        enabled: rerankerData.enabled,
        provider: rerankerData.provider,
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

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    if (!editedSettings || !isModified) return;

    try {
      setIsSaving(true);

      // Include Cohere API key if it was entered
      const settingsToSave = {
        ...editedSettings,
        ...(cohereApiKeyInput ? { cohereApiKey: cohereApiKeyInput } : {}),
      };

      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'reranker', settings: settingsToSave }),
      });

      if (!res.ok) throw new Error('Failed to save settings');

      const data = await res.json();
      setSettings(data.settings);
      setCohereApiKeyInput(''); // Clear the input after save
      setIsModified(false);
      setSuccess('Reranker settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);

      // Refresh status after saving
      fetchSettings();
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
        provider: settings.provider,
        topKForReranking: settings.topKForReranking,
        minRerankerScore: settings.minRerankerScore,
        cacheTTLSeconds: settings.cacheTTLSeconds,
      });
      setCohereApiKeyInput('');
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

  return (
    <div className="space-y-4">
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
        <h3 className="text-sm font-medium text-gray-900 mb-3">Reranker Status</h3>
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
                {editedSettings?.provider === status.provider && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Active</span>
                )}
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
        <div className="mt-3 pt-3 border-t text-xs text-gray-500">
          <span className="font-medium">Default:</span> {editedSettings?.provider === 'cohere' ? 'Cohere API' : 'Local'} •
          <span className="font-medium ml-2">Fallback:</span> {editedSettings?.provider === 'cohere' ? 'Local' : 'None'}
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

            {/* Provider Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Reranker Provider</label>
              <select
                value={editedSettings.provider}
                onChange={(e) => updateSetting('provider', e.target.value as 'cohere' | 'jina' | 'local')}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {(() => {
                  const cohereStatus = rerankerStatus.find(s => s?.provider === 'cohere');
                  const jinaStatus = rerankerStatus.find(s => s?.provider === 'jina');
                  const localStatus = rerankerStatus.find(s => s?.provider === 'local');
                  const cohereAvailable = cohereStatus?.available ?? true;
                  const jinaAvailable = jinaStatus?.available ?? true;
                  const localAvailable = localStatus?.available ?? true;
                  return (
                    <>
                      <option value="cohere" disabled={!cohereAvailable}>
                        Cohere API (Fast, requires API key){!cohereAvailable ? ' (unavailable)' : ''}
                      </option>
                      <option value="jina" disabled={!jinaAvailable}>
                        Jina Reranker v2 (Best accuracy, free){!jinaAvailable ? ' (unavailable)' : ''}
                      </option>
                      <option value="local" disabled={!localAvailable}>
                        Legacy Local (Bi-encoder, less accurate){!localAvailable ? ' (unavailable)' : ''}
                      </option>
                    </>
                  );
                })()}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {editedSettings.provider === 'cohere'
                  ? 'Uses Cohere rerank-english-v3.0 model.'
                  : editedSettings.provider === 'jina'
                  ? 'Uses Jina Reranker v2 cross-encoder model. Best accuracy, ~500MB download on first use.'
                  : 'Legacy bi-encoder using all-MiniLM-L6-v2. Less accurate than cross-encoder rerankers.'}
              </p>
            </div>

            {/* Cohere API Key - show only when Cohere provider is selected */}
            {editedSettings.provider === 'cohere' && (
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Cohere API Key</label>
                <input
                  type="password"
                  value={cohereApiKeyInput}
                  onChange={(e) => {
                    setCohereApiKeyInput(e.target.value);
                    setIsModified(true);
                  }}
                  placeholder={settings?.hasCohereApiKey ? '••••••••' : 'Enter Cohere API key'}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {settings?.hasCohereApiKey ? (
                    <span className="text-green-600">API key configured. Enter a new key to update.</span>
                  ) : (
                    <>
                      Get your API key from{' '}
                      <a
                        href="https://dashboard.cohere.com/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        dashboard.cohere.com
                      </a>
                    </>
                  )}
                </p>
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

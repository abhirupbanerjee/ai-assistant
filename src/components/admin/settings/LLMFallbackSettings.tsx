'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface EligibleModel {
  id: string;
  displayName: string;
  providerId: string;
}

interface UnhealthyModel {
  modelId: string;
  expiresAt: string;
}

interface LlmFallbackSettings {
  universalFallback: string | null;
  maxRetryAttempts: number;
  healthCacheDuration: 'hourly' | 'daily' | 'disabled';
}

interface FallbackSettingsResponse {
  settings: LlmFallbackSettings;
  eligibleFallbackModels: EligibleModel[];
  healthCache: {
    unhealthyModels: UnhealthyModel[];
    duration: 'hourly' | 'daily' | 'disabled';
  };
}

export default function LLMFallbackSettingsTab() {
  const [data, setData] = useState<FallbackSettingsResponse | null>(null);
  const [editedSettings, setEditedSettings] = useState<LlmFallbackSettings | null>(null);
  const [isModified, setIsModified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString();
  };

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/admin/settings/llm-fallback');
      if (!res.ok) throw new Error('Failed to fetch settings');
      const responseData: FallbackSettingsResponse = await res.json();

      setData(responseData);
      setEditedSettings({ ...responseData.settings });
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
    if (!editedSettings) return;

    try {
      setIsSaving(true);
      const res = await fetch('/api/admin/settings/llm-fallback', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedSettings),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to save settings');
      }

      await fetchSettings();
      setIsModified(false);
      setSuccess('LLM fallback settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearHealthCache = async () => {
    try {
      setIsClearingCache(true);
      const res = await fetch('/api/admin/settings/llm-fallback', {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to clear health cache');

      await fetchSettings();
      setSuccess('Health cache cleared - all models marked as healthy');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear health cache');
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleReset = () => {
    if (data) {
      setEditedSettings({ ...data.settings });
      setIsModified(false);
    }
  };

  const updateSetting = <K extends keyof LlmFallbackSettings>(
    key: K,
    value: LlmFallbackSettings[K]
  ) => {
    if (editedSettings) {
      setEditedSettings({ ...editedSettings, [key]: value });
      setIsModified(true);
    }
  };

  return (
    <div className="bg-white rounded-lg border shadow-sm">
      <div className="px-6 py-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">LLM Fallback</h2>
            <p className="text-sm text-gray-500">
              Configure automatic model failover when primary LLM is unavailable
            </p>
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

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">×</button>
        </div>
      )}

      {success && (
        <div className="mx-6 mt-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <CheckCircle size={16} className="text-green-600" />
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {isLoading ? (
        <div className="px-6 py-12 flex justify-center">
          <Spinner size="lg" />
        </div>
      ) : data && editedSettings ? (
        <div className="p-6 space-y-6">
          {/* Universal Fallback Model */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Universal Fallback Model</label>
            <select
              value={editedSettings.universalFallback || ''}
              onChange={(e) => updateSetting('universalFallback', e.target.value || null)}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">None (Fallback disabled)</option>
              {data.eligibleFallbackModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName} ({model.providerId})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Only models with both vision and tool capabilities are eligible
            </p>
            {data.eligibleFallbackModels.length === 0 && (
              <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded flex items-center gap-2">
                <AlertTriangle size={14} className="text-yellow-600" />
                <p className="text-xs text-yellow-700">
                  No eligible models found. Enable a model with vision and tool capabilities.
                </p>
              </div>
            )}
          </div>

          {/* Settings Grid */}
          <div className="grid grid-cols-2 gap-6">
            {/* Max Retry Attempts */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Max Retry Attempts</label>
              <select
                value={editedSettings.maxRetryAttempts}
                onChange={(e) => updateSetting('maxRetryAttempts', parseInt(e.target.value))}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value={1}>1 (No fallback)</option>
                <option value={2}>2 (Selected + Fallback)</option>
                <option value={3}>3 (Extended retry)</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Number of models to try before giving up
              </p>
            </div>

            {/* Health Cache Duration */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Health Cache Duration</label>
              <select
                value={editedSettings.healthCacheDuration}
                onChange={(e) => updateSetting('healthCacheDuration', e.target.value as 'hourly' | 'daily' | 'disabled')}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="disabled">Disabled (Check every request)</option>
                <option value="hourly">Hourly (Skip failed models for 1 hour)</option>
                <option value="daily">Daily (Skip failed models for 24 hours)</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                How long to remember failed models before retrying
              </p>
            </div>
          </div>

          {/* Health Cache Status */}
          <div className="border-t pt-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-medium text-gray-900">Health Cache Status</h3>
                <p className="text-sm text-gray-500">
                  Models temporarily marked as unhealthy after failures
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={handleClearHealthCache}
                disabled={isClearingCache || data.healthCache.unhealthyModels.length === 0}
                loading={isClearingCache}
              >
                <RefreshCw size={16} className="mr-2" />
                Clear Cache
              </Button>
            </div>

            {data.healthCache.unhealthyModels.length === 0 ? (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
                <CheckCircle size={16} className="text-green-600" />
                <p className="text-sm text-green-700">All models are healthy</p>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Model</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Healthy At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {data.healthCache.unhealthyModels.map((model) => (
                      <tr key={model.modelId}>
                        <td className="px-4 py-2 text-sm text-gray-900">{model.modelId}</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{formatDate(model.expiresAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Info Box */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-2">How Fallback Works</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• When the selected model fails (rate limit, quota, etc.), the fallback model is used</li>
              <li>• If a non-vision model is selected but images are attached, fallback is used automatically</li>
              <li>• Failed models are cached to avoid repeated failures within the cache duration</li>
              <li>• Users are notified in chat when a model switch occurs</li>
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}

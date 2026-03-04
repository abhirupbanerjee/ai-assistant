'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface MemorySettings {
  enabled: boolean;
  extractionThreshold: number;
  maxFactsPerCategory: number;
  autoExtractOnThreadEnd: boolean;
  extractionMaxTokens: number;
  updatedAt?: string;
  updatedBy?: string;
}

export default function MemorySettingsTab() {
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [editedSettings, setEditedSettings] = useState<Omit<MemorySettings, 'updatedAt' | 'updatedBy'> | null>(null);
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
      const res = await fetch('/api/admin/settings');
      if (!res.ok) throw new Error('Failed to fetch settings');
      const data = await res.json();

      const memoryData = data.memory || {
        enabled: false,
        extractionThreshold: 5,
        maxFactsPerCategory: 20,
        autoExtractOnThreadEnd: true,
        extractionMaxTokens: 1000,
      };

      setSettings(memoryData);
      setEditedSettings({
        enabled: memoryData.enabled,
        extractionThreshold: memoryData.extractionThreshold,
        maxFactsPerCategory: memoryData.maxFactsPerCategory,
        autoExtractOnThreadEnd: memoryData.autoExtractOnThreadEnd,
        extractionMaxTokens: memoryData.extractionMaxTokens,
      });
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
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'memory', settings: editedSettings }),
      });

      if (!res.ok) throw new Error('Failed to save settings');

      await fetchSettings();
      setIsModified(false);
      setSuccess('Memory settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);
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
        extractionThreshold: settings.extractionThreshold,
        maxFactsPerCategory: settings.maxFactsPerCategory,
        autoExtractOnThreadEnd: settings.autoExtractOnThreadEnd,
        extractionMaxTokens: settings.extractionMaxTokens,
      });
      setIsModified(false);
    }
  };

  const updateSetting = <K extends keyof Omit<MemorySettings, 'updatedAt' | 'updatedBy'>>(
    key: K,
    value: Omit<MemorySettings, 'updatedAt' | 'updatedBy'>[K]
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
            <h2 className="font-semibold text-gray-900">User Memory</h2>
            <p className="text-sm text-gray-500">
              Extract and store facts about users across conversations
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
        <div className="mx-6 mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {isLoading ? (
        <div className="px-6 py-12 flex justify-center">
          <Spinner size="lg" />
        </div>
      ) : editedSettings ? (
        <div className="p-6 space-y-6">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <label className="font-medium text-gray-900">Enable Memory</label>
              <p className="text-sm text-gray-500">Automatically extract and remember facts about users</p>
            </div>
            <input
              type="checkbox"
              checked={editedSettings.enabled}
              onChange={(e) => updateSetting('enabled', e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </div>

          {/* Settings Grid */}
          <div className="grid grid-cols-2 gap-6">
            {/* Extraction Threshold */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Extraction Threshold</label>
              <input
                type="number"
                min="1"
                max="50"
                value={editedSettings.extractionThreshold}
                onChange={(e) => updateSetting('extractionThreshold', parseInt(e.target.value) || 5)}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">Minimum messages before extraction (1-50)</p>
            </div>

            {/* Max Facts Per Category */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Max Facts Per Category</label>
              <input
                type="number"
                min="5"
                max="100"
                value={editedSettings.maxFactsPerCategory}
                onChange={(e) => updateSetting('maxFactsPerCategory', parseInt(e.target.value) || 20)}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">Maximum facts stored per category (5-100)</p>
            </div>

            {/* Extraction Max Tokens */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Extraction Max Tokens</label>
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium text-gray-900">{editedSettings.extractionMaxTokens?.toLocaleString() ?? '1000'}</span>
                <span className="text-xs text-gray-400">tokens</span>
              </div>
              <p className="mt-1 text-xs text-blue-500">Configure in Settings → Limits → Token Limits</p>
            </div>
          </div>

          {/* Auto Extract Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <label className="font-medium text-gray-900">Auto-Extract on Thread End</label>
              <p className="text-sm text-gray-500">Automatically extract facts when conversations end</p>
            </div>
            <input
              type="checkbox"
              checked={editedSettings.autoExtractOnThreadEnd}
              onChange={(e) => updateSetting('autoExtractOnThreadEnd', e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
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
  );
}

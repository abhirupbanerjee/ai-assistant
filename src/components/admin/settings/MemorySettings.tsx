'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface MemorySettings {
  enabled: boolean;
  automaticPreferenceExtractionEnabled: boolean;
  automaticInterestExtractionEnabled: boolean;
  extractionThreshold: number;
  maxInterestsPerUser: number;
  inferredPreferencesRequireConfirmation: boolean;
  extractionMaxTokens: number;
  categoryMemoryEnabled: boolean;
  categoryMemoryMaxActiveItems: number;
  categoryMemoryMaxRetrievedItems: number;
  categoryMemoryTokenBudget: number;
  suggestionsEnabled: boolean;
  automaticCategoryCandidateExtractionEnabled: boolean;
  categoryCandidateExtractionThreshold: number;
  categoryCandidateConfidenceThreshold: number;
  categoryCandidateExtractionMaxTokens: number;
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
        automaticPreferenceExtractionEnabled: true,
        automaticInterestExtractionEnabled: true,
        extractionThreshold: 5,
        maxInterestsPerUser: 25,
        inferredPreferencesRequireConfirmation: false,
        extractionMaxTokens: 1000,
        categoryMemoryEnabled: false,
        categoryMemoryMaxActiveItems: 100,
        categoryMemoryMaxRetrievedItems: 5,
        categoryMemoryTokenBudget: 800,
        suggestionsEnabled: true,
        automaticCategoryCandidateExtractionEnabled: false,
        categoryCandidateExtractionThreshold: 6,
        categoryCandidateConfidenceThreshold: 0.85,
        categoryCandidateExtractionMaxTokens: 600,
      };

      setSettings(memoryData);
      setEditedSettings({
        enabled: memoryData.enabled,
        automaticPreferenceExtractionEnabled: memoryData.automaticPreferenceExtractionEnabled,
        automaticInterestExtractionEnabled: memoryData.automaticInterestExtractionEnabled,
        extractionThreshold: memoryData.extractionThreshold,
        maxInterestsPerUser: memoryData.maxInterestsPerUser,
        inferredPreferencesRequireConfirmation: memoryData.inferredPreferencesRequireConfirmation,
        extractionMaxTokens: memoryData.extractionMaxTokens,
        categoryMemoryEnabled: memoryData.categoryMemoryEnabled,
        categoryMemoryMaxActiveItems: memoryData.categoryMemoryMaxActiveItems,
        categoryMemoryMaxRetrievedItems: memoryData.categoryMemoryMaxRetrievedItems,
        categoryMemoryTokenBudget: memoryData.categoryMemoryTokenBudget,
        suggestionsEnabled: memoryData.suggestionsEnabled,
        automaticCategoryCandidateExtractionEnabled: memoryData.automaticCategoryCandidateExtractionEnabled,
        categoryCandidateExtractionThreshold: memoryData.categoryCandidateExtractionThreshold,
        categoryCandidateConfidenceThreshold: memoryData.categoryCandidateConfidenceThreshold,
        categoryCandidateExtractionMaxTokens: memoryData.categoryCandidateExtractionMaxTokens,
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
        automaticPreferenceExtractionEnabled: settings.automaticPreferenceExtractionEnabled,
        automaticInterestExtractionEnabled: settings.automaticInterestExtractionEnabled,
        extractionThreshold: settings.extractionThreshold,
        maxInterestsPerUser: settings.maxInterestsPerUser,
        inferredPreferencesRequireConfirmation: settings.inferredPreferencesRequireConfirmation,
        extractionMaxTokens: settings.extractionMaxTokens,
        categoryMemoryEnabled: settings.categoryMemoryEnabled,
        categoryMemoryMaxActiveItems: settings.categoryMemoryMaxActiveItems,
        categoryMemoryMaxRetrievedItems: settings.categoryMemoryMaxRetrievedItems,
        categoryMemoryTokenBudget: settings.categoryMemoryTokenBudget,
        suggestionsEnabled: settings.suggestionsEnabled,
        automaticCategoryCandidateExtractionEnabled: settings.automaticCategoryCandidateExtractionEnabled,
        categoryCandidateExtractionThreshold: settings.categoryCandidateExtractionThreshold,
        categoryCandidateConfidenceThreshold: settings.categoryCandidateConfidenceThreshold,
        categoryCandidateExtractionMaxTokens: settings.categoryCandidateExtractionMaxTokens,
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
            <h2 className="font-semibold text-gray-900">Personal Memory</h2>
            <p className="text-sm text-gray-500">
              Independent controls for private response preferences and interests
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
              <label className="font-medium text-gray-900">Enable Personal Memory</label>
              <p className="text-sm text-gray-500">Apply configured preferences and selectively matching interests in main chat</p>
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

            {/* Maximum interests */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Maximum Interests Per User</label>
              <input
                type="number"
                min="5"
                max="100"
                value={editedSettings.maxInterestsPerUser}
                onChange={(e) => updateSetting('maxInterestsPerUser', parseInt(e.target.value) || 25)}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">Configured and learned topics combined (5-100)</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Category Memory</label>
              <label className="flex items-center gap-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-700"><input type="checkbox" checked={editedSettings.categoryMemoryEnabled} onChange={(e) => updateSetting('categoryMemoryEnabled', e.target.checked)}/>Enable globally for main chat</label>
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="text-sm font-medium text-gray-900">Max active items/category<input type="number" min="1" max="500" value={editedSettings.categoryMemoryMaxActiveItems} onChange={(e) => updateSetting('categoryMemoryMaxActiveItems', parseInt(e.target.value) || 100)} className="mt-1 w-full px-3 py-2 border rounded-lg" /></label>
            <label className="text-sm font-medium text-gray-900">Max retrieved/query<input type="number" min="1" max="10" value={editedSettings.categoryMemoryMaxRetrievedItems} onChange={(e) => updateSetting('categoryMemoryMaxRetrievedItems', parseInt(e.target.value) || 5)} className="mt-1 w-full px-3 py-2 border rounded-lg" /></label>
            <label className="text-sm font-medium text-gray-900">Retrieval token budget<input type="number" min="100" max="4000" value={editedSettings.categoryMemoryTokenBudget} onChange={(e) => updateSetting('categoryMemoryTokenBudget', parseInt(e.target.value) || 800)} className="mt-1 w-full px-3 py-2 border rounded-lg" /></label>
          </div>
          <div className="flex items-center justify-between"><div><label className="font-medium text-gray-900">Category Memory suggestions</label><p className="text-sm text-gray-500">Allow authenticated main-chat users with effective category access to submit moderated suggestions</p></div><input type="checkbox" checked={editedSettings.suggestionsEnabled} onChange={(e) => updateSetting('suggestionsEnabled', e.target.checked)} className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" /></div>

          <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 space-y-4">
            <div className="flex items-center justify-between gap-4"><div><label className="font-medium text-gray-900">Assisted category candidate extraction</label><p className="text-sm text-gray-500">Main chat only. Creates unapproved suggestions after deterministic redaction; never indexes or auto-approves.</p></div><input type="checkbox" checked={editedSettings.automaticCategoryCandidateExtractionEnabled} onChange={(e) => updateSetting('automaticCategoryCandidateExtractionEnabled', e.target.checked)} className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-sm font-medium text-gray-900">Message threshold<input type="number" min="2" max="50" value={editedSettings.categoryCandidateExtractionThreshold} onChange={(e) => updateSetting('categoryCandidateExtractionThreshold', parseInt(e.target.value) || 6)} className="mt-1 w-full px-3 py-2 border rounded-lg" /><span className="block mt-1 text-xs font-normal text-gray-500">Recent messages required (2–50)</span></label>
              <label className="text-sm font-medium text-gray-900">Confidence threshold<input type="number" min="0.5" max="1" step="0.05" value={editedSettings.categoryCandidateConfidenceThreshold} onChange={(e) => updateSetting('categoryCandidateConfidenceThreshold', parseFloat(e.target.value) || 0.85)} className="mt-1 w-full px-3 py-2 border rounded-lg" /><span className="block mt-1 text-xs font-normal text-gray-500">Conservative acceptance (0.5–1)</span></label>
              <label className="text-sm font-medium text-gray-900">Extraction token budget<input type="number" min="100" max="2000" value={editedSettings.categoryCandidateExtractionMaxTokens} onChange={(e) => updateSetting('categoryCandidateExtractionMaxTokens', parseInt(e.target.value) || 600)} className="mt-1 w-full px-3 py-2 border rounded-lg" /><span className="block mt-1 text-xs font-normal text-gray-500">Structured output cap (100–2,000)</span></label>
            </div>
          </div>

          {/* Extraction toggles */}
          <div className="flex items-center justify-between">
            <div>
              <label className="font-medium text-gray-900">Learn durable response preferences</label>
              <p className="text-sm text-gray-500">Typed post-response extraction; explicit profile values are protected</p>
            </div>
            <input
              type="checkbox"
              checked={editedSettings.automaticPreferenceExtractionEnabled}
              onChange={(e) => updateSetting('automaticPreferenceExtractionEnabled', e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center justify-between"><div><label className="font-medium text-gray-900">Learn interests</label><p className="text-sm text-gray-500">Store bounded, selectively matched topics</p></div><input type="checkbox" checked={editedSettings.automaticInterestExtractionEnabled} onChange={(e) => updateSetting('automaticInterestExtractionEnabled', e.target.checked)} className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" /></div>

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

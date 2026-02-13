'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface TokenLimitsSettings {
  promptOptimizationMaxTokens: number;
  skillsMaxTotalTokens: number;
  memoryExtractionMaxTokens: number;
  summaryMaxTokens: number;
  systemPromptMaxTokens: number;
  categoryPromptMaxTokens: number;
  starterLabelMaxChars: number;
  starterPromptMaxChars: number;
  maxStartersPerCategory: number;
  updatedAt?: string;
  updatedBy?: string;
}

export default function TokenLimitsSettingsTab() {
  const [settings, setSettings] = useState<TokenLimitsSettings | null>(null);
  const [editedSettings, setEditedSettings] = useState<Omit<TokenLimitsSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [isModified, setIsModified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/admin/settings');
      if (!res.ok) throw new Error('Failed to fetch settings');
      const data = await res.json();

      const tokenLimitsData = data.tokenLimits || {
        promptOptimizationMaxTokens: 500,
        skillsMaxTotalTokens: 2000,
        memoryExtractionMaxTokens: 1000,
        summaryMaxTokens: 500,
        systemPromptMaxTokens: 4000,
        categoryPromptMaxTokens: 2000,
        starterLabelMaxChars: 50,
        starterPromptMaxChars: 200,
        maxStartersPerCategory: 6,
      };

      setSettings(tokenLimitsData);
      setEditedSettings({
        promptOptimizationMaxTokens: tokenLimitsData.promptOptimizationMaxTokens,
        skillsMaxTotalTokens: tokenLimitsData.skillsMaxTotalTokens,
        memoryExtractionMaxTokens: tokenLimitsData.memoryExtractionMaxTokens,
        summaryMaxTokens: tokenLimitsData.summaryMaxTokens,
        systemPromptMaxTokens: tokenLimitsData.systemPromptMaxTokens,
        categoryPromptMaxTokens: tokenLimitsData.categoryPromptMaxTokens,
        starterLabelMaxChars: tokenLimitsData.starterLabelMaxChars,
        starterPromptMaxChars: tokenLimitsData.starterPromptMaxChars,
        maxStartersPerCategory: tokenLimitsData.maxStartersPerCategory,
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
    if (!editedSettings || !isModified) return;

    try {
      setIsSaving(true);
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'token-limits', settings: editedSettings }),
      });

      if (!res.ok) throw new Error('Failed to save token limits settings');

      const data = await res.json();
      setSettings(data.tokenLimits);
      setIsModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save token limits settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (settings) {
      setEditedSettings({
        promptOptimizationMaxTokens: settings.promptOptimizationMaxTokens,
        skillsMaxTotalTokens: settings.skillsMaxTotalTokens,
        memoryExtractionMaxTokens: settings.memoryExtractionMaxTokens,
        summaryMaxTokens: settings.summaryMaxTokens,
        systemPromptMaxTokens: settings.systemPromptMaxTokens,
        categoryPromptMaxTokens: settings.categoryPromptMaxTokens,
        starterLabelMaxChars: settings.starterLabelMaxChars,
        starterPromptMaxChars: settings.starterPromptMaxChars,
        maxStartersPerCategory: settings.maxStartersPerCategory,
      });
      setIsModified(false);
    }
  };

  const updateSetting = <K extends keyof Omit<TokenLimitsSettings, 'updatedAt' | 'updatedBy'>>(
    key: K,
    value: number
  ) => {
    if (editedSettings) {
      setEditedSettings({ ...editedSettings, [key]: value });
      setIsModified(true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">Token Limits</h2>
              <p className="text-sm text-gray-500">Configure token limits for various system components</p>
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
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">&times;</button>
        </div>
      )}

      {isLoading ? (
        <div className="bg-white rounded-lg border shadow-sm px-6 py-12 flex justify-center">
          <Spinner size="lg" />
        </div>
      ) : editedSettings ? (
        <>
          {/* LLM Token Limits */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <h3 className="font-medium text-gray-900">LLM Processing Limits</h3>
              <p className="text-sm text-gray-500">Token limits for LLM operations</p>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Prompt Optimization Max Tokens</label>
                <input
                  type="number"
                  value={editedSettings.promptOptimizationMaxTokens}
                  onChange={(e) => updateSetting('promptOptimizationMaxTokens', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Max tokens for prompt optimization</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Skills Max Total Tokens</label>
                <input
                  type="number"
                  value={editedSettings.skillsMaxTotalTokens}
                  onChange={(e) => updateSetting('skillsMaxTotalTokens', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Total tokens across all skills</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Memory Extraction Max Tokens</label>
                <input
                  type="number"
                  value={editedSettings.memoryExtractionMaxTokens}
                  onChange={(e) => updateSetting('memoryExtractionMaxTokens', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Max tokens for memory extraction</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Summary Max Tokens</label>
                <input
                  type="number"
                  value={editedSettings.summaryMaxTokens}
                  onChange={(e) => updateSetting('summaryMaxTokens', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Max tokens for conversation summaries</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">System Prompt Max Tokens</label>
                <input
                  type="number"
                  value={editedSettings.systemPromptMaxTokens}
                  onChange={(e) => updateSetting('systemPromptMaxTokens', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Max tokens for system prompt</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Category Prompt Max Tokens</label>
                <input
                  type="number"
                  value={editedSettings.categoryPromptMaxTokens}
                  onChange={(e) => updateSetting('categoryPromptMaxTokens', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Max tokens for category prompts</p>
              </div>
            </div>
          </div>

          {/* Starter Prompts Limits */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <h3 className="font-medium text-gray-900">Starter Prompts Limits</h3>
              <p className="text-sm text-gray-500">Character limits for starter prompts</p>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Starter Label Max Chars</label>
                <input
                  type="number"
                  value={editedSettings.starterLabelMaxChars}
                  onChange={(e) => updateSetting('starterLabelMaxChars', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Starter Prompt Max Chars</label>
                <input
                  type="number"
                  value={editedSettings.starterPromptMaxChars}
                  onChange={(e) => updateSetting('starterPromptMaxChars', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Max Starters Per Category</label>
                <input
                  type="number"
                  value={editedSettings.maxStartersPerCategory}
                  onChange={(e) => updateSetting('maxStartersPerCategory', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Last Updated */}
          {settings?.updatedAt && (
            <p className="text-xs text-gray-400">
              Last updated: {formatDate(settings.updatedAt)}
              {settings.updatedBy && ` by ${settings.updatedBy}`}
            </p>
          )}
        </>
      ) : (
        <div className="bg-white rounded-lg border shadow-sm px-6 py-12 text-center text-gray-500">
          No token limits settings available
        </div>
      )}
    </div>
  );
}

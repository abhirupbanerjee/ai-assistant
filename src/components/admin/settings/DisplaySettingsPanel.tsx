'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, BookOpen, GitCommit } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface DisplaySettings {
  sourcesEnabled: boolean;
  citationTrajectoryEnabled: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export default function DisplaySettingsPanel() {
  const [settings, setSettings] = useState<DisplaySettings | null>(null);
  const [editedSettings, setEditedSettings] = useState<Omit<DisplaySettings, 'updatedAt' | 'updatedBy'> | null>(null);
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

      const displayData = data.display || {
        sourcesEnabled: true,
        citationTrajectoryEnabled: true,
      };

      setSettings(displayData);
      setEditedSettings({
        sourcesEnabled: displayData.sourcesEnabled,
        citationTrajectoryEnabled: displayData.citationTrajectoryEnabled,
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
        body: JSON.stringify({ type: 'display', settings: editedSettings }),
      });

      if (!res.ok) throw new Error('Failed to save settings');

      await fetchSettings();
      setIsModified(false);
      setSuccess('Display settings saved successfully');
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
        sourcesEnabled: settings.sourcesEnabled,
        citationTrajectoryEnabled: settings.citationTrajectoryEnabled,
      });
      setIsModified(false);
    }
  };

  const updateSetting = <K extends keyof Omit<DisplaySettings, 'updatedAt' | 'updatedBy'>>(
    key: K,
    value: Omit<DisplaySettings, 'updatedAt' | 'updatedBy'>[K]
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
            <h2 className="font-semibold text-gray-900">Display Settings</h2>
            <p className="text-sm text-gray-500">
              Control the visibility of RAG sources and citation trajectories across the application
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
          {/* Sources Display Toggle */}
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <BookOpen size={20} className="text-blue-600" />
              </div>
              <div>
                <label className="font-medium text-gray-900">Show RAG Sources</label>
                <p className="text-sm text-gray-500">
                  Display retrieved source documents in chat, workspace, and agent-bot responses.
                  When disabled, sources are hidden everywhere.
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={editedSettings.sourcesEnabled}
              onChange={(e) => updateSetting('sourcesEnabled', e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-1"
            />
          </div>

          {/* Citation Trajectory Toggle */}
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-purple-50 rounded-lg">
                <GitCommit size={20} className="text-purple-600" />
              </div>
              <div>
                <label className="font-medium text-gray-900">Show Citation Trajectory</label>
                <p className="text-sm text-gray-500">
                  Display citation trajectory cards in chat showing how sources were ranked and retrieved.
                  This only affects the main chat interface.
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={editedSettings.citationTrajectoryEnabled}
              onChange={(e) => updateSetting('citationTrajectoryEnabled', e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-1"
            />
          </div>

          {/* Metadata */}
          {settings?.updatedAt && (
            <div className="pt-4 border-t text-xs text-gray-400">
              Last updated {formatDate(settings.updatedAt)}
              {settings.updatedBy && ` by ${settings.updatedBy}`}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface SuperuserSettingsState {
  maxCategoriesPerSuperuser: number;
  updatedAt?: string;
  updatedBy?: string;
}

export default function SuperuserSettingsTab() {
  const [settings, setSettings] = useState<SuperuserSettingsState | null>(null);
  const [editedSettings, setEditedSettings] = useState<Omit<SuperuserSettingsState, 'updatedAt' | 'updatedBy'> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isModified = editedSettings?.maxCategoriesPerSuperuser !== settings?.maxCategoriesPerSuperuser;

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/admin/settings');
      if (!res.ok) throw new Error('Failed to fetch settings');
      const data = await res.json();

      const superuserData = data.superuser || {
        maxCategoriesPerSuperuser: 5,
      };

      setSettings(superuserData);
      setEditedSettings({
        maxCategoriesPerSuperuser: superuserData.maxCategoriesPerSuperuser,
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
      const res = await fetch('/api/admin/settings/superuser', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedSettings),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save settings');
      }

      const data = await res.json();
      setSettings(data.settings);
      setSuccess('Superuser settings saved successfully');
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
        maxCategoriesPerSuperuser: settings.maxCategoriesPerSuperuser,
      });
    }
  };

  return (
    <div className="bg-white rounded-lg border shadow-sm">
      <div className="px-6 py-4 border-b">
        <h3 className="font-semibold text-gray-900">Superuser Settings</h3>
        <p className="text-sm text-gray-500">Configure limits and permissions for superusers</p>
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
      ) : (
        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Categories per Superuser
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={editedSettings?.maxCategoriesPerSuperuser ?? 5}
              onChange={(e) => setEditedSettings({
                ...editedSettings,
                maxCategoriesPerSuperuser: parseInt(e.target.value, 10) || 5,
              })}
              className="w-full max-w-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-sm text-gray-500 mt-1">
              Maximum number of categories each superuser can create (1-100)
            </p>
          </div>

          {settings?.updatedAt && (
            <p className="text-sm text-gray-500">
              Last updated: {new Date(settings.updatedAt).toLocaleString()}
              {settings.updatedBy && ` by ${settings.updatedBy}`}
            </p>
          )}

          <div className="flex gap-3 pt-4 border-t">
            <Button
              onClick={handleSave}
              loading={isSaving}
              disabled={!isModified}
            >
              <Save size={16} className="mr-2" />
              Save Changes
            </Button>
            <Button
              variant="secondary"
              onClick={handleReset}
              disabled={!isModified}
            >
              Reset
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

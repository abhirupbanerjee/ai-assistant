'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Key, AlertTriangle } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface CredentialsAuthSettingsState {
  enabled: boolean;
  minPasswordLength: number;
}

export default function CredentialsAuthSettingsTab() {
  const [settings, setSettings] = useState<CredentialsAuthSettingsState | null>(null);
  const [editedSettings, setEditedSettings] = useState<CredentialsAuthSettingsState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isModified =
    editedSettings?.enabled !== settings?.enabled ||
    editedSettings?.minPasswordLength !== settings?.minPasswordLength;

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/admin/settings/credentials-auth');
      if (!res.ok) throw new Error('Failed to fetch settings');
      const data = await res.json();

      setSettings(data);
      setEditedSettings({ ...data });
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
      const res = await fetch('/api/admin/settings/credentials-auth', {
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
      setEditedSettings({ ...data.settings });
      setSuccess(data.message || 'Settings saved successfully');
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (settings) {
      setEditedSettings({ ...settings });
    }
  };

  return (
    <div className="bg-white rounded-lg border shadow-sm">
      <div className="px-6 py-4 border-b">
        <div className="flex items-center gap-2">
          <Key size={20} className="text-gray-600" />
          <h3 className="font-semibold text-gray-900">Credentials Authentication</h3>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Configure email/password login for development and offline scenarios
        </p>
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            ×
          </button>
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
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Enable Credentials Login
              </label>
              <p className="text-sm text-gray-500">
                Allow users to sign in with email and password
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setEditedSettings((prev) => (prev ? { ...prev, enabled: !prev.enabled } : null))
              }
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                editedSettings?.enabled ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  editedSettings?.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Warning when disabling */}
          {settings?.enabled && !editedSettings?.enabled && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
              <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">
                  Disabling Credentials Login
                </p>
                <p className="text-sm text-amber-700 mt-1">
                  Users will only be able to sign in via OAuth (Microsoft/Google).
                  Make sure OAuth is properly configured before disabling.
                  Server restart required for changes to take effect.
                </p>
              </div>
            </div>
          )}

          {/* Password Policy */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Minimum Password Length
            </label>
            <input
              type="number"
              min={4}
              max={128}
              value={editedSettings?.minPasswordLength ?? 8}
              onChange={(e) =>
                setEditedSettings((prev) =>
                  prev ? { ...prev, minPasswordLength: parseInt(e.target.value, 10) || 8 } : null
                )
              }
              className="w-full max-w-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-sm text-gray-500 mt-1">
              Minimum number of characters required for passwords (4-128)
            </p>
          </div>

          {/* Info about managing user credentials */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> To set passwords for individual users, go to{' '}
              <span className="font-medium">Users</span> section and use the credentials management
              option for each user.
            </p>
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <Button onClick={handleSave} loading={isSaving} disabled={!isModified}>
              <Save size={16} className="mr-2" />
              Save Changes
            </Button>
            <Button variant="secondary" onClick={handleReset} disabled={!isModified}>
              Reset
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

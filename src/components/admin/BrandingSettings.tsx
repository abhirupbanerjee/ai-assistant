'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Globe, Landmark, DollarSign, Activity, Layers, Server, ScrollText, Settings, BarChart3, FileText, Database } from 'lucide-react';
import AiIcon from '@/components/ui/icons/AiIcon';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface StarterPrompt {
  label: string;
  prompt: string;
}

interface BrandingSettings {
  botName: string;
  botIcon: string;
  subtitle?: string;
  welcomeTitle?: string;
  welcomeMessage?: string;
  accentColor?: string;
  starterPrompts?: StarterPrompt[];
  updatedAt?: string;
  updatedBy?: string;
}

// Available icon options for branding with their Lucide components
const BRANDING_ICONS = [
  { key: 'government', label: 'Government', Icon: Landmark },
  { key: 'operations', label: 'Operations', Icon: Settings },
  { key: 'finance', label: 'Finance', Icon: DollarSign },
  { key: 'kpi', label: 'KPI', Icon: BarChart3 },
  { key: 'logs', label: 'Logs', Icon: FileText },
  { key: 'data', label: 'Data', Icon: Database },
  { key: 'monitoring', label: 'Monitoring', Icon: Activity },
  { key: 'architecture', label: 'Architecture', Icon: Layers },
  { key: 'internet', label: 'Internet', Icon: Globe },
  { key: 'systems', label: 'Systems', Icon: Server },
  { key: 'policy', label: 'Policy', Icon: ScrollText },
  { key: 'ai-icon', label: 'AI Bot', Icon: AiIcon },
] as const;

export default function BrandingSettingsTab() {
  const [settings, setSettings] = useState<BrandingSettings | null>(null);
  const [editedSettings, setEditedSettings] = useState<Omit<BrandingSettings, 'updatedAt' | 'updatedBy'> | null>(null);
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

      const brandingData = data.branding || {
        botName: 'Policy Bot',
        botIcon: 'policy',
        subtitle: '',
        welcomeTitle: '',
        welcomeMessage: '',
        accentColor: '#3B82F6',
        starterPrompts: [],
      };

      setSettings(brandingData);
      setEditedSettings({
        botName: brandingData.botName,
        botIcon: brandingData.botIcon,
        subtitle: brandingData.subtitle,
        welcomeTitle: brandingData.welcomeTitle,
        welcomeMessage: brandingData.welcomeMessage,
        accentColor: brandingData.accentColor,
        starterPrompts: brandingData.starterPrompts || [],
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
        body: JSON.stringify({ type: 'branding', settings: editedSettings }),
      });

      if (!res.ok) throw new Error('Failed to save branding settings');

      const data = await res.json();
      setSettings(data.branding);
      setIsModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save branding settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (settings) {
      setEditedSettings({
        botName: settings.botName,
        botIcon: settings.botIcon,
        subtitle: settings.subtitle,
        welcomeTitle: settings.welcomeTitle,
        welcomeMessage: settings.welcomeMessage,
        accentColor: settings.accentColor,
      });
      setIsModified(false);
    }
  };

  const updateSetting = <K extends keyof Omit<BrandingSettings, 'updatedAt' | 'updatedBy'>>(
    key: K,
    value: Omit<BrandingSettings, 'updatedAt' | 'updatedBy'>[K]
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
            <h2 className="font-semibold text-gray-900">Branding</h2>
            <p className="text-sm text-gray-500">Customize the appearance and branding of your application</p>
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
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">&times;</button>
        </div>
      )}

      {isLoading ? (
        <div className="px-6 py-12 flex justify-center">
          <Spinner size="lg" />
        </div>
      ) : editedSettings ? (
        <div className="p-6 space-y-6">
          {/* Bot Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Bot Name</label>
            <input
              type="text"
              value={editedSettings.botName}
              onChange={(e) => updateSetting('botName', e.target.value)}
              placeholder="Policy Bot"
              className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Bot Icon */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Bot Icon</label>
            <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-11 gap-3">
              {BRANDING_ICONS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => updateSetting('botIcon', key)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                    editedSettings.botIcon === key
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <Icon size={24} className={editedSettings.botIcon === key ? 'text-blue-600' : 'text-gray-600'} />
                  <span className={`text-xs ${editedSettings.botIcon === key ? 'text-blue-600 font-medium' : 'text-gray-500'}`}>
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Subtitle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Subtitle</label>
            <input
              type="text"
              value={editedSettings.subtitle || ''}
              onChange={(e) => updateSetting('subtitle', e.target.value)}
              placeholder="Your AI-powered assistant"
              className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Welcome Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Welcome Title</label>
            <input
              type="text"
              value={editedSettings.welcomeTitle || ''}
              onChange={(e) => updateSetting('welcomeTitle', e.target.value)}
              placeholder="Welcome to Policy Bot"
              className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Welcome Message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Welcome Message</label>
            <textarea
              value={editedSettings.welcomeMessage || ''}
              onChange={(e) => updateSetting('welcomeMessage', e.target.value)}
              placeholder="How can I help you today?"
              rows={3}
              className="w-full max-w-lg px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Accent Color */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Accent Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={editedSettings.accentColor || '#3B82F6'}
                onChange={(e) => updateSetting('accentColor', e.target.value)}
                className="w-12 h-10 rounded border border-gray-300 cursor-pointer"
              />
              <input
                type="text"
                value={editedSettings.accentColor || '#3B82F6'}
                onChange={(e) => updateSetting('accentColor', e.target.value)}
                placeholder="#3B82F6"
                className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              />
            </div>
          </div>

          {/* Default Starter Prompts */}
          <div className="border-t pt-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Default Starter Prompts</label>
            <p className="text-sm text-gray-500 mb-3">
              These prompts appear on the welcome screen when no category is selected. Maximum 6 prompts.
            </p>
            <div className="space-y-3">
              {(editedSettings.starterPrompts || []).map((prompt, index) => (
                <div key={index} className="flex gap-3 items-start p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      value={prompt.label}
                      onChange={(e) => {
                        const newPrompts = [...(editedSettings.starterPrompts || [])];
                        newPrompts[index] = { ...prompt, label: e.target.value };
                        updateSetting('starterPrompts', newPrompts);
                      }}
                      placeholder="Button label (e.g., Generate Report)"
                      maxLength={50}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                    <textarea
                      value={prompt.prompt}
                      onChange={(e) => {
                        const newPrompts = [...(editedSettings.starterPrompts || [])];
                        newPrompts[index] = { ...prompt, prompt: e.target.value };
                        updateSetting('starterPrompts', newPrompts);
                      }}
                      placeholder="Full prompt text..."
                      maxLength={500}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                    />
                  </div>
                  <button
                    onClick={() => {
                      const newPrompts = [...(editedSettings.starterPrompts || [])];
                      newPrompts.splice(index, 1);
                      updateSetting('starterPrompts', newPrompts);
                    }}
                    className="mt-1 p-1 text-red-500 hover:text-red-700"
                    title="Remove prompt"
                  >
                    <span className="sr-only">Remove</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              ))}
              {(editedSettings.starterPrompts || []).length < 6 && (
                <button
                  onClick={() => {
                    const newPrompts = [...(editedSettings.starterPrompts || []), { label: '', prompt: '' }];
                    updateSetting('starterPrompts', newPrompts);
                  }}
                  className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-gray-400 hover:text-gray-600 text-sm font-medium"
                >
                  + Add Prompt
                </button>
              )}
            </div>
          </div>

          {/* Last Updated */}
          {settings?.updatedAt && (
            <p className="text-xs text-gray-400 pt-4 border-t">
              Last updated: {formatDate(settings.updatedAt)}
              {settings.updatedBy && ` by ${settings.updatedBy}`}
            </p>
          )}
        </div>
      ) : (
        <div className="px-6 py-12 text-center text-gray-500">
          No branding settings available
        </div>
      )}
    </div>
  );
}

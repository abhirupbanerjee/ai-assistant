'use client';

import { useState } from 'react';
import { Check, X, Eye, EyeOff, Loader2, Edit2, Save } from 'lucide-react';
import Button from '@/components/ui/Button';

interface LLMProvider {
  id: string;
  name: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  apiBase: string | null;
  enabled: boolean;
}

interface ProviderCardProps {
  provider: LLMProvider;
  onUpdate: (updates: { apiKey?: string; apiBase?: string; enabled?: boolean }) => Promise<void>;
  onTest: () => Promise<{ success: boolean; message: string }>;
}

export default function ProviderCard({ provider, onUpdate, onTest }: ProviderCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedApiKey, setEditedApiKey] = useState('');
  const [editedApiBase, setEditedApiBase] = useState(provider.apiBase || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const isOllama = provider.id === 'ollama';
  const isConfigured = provider.apiKeyConfigured || (isOllama && provider.apiBase);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updates: { apiKey?: string; apiBase?: string } = {};

      if (isOllama) {
        updates.apiBase = editedApiBase;
      } else if (editedApiKey) {
        updates.apiKey = editedApiKey;
      }

      await onUpdate(updates);
      setIsEditing(false);
      setEditedApiKey('');
      setTestResult(null);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await onTest();
      setTestResult(result);
    } finally {
      setIsTesting(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedApiKey('');
    setEditedApiBase(provider.apiBase || '');
    setTestResult(null);
  };

  const handleToggleEnabled = async () => {
    await onUpdate({ enabled: !provider.enabled });
  };

  return (
    <div className={`border rounded-lg p-4 ${!provider.enabled ? 'bg-gray-50 opacity-75' : 'bg-white'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <div className={`w-2 h-2 rounded-full ${isConfigured && provider.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />

          {/* Provider info */}
          <div>
            <h4 className="font-medium text-gray-900">{provider.name}</h4>
            <p className="text-xs text-gray-500">{provider.id}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {isConfigured && !isEditing && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleTest}
                disabled={isTesting || !provider.enabled}
                loading={isTesting}
              >
                Test
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Configuration display/edit */}
      {isEditing ? (
        <div className="mt-4 space-y-3">
          {isOllama ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Base URL
              </label>
              <input
                type="text"
                value={editedApiBase}
                onChange={(e) => setEditedApiBase(e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter the Ollama server URL (default: http://localhost:11434)
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={editedApiKey}
                  onChange={(e) => setEditedApiKey(e.target.value)}
                  placeholder={provider.apiKeyConfigured ? '••••••••••••' : 'Enter API key'}
                  className="w-full px-3 py-2 pr-10 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {provider.apiKeyConfigured && (
                <p className="text-xs text-gray-500 mt-1">
                  Leave blank to keep existing key. Current: {provider.apiKey}
                </p>
              )}
            </div>
          )}

          {/* Save/Cancel buttons */}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSave} loading={isSaving}>
              <Save size={14} className="mr-1" />
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={handleCancel} disabled={isSaving}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between">
          <div className="text-sm">
            {isOllama ? (
              provider.apiBase ? (
                <span className="text-gray-600">{provider.apiBase}</span>
              ) : (
                <span className="text-gray-400">Not configured</span>
              )
            ) : (
              provider.apiKeyConfigured ? (
                <span className="text-gray-600">{provider.apiKey}</span>
              ) : (
                <span className="text-gray-400">Not configured</span>
              )
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditing(true)}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <Edit2 size={14} />
              {isConfigured ? 'Edit' : isOllama ? 'Configure' : 'Add Key'}
            </button>

            {isConfigured && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={provider.enabled}
                  onChange={handleToggleEnabled}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-600">Enabled</span>
              </label>
            )}
          </div>
        </div>
      )}

      {/* Test result */}
      {testResult && (
        <div className={`mt-3 p-2 rounded text-sm flex items-center gap-2 ${
          testResult.success
            ? 'bg-green-50 text-green-700'
            : 'bg-red-50 text-red-700'
        }`}>
          {testResult.success ? (
            <Check size={14} className="flex-shrink-0" />
          ) : (
            <X size={14} className="flex-shrink-0" />
          )}
          <span>{testResult.message}</span>
        </div>
      )}
    </div>
  );
}

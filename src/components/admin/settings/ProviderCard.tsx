'use client';

import { useState } from 'react';
import { Check, X, KeyRound } from 'lucide-react';
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
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const isOllama = provider.id === 'ollama';
  const isConfigured = provider.apiKeyConfigured || (isOllama && provider.apiBase);

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
          {isConfigured && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleTest}
              disabled={isTesting || !provider.enabled}
              loading={isTesting}
            >
              Test
            </Button>
          )}
        </div>
      </div>

      {/* Read-only key status */}
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

      {/* Info tip — manage keys in API Keys page */}
      <div className="mt-2 p-2 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-2">
        <KeyRound size={14} className="text-blue-600 flex-shrink-0" />
        <p className="text-xs text-blue-800">
          API keys are managed in{' '}
          <a href="/admin?tab=settings&section=api-keys" className="text-blue-600 font-medium hover:underline">
            Settings &rarr; API Keys
          </a>
        </p>
      </div>

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

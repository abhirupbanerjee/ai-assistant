'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, ChevronUp, ChevronDown } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

type OcrProvider = 'mistral' | 'azure-di' | 'pdf-parse';

interface OcrProviderConfig {
  provider: OcrProvider;
  enabled: boolean;
}

interface OcrSettings {
  providers: OcrProviderConfig[];
  updatedAt?: string;
  updatedBy?: string;
  providerAvailability?: Record<string, boolean>;
}

const PROVIDER_INFO: Record<string, { label: string; description: string; formats: string; envVars: string }> = {
  'mistral': {
    label: 'Mistral OCR',
    description: 'AI-powered OCR for PDFs and images',
    formats: 'PDF, PNG, JPG, WEBP, GIF',
    envVars: 'MISTRAL_API_KEY',
  },
  'azure-di': {
    label: 'Azure Document Intelligence',
    description: 'Enterprise OCR for all document formats',
    formats: 'PDF, DOCX, XLSX, PPTX, PNG, JPG, WEBP, GIF',
    envVars: 'AZURE_DI_ENDPOINT, AZURE_DI_KEY',
  },
  'pdf-parse': {
    label: 'PDF Parse',
    description: 'Free local PDF text extraction (no API key required)',
    formats: 'PDF only',
    envVars: 'None',
  },
};

export default function DocumentProcessingTab() {
  const [settings, setSettings] = useState<OcrSettings | null>(null);
  const [editedProviders, setEditedProviders] = useState<OcrProviderConfig[] | null>(null);
  const [isModified, setIsModified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString();
  };

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/admin/settings');
      if (!res.ok) throw new Error('Failed to fetch settings');
      const data = await res.json();

      const ocrData = data.ocr || {
        providers: [
          { provider: 'mistral', enabled: true },
          { provider: 'azure-di', enabled: true },
          { provider: 'pdf-parse', enabled: true },
        ],
      };

      setSettings(ocrData);
      setEditedProviders(ocrData.providers.map((p: OcrProviderConfig) => ({ ...p })));
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
    if (!editedProviders || !isModified) return;

    try {
      setIsSaving(true);
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'ocr', settings: { providers: editedProviders } }),
      });

      if (!res.ok) throw new Error('Failed to save settings');

      setSettings(prev => prev ? { ...prev, providers: editedProviders } : null);
      setIsModified(false);
      setSuccess('Document processing settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (settings) {
      setEditedProviders(settings.providers.map(p => ({ ...p })));
      setIsModified(false);
    }
  };

  const handleMoveProvider = (index: number, direction: 'up' | 'down') => {
    if (!editedProviders) return;
    const newProviders = [...editedProviders];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newProviders.length) return;
    [newProviders[index], newProviders[swapIndex]] = [newProviders[swapIndex], newProviders[index]];
    setEditedProviders(newProviders);
    setIsModified(true);
  };

  const handleToggleProvider = (index: number) => {
    if (!editedProviders) return;
    const newProviders = [...editedProviders];
    newProviders[index] = { ...newProviders[index], enabled: !newProviders[index].enabled };
    setEditedProviders(newProviders);
    setIsModified(true);
  };

  return (
    <div className="bg-white rounded-lg border shadow-sm">
      <div className="px-6 py-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Document Processing</h2>
            <p className="text-sm text-gray-500">Configure OCR providers and their priority order for document text extraction</p>
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
        <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
      ) : editedProviders ? (
        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600 mb-4">
            Drag providers to set priority order. The first enabled provider will be tried first, falling back to subsequent providers on failure.
          </p>

          {editedProviders.map((providerConfig, index) => {
            const providerInfo = PROVIDER_INFO[providerConfig.provider];
            const isAvailable = settings?.providerAvailability?.[providerConfig.provider] ?? false;
            const priorityLabel = index === 0 ? 'Primary' : index === 1 ? 'Secondary' : 'Fallback';

            return (
              <div
                key={providerConfig.provider}
                className={`border rounded-lg p-4 ${
                  providerConfig.enabled ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    {/* Priority reorder buttons */}
                    <div className="flex flex-col gap-0.5 pt-0.5">
                      <button
                        onClick={() => handleMoveProvider(index, 'up')}
                        disabled={index === 0}
                        className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move up"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        onClick={() => handleMoveProvider(index, 'down')}
                        disabled={index === editedProviders.length - 1}
                        className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move down"
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-900">{providerInfo.label}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          index === 0 ? 'bg-blue-100 text-blue-700' :
                          index === 1 ? 'bg-gray-100 text-gray-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {priorityLabel}
                        </span>
                        {isAvailable ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                            Configured
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
                            Not Configured
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">{providerInfo.description}</p>
                      <div className="flex gap-4 mt-2 text-xs text-gray-500">
                        <span><strong>Formats:</strong> {providerInfo.formats}</span>
                        <span><strong>Env:</strong> {providerInfo.envVars}</span>
                      </div>
                    </div>
                  </div>

                  {/* Enable/Disable toggle */}
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-sm text-gray-600">{providerConfig.enabled ? 'Enabled' : 'Disabled'}</span>
                    <input
                      type="checkbox"
                      checked={providerConfig.enabled}
                      onChange={() => handleToggleProvider(index)}
                      className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Info note */}
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800">
              <strong>Note:</strong> Providers require their environment variables to be configured to function.
              Even if enabled here, a provider will be skipped at runtime if its environment variables are not set.
              Plain text files (.txt, .md) are always handled directly without OCR.
            </p>
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

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, ChevronUp, ChevronDown, KeyRound } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

type OcrProvider = 'mistral' | 'azure-di' | 'pdf-parse';

interface OcrProviderConfig {
  provider: OcrProvider;
  enabled: boolean;
}

interface OcrSettings {
  providers: OcrProviderConfig[];
  // Credential status flags
  hasMistralApiKey?: boolean;
  hasAzureDiCredentials?: boolean;
  mistralFromLlmProvider?: boolean;
  azureDiEndpoint?: string;
  updatedAt?: string;
  updatedBy?: string;
  providerAvailability?: Record<string, boolean>;
}

const PROVIDER_INFO: Record<string, { label: string; description: string; formats: string; envVars: string }> = {
  'mistral': {
    label: 'Mistral OCR',
    description: 'AI-powered vision OCR for PDFs and images (API-based)',
    formats: 'PDF, PNG, JPG, WEBP, GIF',
    envVars: 'MISTRAL_API_KEY',
  },
  'azure-di': {
    label: 'Azure Document Intelligence',
    description: 'Enterprise document processing for all formats (API-based)',
    formats: 'PDF, DOCX, XLSX, PPTX, PNG, JPG, WEBP, GIF',
    envVars: 'AZURE_DI_ENDPOINT, AZURE_DI_KEY',
  },
  'pdf-parse': {
    label: 'PDF Parse',
    description: 'Local PDF text extraction (no API key required)',
    formats: 'PDF only',
    envVars: 'None',
  },
};

export default function DocumentProcessingTab({ readOnly = false }: { readOnly?: boolean }) {
  const [settings, setSettings] = useState<OcrSettings | null>(null);
  const [editedProviders, setEditedProviders] = useState<OcrProviderConfig[] | null>(null);
  // Credential inputs
  // OCR API keys are now managed in Settings → API Keys
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

      // Include credentials if they were entered
      const settingsToSave: {
        providers: OcrProviderConfig[];
        mistralApiKey?: string;
        azureDiEndpoint?: string;
        azureDiKey?: string;
      } = {
        providers: editedProviders,
      };

      // OCR API keys are managed in Settings → API Keys

      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'ocr', settings: settingsToSave }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || 'Failed to save settings');
      }

      const data = await res.json();
      const savedSettings = data.settings;
      setSettings(savedSettings);
      setEditedProviders((savedSettings.providers as OcrProviderConfig[]).map((p: OcrProviderConfig) => ({ ...p })));

      setIsModified(false);
      setSuccess('Document processing settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);

      // Refresh availability status (editedProviders already set from save response above)
      fetchSettings();
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
    <div className={`bg-white rounded-lg border shadow-sm ${readOnly ? '[&_input]:pointer-events-none [&_select]:pointer-events-none [&_textarea]:pointer-events-none [&_input]:opacity-75 [&_select]:opacity-75' : ''}`}>
      <div className="px-6 py-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Document Processing</h2>
            <p className="text-sm text-gray-500">
              {readOnly ? 'Current document processing configuration (view only).' : 'Configure document processing providers and their priority order for text extraction'}
            </p>
          </div>
          {!readOnly && (
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
          )}
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
                      </div>

                      {/* Mistral API Key Status */}
                      {providerConfig.provider === 'mistral' && (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <p className="text-sm text-gray-600 mb-2">
                            {settings?.hasMistralApiKey ? (
                              <span className="text-green-600 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                                API key configured
                              </span>
                            ) : settings?.mistralFromLlmProvider ? (
                              <span className="text-purple-600 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 inline-block" />
                                Using LLM provider key
                              </span>
                            ) : (
                              <span className="text-gray-400 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
                                Not configured
                              </span>
                            )}
                          </p>
                          <div className="p-2.5 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-2">
                            <KeyRound size={14} className="text-blue-600 flex-shrink-0" />
                            <p className="text-xs text-blue-800">
                              API keys are managed in{' '}
                              <a href="/admin?tab=settings&section=api-keys" className="text-blue-600 font-medium hover:underline">
                                Settings &rarr; API Keys
                              </a>
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Azure DI Credentials Status */}
                      {providerConfig.provider === 'azure-di' && (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <p className="text-sm text-gray-600 mb-2">
                            {settings?.hasAzureDiCredentials ? (
                              <span className="text-green-600 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                                Credentials configured
                              </span>
                            ) : (
                              <span className="text-gray-400 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
                                Not configured
                              </span>
                            )}
                          </p>
                          <div className="p-2.5 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-2">
                            <KeyRound size={14} className="text-blue-600 flex-shrink-0" />
                            <p className="text-xs text-blue-800">
                              API keys are managed in{' '}
                              <a href="/admin?tab=settings&section=api-keys" className="text-blue-600 font-medium hover:underline">
                                Settings &rarr; API Keys
                              </a>
                            </p>
                          </div>
                        </div>
                      )}
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
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> API-based providers are tried in priority order. Configure API keys above or via environment variables.
              Mistral OCR will also use the key from LLM Settings &gt; Providers if available.
              Plain text files (.txt, .md, .json) are handled directly without any processing.
            </p>
          </div>

          {/* Local fallback parsers info */}
          <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <p className="text-sm font-medium text-gray-700 mb-1">Built-in Local Parsers (always active)</p>
            <p className="text-xs text-gray-600 mb-2">
              These run automatically before API-based providers. No configuration needed. If they fail, the document falls through to the providers above.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-gray-600">
              <div className="flex items-start gap-1.5">
                <span className="inline-block w-1.5 h-1.5 mt-1 rounded-full bg-green-400 flex-shrink-0" />
                <span><strong>mammoth</strong> — DOCX text extraction</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="inline-block w-1.5 h-1.5 mt-1 rounded-full bg-green-400 flex-shrink-0" />
                <span><strong>exceljs</strong> — XLSX spreadsheet extraction</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="inline-block w-1.5 h-1.5 mt-1 rounded-full bg-green-400 flex-shrink-0" />
                <span><strong>officeparser</strong> — PPTX slide extraction</span>
              </div>
            </div>
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

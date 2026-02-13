'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, RefreshCw, ChevronUp, ChevronDown, ImageIcon } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';

interface LLMSettings {
  model: string;
  temperature: number;
  maxTokens: number;
  promptOptimizationMaxTokens: number;
  updatedAt: string;
  updatedBy: string;
}

interface AvailableModel {
  id: string;
  name: string;
  description: string;
  provider: 'openai' | 'mistral' | 'gemini' | 'ollama';
  defaultMaxTokens: number;
}

interface ProviderStatus {
  provider: string;
  available: boolean;
  configured: boolean;
  error?: string;
}

interface ModelTokenLimitsState {
  limits: Record<string, number | 'default'>;
  updatedAt?: string;
  updatedBy?: string;
}

export default function LLMSettingsTab() {
  // LLM settings state
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [editedSettings, setEditedSettings] = useState<Omit<LLMSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [isModified, setIsModified] = useState(false);

  // Model and provider state
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [providerStatus, setProviderStatus] = useState<Record<string, ProviderStatus>>({});
  const [modelTokenLimits, setModelTokenLimits] = useState<ModelTokenLimitsState | null>(null);
  const [editedModelTokens, setEditedModelTokens] = useState<Record<string, number | 'default'>>({});

  // UI state
  const [llmSettingsExpanded, setLlmSettingsExpanded] = useState(true);
  const [tokenLimitsExpanded, setTokenLimitsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savingModelTokens, setSavingModelTokens] = useState(false);
  const [restoringDefaults, setRestoringDefaults] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString();
  };

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);

      // Fetch settings and providers in parallel
      const [settingsRes, providersRes] = await Promise.all([
        fetch('/api/admin/settings'),
        fetch('/api/admin/providers'),
      ]);

      if (!settingsRes.ok) throw new Error('Failed to fetch settings');
      const settingsData = await settingsRes.json();

      // Load LLM settings
      const llmData = settingsData.llm || {
        model: 'gpt-4.1-mini',
        temperature: 0.7,
        maxTokens: 2000,
        promptOptimizationMaxTokens: 200,
      };
      setSettings(llmData);
      setEditedSettings({
        model: llmData.model,
        temperature: llmData.temperature,
        maxTokens: llmData.maxTokens,
        promptOptimizationMaxTokens: llmData.promptOptimizationMaxTokens,
      });

      // Load available models
      setAvailableModels((settingsData.availableModels || []).filter(Boolean));

      // Load model token limits
      if (settingsData.modelTokenLimits) {
        setModelTokenLimits(settingsData.modelTokenLimits);
        setEditedModelTokens(settingsData.modelTokenLimits.limits || {});
      }

      // Load provider status
      if (providersRes.ok) {
        const providersData = await providersRes.json();
        setProviderStatus(providersData.providers || {});
      }

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

  const handleChange = <K extends keyof Omit<LLMSettings, 'updatedAt' | 'updatedBy'>>(
    key: K,
    value: Omit<LLMSettings, 'updatedAt' | 'updatedBy'>[K]
  ) => {
    if (!editedSettings) return;
    const updated = { ...editedSettings, [key]: value };
    setEditedSettings(updated);
    setIsModified(
      JSON.stringify(updated) !== JSON.stringify({
        model: settings?.model,
        temperature: settings?.temperature,
        maxTokens: settings?.maxTokens,
        promptOptimizationMaxTokens: settings?.promptOptimizationMaxTokens,
      })
    );
  };

  const handleSave = async () => {
    if (!editedSettings || !isModified) return;

    try {
      setIsSaving(true);
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'llm', settings: editedSettings }),
      });

      if (!res.ok) throw new Error('Failed to save settings');

      const result = await res.json();
      setSettings(result.settings);
      setIsModified(false);
      setSuccess('LLM settings saved successfully');
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
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        promptOptimizationMaxTokens: settings.promptOptimizationMaxTokens,
      });
      setIsModified(false);
    }
  };

  const handleModelTokenChange = (model: string, value: number | 'default') => {
    setEditedModelTokens(prev => ({ ...prev, [model]: value }));
  };

  const handleSaveModelToken = async (model: string) => {
    setSavingModelTokens(true);
    setError(null);

    try {
      const value = editedModelTokens[model];
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'model-tokens',
          settings: { model, maxTokens: value ?? 'default' }
        }),
      });

      if (!res.ok) throw new Error('Failed to save model token limit');

      const result = await res.json();
      setModelTokenLimits(result.modelTokenLimits);
      setEditedModelTokens(result.modelTokenLimits.limits || {});
      setSuccess('Model token limit saved');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save model token limit');
    } finally {
      setSavingModelTokens(false);
    }
  };

  const handleResetModelToken = (model: string) => {
    handleModelTokenChange(model, 'default');
  };

  const handleRestoreAllDefaults = async () => {
    setRestoringDefaults(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'restoreAllDefaults', settings: {} }),
      });

      if (!res.ok) throw new Error('Failed to restore defaults');

      await fetchSettings();
      setShowRestoreConfirm(false);
      setSuccess('All settings restored to defaults');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore defaults');
    } finally {
      setRestoringDefaults(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">×</button>
        </div>
      )}

      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {/* LLM Settings Card */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div
          className="px-6 py-4 border-b cursor-pointer hover:bg-gray-50 transition-colors"
          onClick={() => setLlmSettingsExpanded(!llmSettingsExpanded)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button className="p-1 hover:bg-gray-100 rounded">
                {llmSettingsExpanded ? <ChevronUp size={18} className="text-gray-500" /> : <ChevronDown size={18} className="text-gray-500" />}
              </button>
              <div>
                <h2 className="font-semibold text-gray-900">LLM Settings</h2>
                <p className="text-sm text-gray-500">Configure the language model parameters</p>
              </div>
            </div>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="secondary"
                onClick={() => setShowRestoreConfirm(true)}
                disabled={restoringDefaults}
                className="text-orange-600 border-orange-300 hover:bg-orange-50"
              >
                <RefreshCw size={16} className="mr-2" />
                Reset All
              </Button>
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
        {llmSettingsExpanded && (isLoading ? (
          <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
        ) : editedSettings && (
          <div className="p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Model</label>
              <select
                value={editedSettings.model}
                onChange={(e) => handleChange('model', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {availableModels.filter(Boolean).map((model) => {
                  const status = providerStatus[model.provider];
                  const available = status?.available ?? true;
                  return (
                    <option
                      key={model.id}
                      value={model.id}
                      disabled={!available}
                    >
                      {model.name} {!available ? '(unavailable)' : ''}
                    </option>
                  );
                })}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {availableModels.find(m => m.id === editedSettings.model)?.description}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Temperature: {editedSettings.temperature}
              </label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={editedSettings.temperature}
                onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0 (Deterministic)</span>
                <span>2 (Creative)</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Max Tokens</label>
              <input
                type="number"
                min="100"
                max="16000"
                value={editedSettings.maxTokens}
                onChange={(e) => handleChange('maxTokens', parseInt(e.target.value) || 2000)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">Maximum length of generated responses (100-16000)</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Prompt Optimization Max Tokens</label>
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium text-gray-900">{editedSettings.promptOptimizationMaxTokens.toLocaleString()}</span>
                <span className="text-xs text-gray-400">tokens</span>
              </div>
              <p className="mt-1 text-xs text-blue-500">Configure in Settings &rarr; Limits &rarr; Token Limits</p>
            </div>
            {settings && (
              <p className="text-xs text-gray-500 pt-4 border-t">
                Last updated: {formatDate(settings.updatedAt)} by {settings.updatedBy}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Multimodal/Vision Support Info Card */}
      <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
        <div className="flex items-start gap-3">
          <ImageIcon className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-medium text-blue-900">Image/Vision Support</h3>
            <p className="text-sm text-blue-700 mt-1">
              Users can upload images (PNG, JPG, WebP) in chat. Images are sent visually to the LLM for analysis.
            </p>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">✓ Vision</span>
                <span className="text-blue-800">GPT-4.1 family, Gemini 2.5/3, Mistral Large 3, Mistral Small 3.2</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">— No Vision</span>
                <span className="text-blue-800">Ollama models (text-only fallback via OCR)</span>
              </div>
            </div>
            <p className="text-xs text-blue-600 mt-3">
              Note: LiteLLM proxy handles format conversion between providers automatically.
              Models without vision support will receive OCR-extracted text instead.
            </p>
          </div>
        </div>
      </div>

      {/* Per-Model Token Limits Card */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div
          className="px-6 py-4 border-b cursor-pointer hover:bg-gray-50 transition-colors"
          onClick={() => setTokenLimitsExpanded(!tokenLimitsExpanded)}
        >
          <div className="flex items-center gap-3">
            <button className="p-1 hover:bg-gray-100 rounded">
              {tokenLimitsExpanded ? <ChevronUp size={18} className="text-gray-500" /> : <ChevronDown size={18} className="text-gray-500" />}
            </button>
            <div>
              <h2 className="font-semibold text-gray-900">Per-Model Token Limits</h2>
              <p className="text-sm text-gray-500">Override default max tokens for specific models</p>
            </div>
          </div>
        </div>
        {tokenLimitsExpanded && (isLoading ? (
          <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
        ) : (
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Model</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Default</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Custom Limit</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {availableModels.filter(Boolean).map((model) => {
                    const modelId = model.id;
                    const modelDefault = model.defaultMaxTokens;
                    const currentValue = editedModelTokens[modelId];
                    const isCustom = currentValue !== undefined && currentValue !== 'default';
                    const savedValue = modelTokenLimits?.limits?.[modelId];
                    const isTokenModified = currentValue !== (savedValue ?? 'default');

                    return (
                      <tr key={modelId} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {model.name}
                          <span className="text-xs text-gray-400 ml-2">({modelId})</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {modelDefault.toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="100"
                              max="16000"
                              value={isCustom ? currentValue : ''}
                              placeholder={modelDefault.toString()}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '') {
                                  handleModelTokenChange(modelId, 'default');
                                } else {
                                  handleModelTokenChange(modelId, parseInt(val) || modelDefault);
                                }
                              }}
                              className="w-24 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            {isCustom && (
                              <span className="text-xs text-blue-600 font-medium">Custom</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {isTokenModified && (
                              <Button
                                size="sm"
                                onClick={() => handleSaveModelToken(modelId)}
                                disabled={savingModelTokens}
                                loading={savingModelTokens}
                              >
                                <Save size={14} className="mr-1" />
                                Save
                              </Button>
                            )}
                            {isCustom && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleResetModelToken(modelId)}
                                disabled={savingModelTokens}
                              >
                                Reset
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {modelTokenLimits?.updatedAt && (
              <p className="text-xs text-gray-500 mt-4 pt-4 border-t">
                Last updated: {formatDate(modelTokenLimits.updatedAt)} by {modelTokenLimits.updatedBy}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Restore Defaults Confirmation Modal */}
      <Modal
        isOpen={showRestoreConfirm}
        onClose={() => setShowRestoreConfirm(false)}
        title="Restore All Defaults"
      >
        <div className="space-y-4">
          <p className="text-gray-700">
            Are you sure you want to restore all LLM settings to their default values? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowRestoreConfirm(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRestoreAllDefaults}
              loading={restoringDefaults}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Restore Defaults
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

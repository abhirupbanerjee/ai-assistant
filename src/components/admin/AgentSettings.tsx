'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Save } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface AgentModelConfig {
  provider: 'openai' | 'gemini' | 'mistral';
  model: string;
  temperature: number;
  max_tokens?: number;
}

interface AgentSettings {
  budgetMaxLlmCalls: number;
  budgetMaxTokens: number;
  budgetMaxWebSearches: number;
  confidenceThreshold: number;
  budgetMaxDurationMinutes: number;
  taskTimeoutMinutes: number;
  plannerModel: AgentModelConfig;
  executorModel: AgentModelConfig;
  checkerModel: AgentModelConfig;
  summarizerModel: AgentModelConfig;
  streamingKeepaliveInterval: number;
  streamingMaxDuration: number;
  streamingToolTimeout: number;
  updatedAt?: string;
  updatedBy?: string;
}

interface EnabledModel {
  id: string;
  providerId: string;
  displayName: string;
  toolCapable: boolean;
  visionCapable: boolean;
  enabled: boolean;
}

const MODEL_KEYS = ['plannerModel', 'executorModel', 'checkerModel', 'summarizerModel'] as const;

/** Map a provider ID from enabled_models to a valid agent provider value */
function mapProviderForAgent(providerId: string): 'openai' | 'gemini' | 'mistral' {
  switch (providerId) {
    case 'gemini':
    case 'google':
      return 'gemini';
    case 'mistral':
      return 'mistral';
    default:
      // All other providers (openai, anthropic, etc.) route through OpenAI client → LiteLLM proxy
      return 'openai';
  }
}

export default function AgentSettingsTab() {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [editedSettings, setEditedSettings] = useState<Omit<AgentSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [isModified, setIsModified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<EnabledModel[]>([]);

  // Group models by provider for optgroup rendering
  const modelsByProvider = useMemo(() => {
    const groups: Record<string, EnabledModel[]> = {};
    for (const model of availableModels) {
      if (!groups[model.providerId]) groups[model.providerId] = [];
      groups[model.providerId].push(model);
    }
    return groups;
  }, [availableModels]);

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const fetchAvailableModels = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/llm/models?active=true');
      if (res.ok) {
        const data = await res.json();
        setAvailableModels(data.models || []);
      }
    } catch {
      // Non-critical - models dropdown will be empty
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/admin/settings/agent');
      if (!res.ok) throw new Error('Failed to fetch agent settings');
      const data = await res.json();

      setSettings(data);
      setEditedSettings({
        budgetMaxLlmCalls: data.budgetMaxLlmCalls,
        budgetMaxTokens: data.budgetMaxTokens,
        budgetMaxWebSearches: data.budgetMaxWebSearches,
        confidenceThreshold: data.confidenceThreshold,
        budgetMaxDurationMinutes: data.budgetMaxDurationMinutes,
        taskTimeoutMinutes: data.taskTimeoutMinutes,
        plannerModel: data.plannerModel,
        executorModel: data.executorModel,
        checkerModel: data.checkerModel,
        summarizerModel: data.summarizerModel,
        streamingKeepaliveInterval: data.streamingKeepaliveInterval ?? 10,
        streamingMaxDuration: data.streamingMaxDuration ?? 300,
        streamingToolTimeout: data.streamingToolTimeout ?? 60,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent settings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchAvailableModels();
  }, [fetchSettings, fetchAvailableModels]);

  const handleSave = async () => {
    if (!editedSettings || !isModified) return;

    try {
      setIsSaving(true);
      const res = await fetch('/api/admin/settings/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedSettings),
      });

      if (!res.ok) throw new Error('Failed to save agent settings');

      const data = await res.json();
      setSettings(data.settings);
      setIsModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (settings) {
      setEditedSettings({
        budgetMaxLlmCalls: settings.budgetMaxLlmCalls,
        budgetMaxTokens: settings.budgetMaxTokens,
        budgetMaxWebSearches: settings.budgetMaxWebSearches,
        confidenceThreshold: settings.confidenceThreshold,
        budgetMaxDurationMinutes: settings.budgetMaxDurationMinutes,
        taskTimeoutMinutes: settings.taskTimeoutMinutes,
        plannerModel: settings.plannerModel,
        executorModel: settings.executorModel,
        checkerModel: settings.checkerModel,
        summarizerModel: settings.summarizerModel,
        streamingKeepaliveInterval: settings.streamingKeepaliveInterval ?? 10,
        streamingMaxDuration: settings.streamingMaxDuration ?? 300,
        streamingToolTimeout: settings.streamingToolTimeout ?? 60,
      });
      setIsModified(false);
    }
  };

  const updateSetting = <K extends keyof Omit<AgentSettings, 'updatedAt' | 'updatedBy'>>(
    key: K,
    value: Omit<AgentSettings, 'updatedAt' | 'updatedBy'>[K]
  ) => {
    if (editedSettings) {
      setEditedSettings({ ...editedSettings, [key]: value });
      setIsModified(true);
    }
  };

  const updateModelConfig = (
    modelKey: typeof MODEL_KEYS[number],
    field: keyof AgentModelConfig,
    value: string | number | undefined
  ) => {
    if (editedSettings) {
      setEditedSettings({
        ...editedSettings,
        [modelKey]: { ...editedSettings[modelKey], [field]: value }
      });
      setIsModified(true);
    }
  };

  /** Handle model selection from dropdown — also auto-sets the provider */
  const handleModelSelect = (modelKey: typeof MODEL_KEYS[number], modelId: string) => {
    if (!editedSettings) return;
    const selectedModel = availableModels.find(m => m.id === modelId);
    const provider = selectedModel ? mapProviderForAgent(selectedModel.providerId) : editedSettings[modelKey].provider;
    setEditedSettings({
      ...editedSettings,
      [modelKey]: { ...editedSettings[modelKey], model: modelId, provider }
    });
    setIsModified(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">Agent Configuration</h2>
              <p className="text-sm text-gray-500">Configure autonomous agent behavior and model assignments</p>
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
          {/* Budget & Limits */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <h3 className="font-medium text-gray-900">Budget & Limits</h3>
              <p className="text-sm text-gray-500">Set resource constraints for agent execution</p>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Max LLM Calls</label>
                <input
                  type="number"
                  value={editedSettings.budgetMaxLlmCalls}
                  onChange={(e) => updateSetting('budgetMaxLlmCalls', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Max Tokens</label>
                <input
                  type="number"
                  value={editedSettings.budgetMaxTokens}
                  onChange={(e) => updateSetting('budgetMaxTokens', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Max Web Searches</label>
                <input
                  type="number"
                  value={editedSettings.budgetMaxWebSearches}
                  onChange={(e) => updateSetting('budgetMaxWebSearches', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Max Duration (minutes)</label>
                <input
                  type="number"
                  value={editedSettings.budgetMaxDurationMinutes}
                  onChange={(e) => updateSetting('budgetMaxDurationMinutes', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Task Timeout (minutes)</label>
                <input
                  type="number"
                  value={editedSettings.taskTimeoutMinutes}
                  onChange={(e) => updateSetting('taskTimeoutMinutes', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Confidence Threshold</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={editedSettings.confidenceThreshold}
                  onChange={(e) => updateSetting('confidenceThreshold', parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Model Configurations */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <h3 className="font-medium text-gray-900">Model Configurations</h3>
              <p className="text-sm text-gray-500">Assign models to different agent roles</p>
            </div>
            <div className="p-6 space-y-6">
              {MODEL_KEYS.map((modelKey) => {
                const currentModel = editedSettings[modelKey];
                const isKnownModel = availableModels.some(m => m.id === currentModel.model);

                return (
                  <div key={modelKey} className="border-b pb-6 last:border-b-0 last:pb-0">
                    <h4 className="text-sm font-medium text-gray-900 mb-4 capitalize">
                      {modelKey.replace('Model', ' Model')}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="lg:col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Model</label>
                        <select
                          value={currentModel.model}
                          onChange={(e) => handleModelSelect(modelKey, e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        >
                          {/* Show current value if not in the available models list */}
                          {!isKnownModel && currentModel.model && (
                            <option value={currentModel.model}>
                              {currentModel.model} ({currentModel.provider})
                            </option>
                          )}
                          {Object.entries(modelsByProvider).map(([providerId, models]) => (
                            <optgroup key={providerId} label={providerId}>
                              {models.map((model) => (
                                <option key={model.id} value={model.id}>
                                  {model.displayName}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <span className="text-xs text-gray-400 mt-1 block">
                          Provider: {currentModel.provider}
                        </span>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Temperature</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="2"
                          value={currentModel.temperature}
                          onChange={(e) => updateModelConfig(modelKey, 'temperature', parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Max Tokens</label>
                        <input
                          type="number"
                          value={currentModel.max_tokens || ''}
                          onChange={(e) => updateModelConfig(modelKey, 'max_tokens', parseInt(e.target.value) || undefined)}
                          placeholder="4096"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Streaming Configuration */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <h3 className="font-medium text-gray-900">Streaming Configuration</h3>
              <p className="text-sm text-gray-500">Configure streaming behavior for real-time responses</p>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Keepalive Interval (s)</label>
                <input
                  type="number"
                  value={editedSettings.streamingKeepaliveInterval}
                  onChange={(e) => updateSetting('streamingKeepaliveInterval', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Max Duration (s)</label>
                <input
                  type="number"
                  value={editedSettings.streamingMaxDuration}
                  onChange={(e) => updateSetting('streamingMaxDuration', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Tool Timeout (s)</label>
                <input
                  type="number"
                  value={editedSettings.streamingToolTimeout}
                  onChange={(e) => updateSetting('streamingToolTimeout', parseInt(e.target.value) || 0)}
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
          No agent settings available
        </div>
      )}
    </div>
  );
}

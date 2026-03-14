'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Save, RefreshCw, ChevronUp, ChevronDown, Plus, Wrench, Eye, Star,
  MoreVertical, Trash2, EyeOff, Edit2, Check, FileText, Languages,
  Image, Mic, Database, Search, ExternalLink, AlertTriangle, CheckCircle,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import ProviderCard from './ProviderCard';
import ModelDiscoveryModal from './ModelDiscoveryModal';

// ============ Types ============

interface LLMProvider {
  id: string;
  name: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  apiBase: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface EnabledModel {
  id: string;
  providerId: string;
  displayName: string;
  toolCapable: boolean;
  visionCapable: boolean;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  isDefault: boolean;
  enabled: boolean;
  providerEnabled?: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface ChatDefaults {
  model: string;
  temperature: number;
  maxTokens: number;
  promptOptimizationMaxTokens: number;
  updatedAt: string;
  updatedBy: string;
}

interface EligibleModel {
  id: string;
  displayName: string;
  providerId: string;
}

interface UnhealthyModel {
  modelId: string;
  expiresAt: string;
}

interface LlmFallbackSettings {
  universalFallback: string | null;
  maxRetryAttempts: number;
  healthCacheDuration: 'hourly' | 'daily' | 'disabled';
}

interface FallbackData {
  settings: LlmFallbackSettings;
  eligibleFallbackModels: EligibleModel[];
  healthCache: {
    unhealthyModels: UnhealthyModel[];
    duration: 'hourly' | 'daily' | 'disabled';
  };
}

type SectionId = 'providers' | 'models' | 'chatDefaults' | 'fallback' | 'overview';

// ============ Component ============

export default function UnifiedLLMSettings() {
  // Section expand/collapse
  const [expandedSections, setExpandedSections] = useState<Set<SectionId>>(
    new Set(['providers', 'models'])
  );

  // Provider & model state
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [enabledModels, setEnabledModels] = useState<EnabledModel[]>([]);

  // Chat defaults state
  const [chatDefaults, setChatDefaults] = useState<ChatDefaults | null>(null);
  const [editedDefaults, setEditedDefaults] = useState<Pick<ChatDefaults, 'temperature' | 'maxTokens'> | null>(null);
  const [defaultsModified, setDefaultsModified] = useState(false);

  // Fallback state
  const [fallbackData, setFallbackData] = useState<FallbackData | null>(null);
  const [editedFallback, setEditedFallback] = useState<LlmFallbackSettings | null>(null);
  const [fallbackModified, setFallbackModified] = useState(false);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Saving states
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);
  const [isSavingFallback, setIsSavingFallback] = useState(false);
  const [restoringDefaults, setRestoringDefaults] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);

  // Model actions state
  const [showDiscoveryModal, setShowDiscoveryModal] = useState(false);
  const [selectedProviderForDiscovery, setSelectedProviderForDiscovery] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeModelMenu, setActiveModelMenu] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editedDisplayName, setEditedDisplayName] = useState('');
  const [editingMaxOutput, setEditingMaxOutput] = useState<string | null>(null);
  const [editedMaxOutput, setEditedMaxOutput] = useState<number>(0);

  // ============ Helpers ============

  const toggleSection = (id: SectionId) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return 'Never';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString();
  };

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const getProviderName = (providerId: string) => {
    const provider = providers.find(p => p.id === providerId);
    return provider?.name || providerId;
  };

  const configuredProviders = providers.filter(p => p.apiKeyConfigured || p.id === 'ollama');
  const defaultModel = enabledModels.find(m => m.isDefault);

  // ============ Data Loading ============

  const fetchProviders = useCallback(async () => {
    const res = await fetch('/api/admin/llm/providers');
    if (!res.ok) throw new Error('Failed to fetch providers');
    const data = await res.json();
    setProviders(data.providers || []);
  }, []);

  const fetchModels = useCallback(async () => {
    const res = await fetch('/api/admin/llm/models');
    if (!res.ok) throw new Error('Failed to fetch models');
    const data = await res.json();
    setEnabledModels(data.models || []);
  }, []);

  const fetchChatDefaults = useCallback(async () => {
    const defaults = { model: 'gpt-4.1-mini', temperature: 0.7, maxTokens: 2000, promptOptimizationMaxTokens: 200 };
    const res = await fetch('/api/admin/settings');
    if (!res.ok) {
      setChatDefaults(null);
      setEditedDefaults({ temperature: defaults.temperature, maxTokens: defaults.maxTokens });
      return;
    }
    const data = await res.json();
    const llm = data.llm || defaults;
    setChatDefaults(llm);
    setEditedDefaults({ temperature: llm.temperature, maxTokens: llm.maxTokens });
  }, []);

  const fetchFallback = useCallback(async () => {
    const res = await fetch('/api/admin/settings/llm-fallback');
    if (!res.ok) return; // non-critical
    const data: FallbackData = await res.json();
    setFallbackData(data);
    setEditedFallback({ ...data.settings });
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await Promise.all([fetchProviders(), fetchModels(), fetchChatDefaults(), fetchFallback()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }, [fetchProviders, fetchModels, fetchChatDefaults, fetchFallback]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ============ Provider Actions ============

  const handleProviderUpdate = async (providerId: string, updates: { apiKey?: string; apiBase?: string; enabled?: boolean }) => {
    try {
      const res = await fetch(`/api/admin/llm/providers/${providerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update provider');
      await fetchProviders();
      showSuccess('Provider updated successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update provider');
    }
  };

  const handleTestProvider = async (providerId: string): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await fetch(`/api/admin/llm/providers/${providerId}/test`, { method: 'POST' });
      const data = await res.json();
      return { success: data.success, message: data.message };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Connection test failed' };
    }
  };

  // ============ Model Actions ============

  const handleSetDefault = async (modelId: string) => {
    try {
      const res = await fetch(`/api/admin/llm/models/${modelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) throw new Error('Failed to set default model');
      await fetchModels();
      showSuccess('Default model updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set default model');
    }
    setActiveModelMenu(null);
  };

  const handleToggleModel = async (modelId: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/admin/llm/models/${modelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('Failed to update model');
      await fetchModels();
      showSuccess(enabled ? 'Model enabled' : 'Model disabled');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update model');
    }
    setActiveModelMenu(null);
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      const res = await fetch(`/api/admin/llm/models/${modelId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove model');
      await fetchModels();
      showSuccess('Model removed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove model');
    }
    setActiveModelMenu(null);
  };

  const handleEditDisplayName = async (modelId: string) => {
    if (!editedDisplayName.trim()) return;
    try {
      const res = await fetch(`/api/admin/llm/models/${modelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: editedDisplayName.trim() }),
      });
      if (!res.ok) throw new Error('Failed to update display name');
      await fetchModels();
      setEditingModel(null);
      setEditedDisplayName('');
      showSuccess('Display name updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update display name');
    }
  };

  const handleEditMaxOutput = async (modelId: string) => {
    if (editedMaxOutput < 100 || editedMaxOutput > 100000) {
      setError('Max output tokens must be between 100 and 100,000');
      return;
    }
    try {
      const res = await fetch(`/api/admin/llm/models/${modelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxOutputTokens: editedMaxOutput }),
      });
      if (!res.ok) throw new Error('Failed to update max output tokens');
      await fetchModels();
      setEditingMaxOutput(null);
      setEditedMaxOutput(0);
      showSuccess('Max output tokens updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update max output tokens');
    }
  };

  const handleModelsAdded = async () => {
    await fetchModels();
    setShowDiscoveryModal(false);
    setSelectedProviderForDiscovery(null);
    showSuccess('Models added successfully');
  };

  const handleRefreshCapabilities = async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/llm/models/refresh', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to refresh');
      await fetchModels();
      showSuccess(`Refreshed capabilities for ${data.updated} models`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh capabilities');
    } finally {
      setIsRefreshing(false);
    }
  };

  // ============ Chat Defaults Actions ============

  const handleDefaultsChange = <K extends 'temperature' | 'maxTokens'>(key: K, value: number) => {
    if (!editedDefaults) return;
    const updated = { ...editedDefaults, [key]: value };
    setEditedDefaults(updated);
    setDefaultsModified(
      updated.temperature !== chatDefaults?.temperature || updated.maxTokens !== chatDefaults?.maxTokens
    );
  };

  const handleSaveDefaults = async () => {
    if (!editedDefaults || !defaultsModified) return;
    try {
      setIsSavingDefaults(true);
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'llm', settings: editedDefaults }),
      });
      if (!res.ok) throw new Error('Failed to save settings');
      const result = await res.json();
      setChatDefaults(result.settings);
      setDefaultsModified(false);
      showSuccess('Chat defaults saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSavingDefaults(false);
    }
  };

  const handleResetDefaults = () => {
    if (chatDefaults) {
      setEditedDefaults({ temperature: chatDefaults.temperature, maxTokens: chatDefaults.maxTokens });
      setDefaultsModified(false);
    }
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
      await fetchChatDefaults();
      setDefaultsModified(false);
      setShowRestoreConfirm(false);
      showSuccess('All settings restored to defaults');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore defaults');
    } finally {
      setRestoringDefaults(false);
    }
  };

  // ============ Fallback Actions ============

  const updateFallbackSetting = <K extends keyof LlmFallbackSettings>(key: K, value: LlmFallbackSettings[K]) => {
    if (editedFallback) {
      setEditedFallback({ ...editedFallback, [key]: value });
      setFallbackModified(true);
    }
  };

  const handleSaveFallback = async () => {
    if (!editedFallback) return;
    try {
      setIsSavingFallback(true);
      const res = await fetch('/api/admin/settings/llm-fallback', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedFallback),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to save settings');
      }
      await fetchFallback();
      setFallbackModified(false);
      showSuccess('Fallback settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSavingFallback(false);
    }
  };

  const handleResetFallback = () => {
    if (fallbackData) {
      setEditedFallback({ ...fallbackData.settings });
      setFallbackModified(false);
    }
  };

  const handleClearHealthCache = async () => {
    try {
      setIsClearingCache(true);
      const res = await fetch('/api/admin/settings/llm-fallback', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear health cache');
      await fetchFallback();
      showSuccess('Health cache cleared - all models marked as healthy');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear health cache');
    } finally {
      setIsClearingCache(false);
    }
  };

  // ============ Section Header Component ============

  const SectionHeader = ({ id, title, subtitle, children }: {
    id: SectionId; title: string; subtitle: string; children?: React.ReactNode;
  }) => (
    <div
      className="px-6 py-4 border-b cursor-pointer hover:bg-gray-50 transition-colors"
      onClick={() => toggleSection(id)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button className="p-1 hover:bg-gray-100 rounded">
            {expandedSections.has(id)
              ? <ChevronUp size={18} className="text-gray-500" />
              : <ChevronDown size={18} className="text-gray-500" />}
          </button>
          <div>
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500">{subtitle}</p>
          </div>
        </div>
        {children && <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>{children}</div>}
      </div>
    </div>
  );

  // ============ Render ============

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Spinner size="lg" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900">LLM Settings</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage providers, models, and generation parameters.
        </p>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">×</button>
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <CheckCircle size={16} className="text-green-600" />
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {/* ============ Section 1: Providers ============ */}
      <div className="bg-white rounded-lg border shadow-sm">
        <SectionHeader id="providers" title="Providers" subtitle="Configure API keys for LLM providers" />
        {expandedSections.has('providers') && (
          <div className="p-6 space-y-4">
            {providers.map(provider => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                onUpdate={(updates) => handleProviderUpdate(provider.id, updates)}
                onTest={() => handleTestProvider(provider.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ============ Section 2: Enabled Models ============ */}
      <div className="bg-white rounded-lg border shadow-sm">
        <SectionHeader id="models" title="Enabled Models" subtitle="Models available for users in the chat dropdown">
          <Button
            variant="secondary"
            onClick={handleRefreshCapabilities}
            disabled={isRefreshing || enabledModels.length === 0}
          >
            <RefreshCw size={16} className={`mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            onClick={() => {
              setSelectedProviderForDiscovery(null);
              setShowDiscoveryModal(true);
            }}
            disabled={configuredProviders.length === 0}
          >
            <Plus size={16} className="mr-2" />
            Add Models
          </Button>
        </SectionHeader>
        {expandedSections.has('models') && (
          <>
            <div className="overflow-x-auto">
              {enabledModels.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <p>No models enabled yet.</p>
                  <p className="text-sm mt-1">Configure a provider above and click &quot;Add Models&quot; to get started.</p>
                </div>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Model</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Capabilities</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Max Output</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {enabledModels.map(model => (
                      <tr key={model.id} className={!model.enabled || model.providerEnabled === false ? 'bg-gray-50 opacity-60' : ''}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{getProviderName(model.providerId)}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {editingModel === model.id ? (
                              <div className="flex items-center gap-2">
                                <input type="text" value={editedDisplayName} onChange={(e) => setEditedDisplayName(e.target.value)}
                                  className="px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500" autoFocus />
                                <button onClick={() => handleEditDisplayName(model.id)} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check size={16} /></button>
                                <button onClick={() => { setEditingModel(null); setEditedDisplayName(''); }} className="p-1 text-gray-400 hover:bg-gray-100 rounded">×</button>
                              </div>
                            ) : (
                              <>
                                <span className="text-sm font-medium text-gray-900">{model.displayName}</span>
                                {model.isDefault && <Star size={14} className="text-yellow-500 fill-yellow-500" />}
                              </>
                            )}
                          </div>
                          <span className="text-xs text-gray-400">{model.id}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {model.toolCapable && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700" title="Tool/Function Calling">
                                <Wrench size={12} className="mr-1" />Tools
                              </span>
                            )}
                            {model.visionCapable && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700" title="Vision/Image Support">
                                <Eye size={12} className="mr-1" />Vision
                              </span>
                            )}
                            {model.maxInputTokens && (
                              <span className="text-xs text-gray-500" title="Context Window">{(model.maxInputTokens / 1000).toFixed(0)}K</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {editingMaxOutput === model.id ? (
                            <div className="flex items-center gap-2">
                              <input type="number" value={editedMaxOutput} onChange={(e) => setEditedMaxOutput(parseInt(e.target.value) || 0)}
                                className="w-24 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500" min={100} max={100000} autoFocus />
                              <button onClick={() => handleEditMaxOutput(model.id)} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check size={16} /></button>
                              <button onClick={() => { setEditingMaxOutput(null); setEditedMaxOutput(0); }} className="p-1 text-gray-400 hover:bg-gray-100 rounded">×</button>
                            </div>
                          ) : (
                            <button onClick={() => { setEditingMaxOutput(model.id); setEditedMaxOutput(model.maxOutputTokens || 16000); }}
                              className="text-sm text-gray-600 hover:text-blue-600 hover:underline" title="Click to edit">
                              {model.maxOutputTokens ? `${(model.maxOutputTokens / 1000).toFixed(0)}K` : '—'}
                            </button>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {model.providerEnabled === false ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700" title="Provider is disabled">Provider Off</span>
                          ) : model.enabled ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Active</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Disabled</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right relative">
                          <button onClick={() => setActiveModelMenu(activeModelMenu === model.id ? null : model.id)}
                            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
                            <MoreVertical size={16} />
                          </button>
                          {activeModelMenu === model.id && (
                            <div className="absolute right-6 top-10 w-48 bg-white rounded-lg shadow-lg border z-10">
                              {!model.isDefault && (
                                <button onClick={() => handleSetDefault(model.id)}
                                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                                  <Star size={14} />Set as Default
                                </button>
                              )}
                              <button onClick={() => { setEditingModel(model.id); setEditedDisplayName(model.displayName); setActiveModelMenu(null); }}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                                <Edit2 size={14} />Edit Display Name
                              </button>
                              <button onClick={() => handleToggleModel(model.id, !model.enabled)}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                                {model.enabled ? <><EyeOff size={14} />Disable</> : <><Eye size={14} />Enable</>}
                              </button>
                              <button onClick={() => handleDeleteModel(model.id)}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2">
                                <Trash2 size={14} />Remove
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {enabledModels.length > 0 && (
              <div className="px-6 py-3 border-t bg-gray-50 text-xs text-gray-500 flex items-center gap-4">
                <span className="flex items-center gap-1"><Star size={12} className="text-yellow-500 fill-yellow-500" /> Default model</span>
                <span className="flex items-center gap-1"><Wrench size={12} className="text-purple-500" /> Tool support</span>
                <span className="flex items-center gap-1"><Eye size={12} className="text-blue-500" /> Vision support</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ============ Section 3: Chat Defaults ============ */}
      <div className="bg-white rounded-lg border shadow-sm">
        <SectionHeader id="chatDefaults" title="Chat Defaults" subtitle="Temperature, token limits, and generation parameters">
          <Button variant="secondary" onClick={() => setShowRestoreConfirm(true)} disabled={restoringDefaults}
            className="text-orange-600 border-orange-300 hover:bg-orange-50">
            <RefreshCw size={16} className="mr-2" />Reset All
          </Button>
          {defaultsModified && (
            <Button variant="secondary" onClick={handleResetDefaults} disabled={isSavingDefaults}>Reset</Button>
          )}
          <Button onClick={handleSaveDefaults} disabled={!defaultsModified || isSavingDefaults} loading={isSavingDefaults}>
            <Save size={18} className="mr-2" />Save
          </Button>
        </SectionHeader>
        {expandedSections.has('chatDefaults') && editedDefaults && (
          <div className="p-6 space-y-6">
            {/* Default model display (read-only — set via models table) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Default Model</label>
              <div className="flex items-center gap-2">
                {defaultModel ? (
                  <>
                    <Star size={14} className="text-yellow-500 fill-yellow-500" />
                    <span className="text-sm font-medium text-gray-900">{defaultModel.displayName}</span>
                    <span className="text-xs text-gray-400">({defaultModel.id})</span>
                  </>
                ) : (
                  <span className="text-sm text-gray-400">No default model set</span>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">Change via &quot;Set as Default&quot; in the Enabled Models table above</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Temperature: {editedDefaults.temperature}
              </label>
              <input type="range" min="0" max="2" step="0.1" value={editedDefaults.temperature}
                onChange={(e) => handleDefaultsChange('temperature', parseFloat(e.target.value))} className="w-full" />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0 (Deterministic)</span>
                <span>2 (Creative)</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Max Tokens (Global Default)</label>
              <input type="number" min="100" max="16000" value={editedDefaults.maxTokens}
                onChange={(e) => handleDefaultsChange('maxTokens', parseInt(e.target.value) || 2000)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              <p className="mt-1 text-xs text-gray-500">Per-model limits (set in Enabled Models table) override this global default</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Prompt Optimization Max Tokens</label>
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium text-gray-900">{chatDefaults?.promptOptimizationMaxTokens?.toLocaleString() ?? '200'}</span>
                <span className="text-xs text-gray-400">tokens</span>
              </div>
              <p className="mt-1 text-xs text-blue-500">Configure in Settings &rarr; Limits &rarr; Token Limits</p>
            </div>

            {chatDefaults && (
              <p className="text-xs text-gray-500 pt-4 border-t">
                Last updated: {formatDate(chatDefaults.updatedAt)} by {chatDefaults.updatedBy}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ============ Section 4: Fallback ============ */}
      <div className="bg-white rounded-lg border shadow-sm">
        <SectionHeader id="fallback" title="Fallback" subtitle="Automatic model failover when primary LLM is unavailable">
          {fallbackModified && (
            <Button variant="secondary" onClick={handleResetFallback} disabled={isSavingFallback}>Reset</Button>
          )}
          <Button onClick={handleSaveFallback} disabled={!fallbackModified || isSavingFallback} loading={isSavingFallback}>
            <Save size={18} className="mr-2" />Save
          </Button>
        </SectionHeader>
        {expandedSections.has('fallback') && fallbackData && editedFallback && (
          <div className="p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Universal Fallback Model</label>
              <select value={editedFallback.universalFallback || ''}
                onChange={(e) => updateFallbackSetting('universalFallback', e.target.value || null)}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <option value="">None (Fallback disabled)</option>
                {fallbackData.eligibleFallbackModels.map((model) => (
                  <option key={model.id} value={model.id}>{model.displayName} ({model.providerId})</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">Only models with both vision and tool capabilities are eligible</p>
              {fallbackData.eligibleFallbackModels.length === 0 && (
                <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded flex items-center gap-2">
                  <AlertTriangle size={14} className="text-yellow-600" />
                  <p className="text-xs text-yellow-700">No eligible models found. Enable a model with vision and tool capabilities.</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Max Retry Attempts</label>
                <select value={editedFallback.maxRetryAttempts}
                  onChange={(e) => updateFallbackSetting('maxRetryAttempts', parseInt(e.target.value))}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                  <option value={1}>1 (No fallback)</option>
                  <option value={2}>2 (Selected + Fallback)</option>
                  <option value={3}>3 (Extended retry)</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">Number of models to try before giving up</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Health Cache Duration</label>
                <select value={editedFallback.healthCacheDuration}
                  onChange={(e) => updateFallbackSetting('healthCacheDuration', e.target.value as 'hourly' | 'daily' | 'disabled')}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                  <option value="disabled">Disabled (Check every request)</option>
                  <option value="hourly">Hourly (Skip failed models for 1 hour)</option>
                  <option value="daily">Daily (Skip failed models for 24 hours)</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">How long to remember failed models before retrying</p>
              </div>
            </div>

            <div className="border-t pt-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-medium text-gray-900">Health Cache Status</h3>
                  <p className="text-sm text-gray-500">Models temporarily marked as unhealthy after failures</p>
                </div>
                <Button variant="secondary" onClick={handleClearHealthCache}
                  disabled={isClearingCache || fallbackData.healthCache.unhealthyModels.length === 0} loading={isClearingCache}>
                  <RefreshCw size={16} className="mr-2" />Clear Cache
                </Button>
              </div>
              {fallbackData.healthCache.unhealthyModels.length === 0 ? (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
                  <CheckCircle size={16} className="text-green-600" />
                  <p className="text-sm text-green-700">All models are healthy</p>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Model</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Healthy At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {fallbackData.healthCache.unhealthyModels.map((model) => (
                        <tr key={model.modelId}>
                          <td className="px-4 py-2 text-sm text-gray-900">{model.modelId}</td>
                          <td className="px-4 py-2 text-sm text-gray-500">{formatDate(model.expiresAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-medium text-blue-900 mb-2">How Fallback Works</h4>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• When the selected model fails (rate limit, quota, etc.), the fallback model is used</li>
                <li>• If a non-vision model is selected but images are attached, fallback is used automatically</li>
                <li>• Failed models are cached to avoid repeated failures within the cache duration</li>
                <li>• Users are notified in chat when a model switch occurs</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* ============ Section 5: Model Settings Overview ============ */}
      <div className="bg-white rounded-lg border shadow-sm">
        <SectionHeader id="overview" title="Model Settings Overview"
          subtitle="API keys are shared across all features. Model-specific settings are in their respective sections." />
        {expandedSections.has('overview') && (
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-gray-50">
                <div className="p-2 rounded-lg bg-purple-100"><Database size={18} className="text-purple-600" /></div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-900 text-sm">Embeddings</h4>
                    <a href="/admin?tab=settings&section=rag" className="text-xs text-blue-600 hover:underline flex items-center gap-1">RAG Settings <ExternalLink size={10} /></a>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Vector embeddings for document search</p>
                  <p className="text-xs text-gray-400 mt-1">Default: text-embedding-3-large (OpenAI)</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-gray-50">
                <div className="p-2 rounded-lg bg-orange-100"><Mic size={18} className="text-orange-600" /></div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-900 text-sm">Transcription</h4>
                    <span className="text-xs text-gray-400">Hardcoded</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Audio to text conversion</p>
                  <p className="text-xs text-gray-400 mt-1">Model: whisper-1 (OpenAI)</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-gray-50">
                <div className="p-2 rounded-lg bg-pink-100"><Image size={18} className="text-pink-600" /></div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-900 text-sm">Image Generation</h4>
                    <span className="text-xs text-gray-400">Tool config</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">AI image creation (DALL-E, Gemini Imagen)</p>
                  <p className="text-xs text-gray-400 mt-1">Default: Gemini (gemini-3-pro-image-preview)</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-gray-50">
                <div className="p-2 rounded-lg bg-green-100"><Languages size={18} className="text-green-600" /></div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-900 text-sm">Translation</h4>
                    <span className="text-xs text-gray-400">Tool config</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Multi-language translation</p>
                  <p className="text-xs text-gray-400 mt-1">Providers: OpenAI, Gemini, Mistral</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-gray-50">
                <div className="p-2 rounded-lg bg-blue-100"><FileText size={18} className="text-blue-600" /></div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-900 text-sm">Document Processing</h4>
                    <a href="/admin?tab=settings&section=ocr" className="text-xs text-blue-600 hover:underline flex items-center gap-1">OCR Settings <ExternalLink size={10} /></a>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">PDF/image text extraction (OCR)</p>
                  <p className="text-xs text-gray-400 mt-1">Providers: Mistral, Azure DI, pdf-parse</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-gray-50">
                <div className="p-2 rounded-lg bg-yellow-100"><Search size={18} className="text-yellow-600" /></div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-900 text-sm">Reranker</h4>
                    <a href="/admin?tab=settings&section=reranker" className="text-xs text-blue-600 hover:underline flex items-center gap-1">Reranker Settings <ExternalLink size={10} /></a>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Search result re-ranking</p>
                  <p className="text-xs text-gray-400 mt-1">Providers: Cohere, Jina, Local</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-4">
              All features use the API keys configured in the Providers section above. Configure provider-specific API keys once to enable all related features.
            </p>
          </div>
        )}
      </div>

      {/* Model Discovery Modal */}
      <ModelDiscoveryModal
        isOpen={showDiscoveryModal}
        onClose={() => { setShowDiscoveryModal(false); setSelectedProviderForDiscovery(null); }}
        providers={configuredProviders}
        initialProvider={selectedProviderForDiscovery}
        onModelsAdded={handleModelsAdded}
      />

      {/* Restore Defaults Confirmation Modal */}
      <Modal isOpen={showRestoreConfirm} onClose={() => setShowRestoreConfirm(false)} title="Restore All Defaults">
        <div className="space-y-4">
          <p className="text-gray-700">Are you sure you want to restore all LLM settings to their default values? This action cannot be undone.</p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowRestoreConfirm(false)}>Cancel</Button>
            <Button onClick={handleRestoreAllDefaults} loading={restoringDefaults} className="bg-orange-600 hover:bg-orange-700">Restore Defaults</Button>
          </div>
        </div>
      </Modal>

      {/* Click outside handler for model menu */}
      {activeModelMenu && <div className="fixed inset-0 z-0" onClick={() => setActiveModelMenu(null)} />}
    </div>
  );
}

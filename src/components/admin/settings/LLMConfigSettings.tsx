'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, Wrench, Eye, Star, MoreVertical, Trash2, EyeOff, Edit2, Check } from 'lucide-react';
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
  isDefault: boolean;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ============ Component ============

export default function LLMConfigSettings() {
  // Data state
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [enabledModels, setEnabledModels] = useState<EnabledModel[]>([]);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modal state
  const [showDiscoveryModal, setShowDiscoveryModal] = useState(false);
  const [selectedProviderForDiscovery, setSelectedProviderForDiscovery] = useState<string | null>(null);
  const [showDeprecatedModal, setShowDeprecatedModal] = useState(false);

  // Model actions
  const [activeModelMenu, setActiveModelMenu] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editedDisplayName, setEditedDisplayName] = useState('');

  // ============ Data Loading ============

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/llm/providers');
      if (!res.ok) throw new Error('Failed to fetch providers');
      const data = await res.json();
      setProviders(data.providers || []);
    } catch (err) {
      console.error('Failed to fetch providers:', err);
      setError(err instanceof Error ? err.message : 'Failed to load providers');
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/llm/models');
      if (!res.ok) throw new Error('Failed to fetch models');
      const data = await res.json();
      setEnabledModels(data.models || []);
    } catch (err) {
      console.error('Failed to fetch models:', err);
      setError(err instanceof Error ? err.message : 'Failed to load models');
    }
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    await Promise.all([fetchProviders(), fetchModels()]);
    setIsLoading(false);
  }, [fetchProviders, fetchModels]);

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
      setSuccess('Provider updated successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update provider');
    }
  };

  const handleTestProvider = async (providerId: string): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await fetch(`/api/admin/llm/providers/${providerId}/test`, {
        method: 'POST',
      });

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
      setSuccess('Default model updated');
      setTimeout(() => setSuccess(null), 3000);
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
      setSuccess(enabled ? 'Model enabled' : 'Model disabled');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update model');
    }
    setActiveModelMenu(null);
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      const res = await fetch(`/api/admin/llm/models/${modelId}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to remove model');

      await fetchModels();
      setSuccess('Model removed');
      setTimeout(() => setSuccess(null), 3000);
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
      setSuccess('Display name updated');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update display name');
    }
  };

  const handleModelsAdded = async () => {
    await fetchModels();
    setShowDiscoveryModal(false);
    setSelectedProviderForDiscovery(null);
    setSuccess('Models added successfully');
    setTimeout(() => setSuccess(null), 3000);
  };

  // ============ Helpers ============

  const getProviderName = (providerId: string) => {
    const provider = providers.find(p => p.id === providerId);
    return provider?.name || providerId;
  };

  const configuredProviders = providers.filter(p => p.apiKeyConfigured || p.id === 'ollama');

  // ============ Render ============

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Configure LLM</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage API keys for LLM providers and select which models are available in Policy Bot.
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
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {/* Providers Section */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">Providers</h3>
          <p className="text-sm text-gray-500">Configure API keys for LLM providers</p>
        </div>
        <div className="p-6 space-y-4">
          {providers.map(provider => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onUpdate={(updates) => handleProviderUpdate(provider.id, updates)}
              onTest={() => handleTestProvider(provider.id)}
              onDiscoverModels={() => {
                setSelectedProviderForDiscovery(provider.id);
                setShowDiscoveryModal(true);
              }}
            />
          ))}
        </div>
      </div>

      {/* Enabled Models Section */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Enabled Models</h3>
            <p className="text-sm text-gray-500">Models available for users in the chat dropdown</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowDeprecatedModal(true)}
              disabled={enabledModels.length === 0}
            >
              Manage Deprecated
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
          </div>
        </div>

        <div className="overflow-x-auto">
          {enabledModels.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>No models enabled yet.</p>
              <p className="text-sm mt-1">Configure a provider above and click "Add Models" to get started.</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Provider
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Model
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Capabilities
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {enabledModels.map(model => (
                  <tr key={model.id} className={!model.enabled ? 'bg-gray-50 opacity-60' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {getProviderName(model.providerId)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {editingModel === model.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editedDisplayName}
                              onChange={(e) => setEditedDisplayName(e.target.value)}
                              className="px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500"
                              autoFocus
                            />
                            <button
                              onClick={() => handleEditDisplayName(model.id)}
                              className="p-1 text-green-600 hover:bg-green-50 rounded"
                            >
                              <Check size={16} />
                            </button>
                            <button
                              onClick={() => {
                                setEditingModel(null);
                                setEditedDisplayName('');
                              }}
                              className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="text-sm font-medium text-gray-900">{model.displayName}</span>
                            {model.isDefault && (
                              <Star size={14} className="text-yellow-500 fill-yellow-500" />
                            )}
                          </>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">{model.id}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {model.toolCapable && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700" title="Tool/Function Calling">
                            <Wrench size={12} className="mr-1" />
                            Tools
                          </span>
                        )}
                        {model.visionCapable && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700" title="Vision/Image Support">
                            <Eye size={12} className="mr-1" />
                            Vision
                          </span>
                        )}
                        {model.maxInputTokens && (
                          <span className="text-xs text-gray-500" title="Context Window">
                            {(model.maxInputTokens / 1000).toFixed(0)}K
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {model.enabled ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                          Disabled
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right relative">
                      <button
                        onClick={() => setActiveModelMenu(activeModelMenu === model.id ? null : model.id)}
                        className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                      >
                        <MoreVertical size={16} />
                      </button>

                      {/* Dropdown Menu */}
                      {activeModelMenu === model.id && (
                        <div className="absolute right-6 top-10 w-48 bg-white rounded-lg shadow-lg border z-10">
                          {!model.isDefault && (
                            <button
                              onClick={() => handleSetDefault(model.id)}
                              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                            >
                              <Star size={14} />
                              Set as Default
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setEditingModel(model.id);
                              setEditedDisplayName(model.displayName);
                              setActiveModelMenu(null);
                            }}
                            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                          >
                            <Edit2 size={14} />
                            Edit Display Name
                          </button>
                          <button
                            onClick={() => handleToggleModel(model.id, !model.enabled)}
                            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                          >
                            {model.enabled ? (
                              <>
                                <EyeOff size={14} />
                                Disable
                              </>
                            ) : (
                              <>
                                <Eye size={14} />
                                Enable
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleDeleteModel(model.id)}
                            className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                          >
                            <Trash2 size={14} />
                            Remove
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

        {/* Legend */}
        {enabledModels.length > 0 && (
          <div className="px-6 py-3 border-t bg-gray-50 text-xs text-gray-500 flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Star size={12} className="text-yellow-500 fill-yellow-500" /> Default model
            </span>
            <span className="flex items-center gap-1">
              <Wrench size={12} className="text-purple-500" /> Tool support
            </span>
            <span className="flex items-center gap-1">
              <Eye size={12} className="text-blue-500" /> Vision support
            </span>
          </div>
        )}
      </div>

      {/* Model Discovery Modal */}
      <ModelDiscoveryModal
        isOpen={showDiscoveryModal}
        onClose={() => {
          setShowDiscoveryModal(false);
          setSelectedProviderForDiscovery(null);
        }}
        providers={configuredProviders}
        initialProvider={selectedProviderForDiscovery}
        onModelsAdded={handleModelsAdded}
      />

      {/* Deprecated Models Modal - placeholder for now */}
      <Modal
        isOpen={showDeprecatedModal}
        onClose={() => setShowDeprecatedModal(false)}
        title="Manage Deprecated Models"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This feature will scan your enabled models against the provider APIs to find models that have been deprecated or removed.
          </p>
          <p className="text-sm text-gray-500">
            Coming soon: Automatic detection of deprecated models.
          </p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setShowDeprecatedModal(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {/* Click outside handler for model menu */}
      {activeModelMenu && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setActiveModelMenu(null)}
        />
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Wrench, Eye, Check, RefreshCw, AlertCircle } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

// ============ Types ============

interface LLMProvider {
  id: string;
  name: string;
  apiKeyConfigured: boolean;
  apiBase: string | null;
  enabled: boolean;
}

interface DiscoveredModel {
  id: string;
  name: string;
  provider: string;
  toolCapable: boolean;
  visionCapable: boolean;
  maxInputTokens: number | null;
  maxOutputTokens: number;
  isEnabled: boolean;
}

interface DiscoveryResult {
  success: boolean;
  provider: string;
  models: DiscoveredModel[];
  error?: string;
}

interface ModelDiscoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  providers: LLMProvider[];
  initialProvider?: string | null;
  onModelsAdded: () => void;
}

// ============ Component ============

export default function ModelDiscoveryModal({
  isOpen,
  onClose,
  providers,
  initialProvider,
  onModelsAdded,
}: ModelDiscoveryModalProps) {
  // State
  const [selectedProvider, setSelectedProvider] = useState<string>(initialProvider || providers[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult | null>(null);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [modelsToRemove, setModelsToRemove] = useState<Set<string>>(new Set());
  const [outputTokenOverrides, setOutputTokenOverrides] = useState<Map<string, number>>(new Map());

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedProvider(initialProvider || providers[0]?.id || '');
      setSearchQuery('');
      setDiscoveryResult(null);
      setSelectedModels(new Set());
      setModelsToRemove(new Set());
      setOutputTokenOverrides(new Map());
      setError(null);
    }
  }, [isOpen, initialProvider, providers]);

  // Discover models from provider
  const discoverModels = useCallback(async (providerId: string) => {
    if (!providerId) return;

    setIsLoading(true);
    setError(null);
    setDiscoveryResult(null);

    try {
      const res = await fetch(`/api/admin/llm/discover?provider=${providerId}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to discover models');
      }

      setDiscoveryResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discover models');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load models when provider changes
  useEffect(() => {
    if (isOpen && selectedProvider) {
      discoverModels(selectedProvider);
    }
  }, [isOpen, selectedProvider, discoverModels]);

  // Filter models by search query
  const filteredModels = discoveryResult?.models.filter(model =>
    model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    model.id.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  // Toggle model selection (for new models to add)
  const toggleModel = (modelId: string) => {
    const newSelected = new Set(selectedModels);
    if (newSelected.has(modelId)) {
      newSelected.delete(modelId);
    } else {
      newSelected.add(modelId);
    }
    setSelectedModels(newSelected);
  };

  // Toggle model removal (for enabled models)
  const toggleRemoveModel = (modelId: string) => {
    const newSet = new Set(modelsToRemove);
    if (newSet.has(modelId)) {
      newSet.delete(modelId);
    } else {
      newSet.add(modelId);
    }
    setModelsToRemove(newSet);
  };

  // Select all visible models
  const selectAll = () => {
    const notEnabled = filteredModels.filter(m => !m.isEnabled).map(m => m.id);
    setSelectedModels(new Set(notEnabled));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedModels(new Set());
  };

  // Update output tokens for a model
  const setModelOutputTokens = (modelId: string, tokens: number) => {
    const newOverrides = new Map(outputTokenOverrides);
    newOverrides.set(modelId, tokens);
    setOutputTokenOverrides(newOverrides);
  };

  // Get output tokens for a model (override or default)
  const getModelOutputTokens = (model: DiscoveredModel): number => {
    return outputTokenOverrides.get(model.id) ?? model.maxOutputTokens;
  };

  // Save changes (add new models and remove deselected ones)
  const handleSaveChanges = async () => {
    if (selectedModels.size === 0 && modelsToRemove.size === 0) return;

    setIsSaving(true);
    setError(null);

    try {
      // Add new models
      if (selectedModels.size > 0) {
        const modelsToAdd = filteredModels
          .filter(m => selectedModels.has(m.id))
          .map(m => ({
            id: m.id,
            providerId: m.provider,
            displayName: m.name,
            toolCapable: m.toolCapable,
            visionCapable: m.visionCapable,
            maxInputTokens: m.maxInputTokens,
            maxOutputTokens: getModelOutputTokens(m),
          }));

        const res = await fetch('/api/admin/llm/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ models: modelsToAdd }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to add models');
        }
      }

      // Remove deselected models
      for (const modelId of modelsToRemove) {
        const res = await fetch(`/api/admin/llm/models/${modelId}`, {
          method: 'DELETE',
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to remove model');
        }
      }

      onModelsAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  // Get available providers
  const availableProviders = providers.filter(p => p.enabled && (p.apiKeyConfigured || p.id === 'ollama'));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Models"
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4">
        {/* Provider Tabs */}
        <div className="flex gap-2 border-b pb-2">
          {availableProviders.map(provider => (
            <button
              key={provider.id}
              onClick={() => setSelectedProvider(provider.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                selectedProvider === provider.id
                  ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {provider.name}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search models..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
            <AlertCircle size={16} />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="py-12 flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <p className="text-sm text-gray-500">Discovering models from {availableProviders.find(p => p.id === selectedProvider)?.name}...</p>
          </div>
        )}

        {/* Discovery Error */}
        {!isLoading && discoveryResult && !discoveryResult.success && (
          <div className="py-8 text-center">
            <AlertCircle size={32} className="mx-auto text-red-400 mb-2" />
            <p className="text-red-600 font-medium">Failed to discover models</p>
            <p className="text-sm text-gray-500 mt-1">{discoveryResult.error}</p>
            <Button
              variant="secondary"
              onClick={() => discoverModels(selectedProvider)}
              className="mt-4"
            >
              <RefreshCw size={14} className="mr-2" />
              Retry
            </Button>
          </div>
        )}

        {/* Models List */}
        {!isLoading && discoveryResult?.success && (
          <>
            {/* Selection controls */}
            <div className="flex items-center justify-between text-sm">
              <div className="text-gray-500">
                Found {discoveryResult.models.length} models
                {filteredModels.length !== discoveryResult.models.length && ` (${filteredModels.length} shown)`}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={selectAll}
                  className="text-blue-600 hover:text-blue-800"
                >
                  Select all
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={clearSelection}
                  className="text-gray-500 hover:text-gray-700"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Models table */}
            <div className="max-h-80 overflow-y-auto border rounded-lg">
              {filteredModels.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  {searchQuery ? 'No models match your search' : 'No models available'}
                </div>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Select
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Model
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Capabilities
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Max Output
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredModels.map(model => (
                      <tr
                        key={model.id}
                        className={`cursor-pointer ${
                          model.isEnabled && modelsToRemove.has(model.id)
                            ? 'bg-red-50 hover:bg-red-100'
                            : model.isEnabled
                            ? 'hover:bg-gray-100'
                            : selectedModels.has(model.id)
                            ? 'bg-blue-50 hover:bg-blue-100'
                            : 'hover:bg-blue-50'
                        }`}
                        onClick={() => model.isEnabled ? toggleRemoveModel(model.id) : toggleModel(model.id)}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={model.isEnabled ? !modelsToRemove.has(model.id) : selectedModels.has(model.id)}
                            onChange={() => model.isEnabled ? toggleRemoveModel(model.id) : toggleModel(model.id)}
                            onClick={(e) => e.stopPropagation()}
                            className={`rounded border-gray-300 focus:ring-blue-500 ${
                              model.isEnabled ? 'text-green-600' : 'text-blue-600'
                            }`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-sm text-gray-900">{model.name}</div>
                          <div className="text-xs text-gray-400">{model.id}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {model.toolCapable && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700" title="Tools">
                                <Wrench size={10} className="mr-0.5" />
                              </span>
                            )}
                            {model.visionCapable && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700" title="Vision">
                                <Eye size={10} className="mr-0.5" />
                              </span>
                            )}
                            {model.maxInputTokens && (
                              <span className="text-xs text-gray-500">
                                {(model.maxInputTokens / 1000).toFixed(0)}K
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          {model.isEnabled ? (
                            <span className="text-xs text-gray-500">
                              {model.maxOutputTokens ? `${(model.maxOutputTokens / 1000).toFixed(0)}K` : '—'}
                            </span>
                          ) : (
                            <input
                              type="number"
                              value={getModelOutputTokens(model)}
                              onChange={(e) => setModelOutputTokens(model.id, parseInt(e.target.value) || 0)}
                              className="w-20 px-2 py-1 text-xs border rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                              min={1}
                              max={100000}
                            />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {model.isEnabled ? (
                            modelsToRemove.has(model.id) ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">
                                Will Remove
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">
                                <Check size={10} className="mr-1" />
                                Enabled
                              </span>
                            )
                          ) : (
                            selectedModels.has(model.id) ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                                Will Add
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-gray-500">
            {(selectedModels.size > 0 || modelsToRemove.size > 0) && (
              <>
                {selectedModels.size > 0 && `${selectedModels.size} to add`}
                {selectedModels.size > 0 && modelsToRemove.size > 0 && ', '}
                {modelsToRemove.size > 0 && `${modelsToRemove.size} to remove`}
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveChanges}
              disabled={(selectedModels.size === 0 && modelsToRemove.size === 0) || isSaving}
              loading={isSaving}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

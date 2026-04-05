'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronUp, ChevronDown, Settings2, Wrench, Eye, Star,
  MoreVertical, Trash2, EyeOff, Edit2, Check, FileText, Languages,
  Image, Mic, Database, Search, ExternalLink, CheckCircle, RotateCcw, Sparkles, Info,
  Zap, Brain,
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
  parallelToolCapable: boolean;
  thinkingCapable: boolean;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  isDefault: boolean;
  enabled: boolean;
  providerEnabled?: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface DetailsResult {
  found: boolean;
  toolCapable: boolean;
  visionCapable: boolean;
  parallelToolCapable: boolean;
  thinkingCapable: boolean;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  confidence: 'high' | 'medium' | 'low';
  source: 'web_search' | 'llm_knowledge' | 'pattern_match';
  sources: string[];
}

type SectionId = 'providers' | 'models' | 'overview';

// ============ Route Classification (mirrors server-side isRoute2Model) ============

const ROUTE_2_PROVIDERS = new Set(['fireworks', 'anthropic']);
const isRoute2Provider = (id: string) => ROUTE_2_PROVIDERS.has(id);
const isRoute2Model = (id: string) =>
  id.startsWith('anthropic/') || id.startsWith('claude-') || id.startsWith('fireworks/');

const ROUTE_3_PROVIDERS = new Set(['ollama']);
const isRoute3Provider = (id: string) => ROUTE_3_PROVIDERS.has(id);
const isRoute3Model = (id: string) => id.startsWith('ollama-') || id.startsWith('ollama/');

// ============ Component ============

export default function UnifiedLLMSettings({ readOnly = false }: { readOnly?: boolean }) {
  // Section expand/collapse
  const [expandedSections, setExpandedSections] = useState<Set<SectionId>>(
    new Set(['providers', 'models'])
  );

  // Provider & model state
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [enabledModels, setEnabledModels] = useState<EnabledModel[]>([]);

  // Fallback model state (lightweight — just the ID + preserved settings for API)
  const [fallbackModelId, setFallbackModelId] = useState<string | null>(null);
  const [fallbackSettings, setFallbackSettings] = useState<{ maxRetryAttempts: number; healthCacheDuration: string } | null>(null);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Model actions state
  const [showDiscoveryModal, setShowDiscoveryModal] = useState(false);
  const [selectedProviderForDiscovery, setSelectedProviderForDiscovery] = useState<string | null>(null);
  const [activeModelMenu, setActiveModelMenu] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editedDisplayName, setEditedDisplayName] = useState('');
  const [editingMaxOutput, setEditingMaxOutput] = useState<string | null>(null);
  const [editedMaxOutput, setEditedMaxOutput] = useState<number>(0);
  const [editingMaxOutputError, setEditingMaxOutputError] = useState<string | null>(null);
  const [editingMaxInput, setEditingMaxInput] = useState<string | null>(null);
  const [editedMaxInput, setEditedMaxInput] = useState<number>(0);
  const [editingMaxInputError, setEditingMaxInputError] = useState<string | null>(null);

  // Routes settings for route-aware gating
  const [routesSettings, setRoutesSettings] = useState<{
    route1Enabled: boolean;
    route2Enabled: boolean;
    route3Enabled: boolean;
    primaryRoute: 'route1' | 'route2';
  } | null>(null);

  // Inline action errors
  const [fallbackError, setFallbackError] = useState<{ modelId: string; msg: string } | null>(null);
  const [toggleError, setToggleError] = useState<{ modelId: string; field: string; msg: string } | null>(null);

  // Get Details state
  const [fetchingDetails, setFetchingDetails] = useState<string | null>(null);
  const [detailsPreview, setDetailsPreview] = useState<{ modelId: string; data: DetailsResult; applyError?: string } | null>(null);

  // ============ Route Gating (derived) ============

  const allRoutesEnabled = routesSettings?.route1Enabled && routesSettings?.route2Enabled && routesSettings?.route3Enabled;
  const route1Disabled = routesSettings ? !routesSettings.route1Enabled : false;
  const route2Disabled = routesSettings ? !routesSettings.route2Enabled : false;
  const route3Disabled = routesSettings ? !routesSettings.route3Enabled : false;

  const isModelOnDisabledRoute = (modelId: string) => {
    if (!routesSettings || allRoutesEnabled) return false;
    if (isRoute3Model(modelId)) return route3Disabled;
    return isRoute2Model(modelId) ? route2Disabled : route1Disabled;
  };

  const isProviderOnDisabledRoute = (providerId: string) => {
    if (!routesSettings || allRoutesEnabled) return false;
    if (isRoute3Provider(providerId)) return route3Disabled;
    return isRoute2Provider(providerId) ? route2Disabled : route1Disabled;
  };

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

  const fetchFallbackModelId = useCallback(async () => {
    const res = await fetch('/api/admin/settings/llm-fallback');
    if (!res.ok) return;
    const data = await res.json();
    setFallbackModelId(data.settings?.universalFallback ?? null);
    setFallbackSettings({
      maxRetryAttempts: data.settings?.maxRetryAttempts ?? 2,
      healthCacheDuration: data.settings?.healthCacheDuration ?? 'hourly',
    });
  }, []);

  const fetchRoutesSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings/routes');
      if (!res.ok) return;
      const data = await res.json();
      setRoutesSettings(data.settings);
    } catch {
      // Non-critical — degrade gracefully (no gating)
    }
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await Promise.all([fetchProviders(), fetchModels(), fetchFallbackModelId(), fetchRoutesSettings()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }, [fetchProviders, fetchModels, fetchFallbackModelId, fetchRoutesSettings]);

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
    setMenuAnchor(null);
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
    setMenuAnchor(null);
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      const res = await fetch(`/api/admin/llm/models/${modelId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove model');
      setDetailsPreview(prev => prev?.modelId === modelId ? null : prev);
      await fetchModels();
      showSuccess('Model removed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove model');
    }
    setActiveModelMenu(null);
    setMenuAnchor(null);
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
    if (editedMaxOutput < 100 || editedMaxOutput > 2000000) {
      setEditingMaxOutputError('Must be between 100 and 2,000,000');
      return;
    }
    setEditingMaxOutputError(null);
    try {
      const res = await fetch(`/api/admin/llm/models/${modelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxOutputTokens: editedMaxOutput }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error || `Failed (${res.status})`);
      }
      await fetchModels();
      setEditingMaxOutput(null);
      setEditedMaxOutput(0);
      showSuccess('Max output tokens updated');
    } catch (err) {
      setEditingMaxOutputError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleModelsAdded = async () => {
    await fetchModels();
    setShowDiscoveryModal(false);
    setSelectedProviderForDiscovery(null);
    showSuccess('Models updated successfully');
  };

  // ============ New Model Capability Actions ============

  const handleToggleCapability = async (modelId: string, field: 'toolCapable' | 'visionCapable' | 'parallelToolCapable' | 'thinkingCapable', current: boolean) => {
    setToggleError(null);
    // Optimistic update
    setEnabledModels(prev => prev.map(m => m.id === modelId ? { ...m, [field]: !current } : m));
    try {
      const res = await fetch(`/api/admin/llm/models/${modelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: !current }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        // Revert optimistic update on server error
        setEnabledModels(prev => prev.map(m => m.id === modelId ? { ...m, [field]: current } : m));
        setToggleError({ modelId, field, msg: errData.error || `Failed to save (${res.status})` });
        return;
      }
      // Update model state directly from response — avoids a second round-trip and
      // prevents fetchModels() failures from incorrectly reverting a successful save.
      const { model: updated } = await res.json() as { model: EnabledModel };
      setEnabledModels(prev => prev.map(m => m.id === modelId ? updated : m));
      const labels: Record<string, string> = { toolCapable: 'Tools', visionCapable: 'Vision', parallelToolCapable: 'Parallel', thinkingCapable: 'Thinking' };
      showSuccess(`${labels[field] || field} ${!current ? 'enabled' : 'disabled'}`);
    } catch (err) {
      // Revert on network/parse error
      setEnabledModels(prev => prev.map(m => m.id === modelId ? { ...m, [field]: current } : m));
      setToggleError({ modelId, field, msg: err instanceof Error ? err.message : 'Failed to update' });
    }
  };

  const handleEditMaxInput = async (modelId: string) => {
    if (editedMaxInput < 1000 || editedMaxInput > 10000000) {
      setEditingMaxInputError('Must be between 1,000 and 10,000,000');
      return;
    }
    setEditingMaxInputError(null);
    try {
      const res = await fetch(`/api/admin/llm/models/${modelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxInputTokens: editedMaxInput }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error || `Failed (${res.status})`);
      }
      await fetchModels();
      setEditingMaxInput(null);
      setEditedMaxInput(0);
      showSuccess('Max input tokens updated');
    } catch (err) {
      setEditingMaxInputError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleSetFallback = async (modelId: string | null) => {
    setFallbackError(null);
    try {
      const res = await fetch('/api/admin/settings/llm-fallback', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          universalFallback: modelId,
          maxRetryAttempts: fallbackSettings?.maxRetryAttempts ?? 2,
          healthCacheDuration: fallbackSettings?.healthCacheDuration ?? 'hourly',
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        const msg = errData.error || 'Failed to update fallback model';
        if (modelId) {
          setFallbackError({ modelId, msg });
        } else {
          setError(msg);
        }
        setActiveModelMenu(null);
        setMenuAnchor(null);
        return;
      }
      setFallbackModelId(modelId);
      showSuccess(modelId ? 'Fallback model set' : 'Fallback model removed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update fallback model';
      if (modelId) {
        setFallbackError({ modelId, msg });
      } else {
        setError(msg);
      }
    }
    setActiveModelMenu(null);
    setMenuAnchor(null);
  };

  const handleGetDetails = async (modelId: string) => {
    setFetchingDetails(modelId);
    setDetailsPreview(null);
    setActiveModelMenu(null);
    setMenuAnchor(null);
    try {
      const res = await fetch(`/api/admin/llm/models/get-details?id=${encodeURIComponent(modelId)}`, { method: 'POST' });
      const data = await res.json() as DetailsResult;
      if (!res.ok) throw new Error('Failed to get model details');
      setDetailsPreview({ modelId, data });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get model details');
    } finally {
      setFetchingDetails(null);
    }
  };

  const handleApplyDetails = async (modelId: string, data: DetailsResult) => {
    setDetailsPreview(prev => prev ? { ...prev, applyError: undefined } : prev);
    try {
      // Only apply token limits from Get Details — tool/vision capabilities are
      // managed manually via the toggle buttons to avoid overwriting admin settings.
      const updates: Record<string, unknown> = {};
      if (data.maxInputTokens !== null) updates.maxInputTokens = data.maxInputTokens;
      if (data.maxOutputTokens !== null) updates.maxOutputTokens = data.maxOutputTokens;

      if (Object.keys(updates).length === 0) {
        setDetailsPreview(null);
        return;
      }

      const res = await fetch(`/api/admin/llm/models/${modelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error || `Failed to apply (${res.status})`);
      }
      await fetchModels();
      setDetailsPreview(null);
      showSuccess('Token limits applied');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to apply details';
      setDetailsPreview(prev => prev ? { ...prev, applyError: msg } : prev);
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
    <div className={`space-y-6 ${readOnly ? '[&_input]:pointer-events-none [&_select]:pointer-events-none [&_textarea]:pointer-events-none [&_input]:opacity-75 [&_select]:opacity-75' : ''}`}>
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900">LLM Settings</h2>
        <p className="text-sm text-gray-500 mt-1">
          {readOnly ? 'Current provider and model configuration (view only).' : 'Manage providers and models. Click capabilities to toggle, click token values to edit.'}
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

      {/* Route gating banner */}
      {routesSettings && !allRoutesEnabled && (
        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <Info size={18} className="text-blue-600 mt-0.5 shrink-0" />
          <div className="text-sm text-blue-800">
            <span className="font-medium">
              {[
                route1Disabled && 'Route 1 (LiteLLM)',
                route2Disabled && 'Route 2 (Direct Providers)',
                route3Disabled && 'Route 3 (Ollama)',
              ].filter(Boolean).join(', ')}{' '}
              {[route1Disabled, route2Disabled, route3Disabled].filter(Boolean).length > 1 ? 'are' : 'is'} disabled.
            </span>
            {' '}Providers and models for disabled routes are view-only. Default and fallback models must be selected from enabled routes.{' '}
            <a href="/admin?tab=settings&section=routes" className="text-blue-600 underline hover:text-blue-800">
              Go to Routes
            </a>
          </div>
        </div>
      )}

      {/* ============ Section 1: Providers ============ */}
      <div className="bg-white rounded-lg border shadow-sm">
        <SectionHeader id="providers" title="Providers" subtitle="Configure API keys for LLM providers" />
        {expandedSections.has('providers') && (
          <div className="p-6 space-y-4">
            {providers.map(provider => {
              const routeDisabled = isProviderOnDisabledRoute(provider.id);
              return (
                <div key={provider.id} className={routeDisabled ? 'opacity-50 pointer-events-none' : ''}>
                  <ProviderCard
                    provider={provider}
                    onUpdate={(updates) => handleProviderUpdate(provider.id, updates)}
                    onTest={() => handleTestProvider(provider.id)}
                  />
                  {routeDisabled && (
                    <p className="text-xs text-gray-400 mt-1 ml-5">
                      {isRoute3Provider(provider.id) ? 'Route 3' : isRoute2Provider(provider.id) ? 'Route 2' : 'Route 1'} is disabled
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ============ Section 2: Enabled Models ============ */}
      <div className="bg-white rounded-lg border shadow-sm">
        <SectionHeader id="models" title="Enabled Models" subtitle="Models available for users in the chat dropdown">
          {!readOnly && (
            <Button
              onClick={() => {
                setSelectedProviderForDiscovery(null);
                setShowDiscoveryModal(true);
              }}
              disabled={configuredProviders.length === 0}
            >
              <Settings2 size={16} className="mr-2" />
              Manage Models
            </Button>
          )}
        </SectionHeader>
        {expandedSections.has('models') && (
          <>
            <div className="overflow-x-auto">
              {enabledModels.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <p>No models enabled yet.</p>
                  <p className="text-sm mt-1">Configure a provider above and click &quot;Manage Models&quot; to get started.</p>
                </div>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Model</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tools</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vision</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Parallel</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Thinking</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Max Input</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Max Output</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      {!readOnly && <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {enabledModels.filter(m => m.providerEnabled !== false).map(model => {
                      const routeOff = isModelOnDisabledRoute(model.id);
                      return (
                      <React.Fragment key={model.id}>
                      <tr className={`${
                        routeOff ? 'bg-gray-50 opacity-40' :
                        !model.enabled || model.providerEnabled === false ? 'bg-gray-50 opacity-60' : ''
                      }`}>
                        {/* Provider */}
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{getProviderName(model.providerId)}</td>

                        {/* Model name */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
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
                                {model.isDefault && <span title="Default model"><Star size={13} className="text-yellow-500 fill-yellow-500 shrink-0" /></span>}
                                {fallbackModelId === model.id && <span title="Fallback model"><RotateCcw size={13} className="text-gray-400 shrink-0" /></span>}
                              </>
                            )}
                          </div>
                          <span className="text-xs text-gray-400">{model.id}</span>
                          {fetchingDetails === model.id && (
                            <span className="text-xs text-blue-500 mt-0.5 block">Fetching details…</span>
                          )}
                        </td>

                        {/* Tools toggle */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            onClick={() => !readOnly && !routeOff && handleToggleCapability(model.id, 'toolCapable', model.toolCapable)}
                            disabled={readOnly || routeOff}
                            title={routeOff ? 'Route is disabled' : model.toolCapable ? 'Tool calling enabled — click to disable' : 'Tool calling disabled — click to enable'}
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                              model.toolCapable
                                ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                            } ${readOnly || routeOff ? 'cursor-default' : 'cursor-pointer'}`}
                          >
                            <Wrench size={11} className="mr-1" />{model.toolCapable ? 'On' : 'Off'}
                          </button>
                          {toggleError?.modelId === model.id && toggleError.field === 'toolCapable' && (
                            <p className="text-xs text-red-500 mt-0.5">{toggleError.msg}</p>
                          )}
                        </td>

                        {/* Vision toggle */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            onClick={() => !readOnly && !routeOff && handleToggleCapability(model.id, 'visionCapable', model.visionCapable)}
                            disabled={readOnly || routeOff}
                            title={routeOff ? 'Route is disabled' : model.visionCapable ? 'Vision enabled — click to disable' : 'Vision disabled — click to enable'}
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                              model.visionCapable
                                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                            } ${readOnly || routeOff ? 'cursor-default' : 'cursor-pointer'}`}
                          >
                            <Eye size={11} className="mr-1" />{model.visionCapable ? 'On' : 'Off'}
                          </button>
                          {toggleError?.modelId === model.id && toggleError.field === 'visionCapable' && (
                            <p className="text-xs text-red-500 mt-0.5">{toggleError.msg}</p>
                          )}
                        </td>

                        {/* Parallel toggle */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            onClick={() => !readOnly && !routeOff && handleToggleCapability(model.id, 'parallelToolCapable', model.parallelToolCapable)}
                            disabled={readOnly || routeOff}
                            title={routeOff ? 'Route is disabled' : model.parallelToolCapable ? 'Parallel tool calls enabled — click to disable' : 'Parallel tool calls disabled — click to enable'}
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                              model.parallelToolCapable
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                            } ${readOnly || routeOff ? 'cursor-default' : 'cursor-pointer'}`}
                          >
                            <Zap size={11} className="mr-1" />{model.parallelToolCapable ? 'On' : 'Off'}
                          </button>
                          {toggleError?.modelId === model.id && toggleError.field === 'parallelToolCapable' && (
                            <p className="text-xs text-red-500 mt-0.5">{toggleError.msg}</p>
                          )}
                        </td>

                        {/* Thinking toggle */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            onClick={() => !readOnly && !routeOff && handleToggleCapability(model.id, 'thinkingCapable', model.thinkingCapable)}
                            disabled={readOnly || routeOff}
                            title={routeOff ? 'Route is disabled' : model.thinkingCapable ? 'Thinking/reasoning enabled — click to disable' : 'Thinking/reasoning disabled — click to enable'}
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                              model.thinkingCapable
                                ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                            } ${readOnly || routeOff ? 'cursor-default' : 'cursor-pointer'}`}
                          >
                            <Brain size={11} className="mr-1" />{model.thinkingCapable ? 'On' : 'Off'}
                          </button>
                          {toggleError?.modelId === model.id && toggleError.field === 'thinkingCapable' && (
                            <p className="text-xs text-red-500 mt-0.5">{toggleError.msg}</p>
                          )}
                        </td>

                        {/* Max Input — inline edit */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {editingMaxInput === model.id ? (
                            <div>
                              <div className="flex items-center gap-1">
                                <input type="number" value={editedMaxInput} onChange={(e) => { setEditedMaxInput(parseInt(e.target.value) || 0); setEditingMaxInputError(null); }}
                                  className={`w-24 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 ${editingMaxInputError ? 'border-red-400' : ''}`} min={1000} max={10000000} autoFocus />
                                <button onClick={() => handleEditMaxInput(model.id)} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check size={14} /></button>
                                <button onClick={() => { setEditingMaxInput(null); setEditedMaxInput(0); setEditingMaxInputError(null); }} className="p-1 text-gray-400 hover:bg-gray-100 rounded">×</button>
                              </div>
                              {editingMaxInputError && <p className="text-xs text-red-600 mt-0.5">{editingMaxInputError}</p>}
                            </div>
                          ) : (
                            <button
                              onClick={() => !readOnly && !routeOff && (setEditingMaxInput(model.id), setEditedMaxInput(model.maxInputTokens || 128000))}
                              disabled={readOnly || routeOff}
                              className={`text-sm text-gray-600 ${readOnly || routeOff ? '' : 'hover:text-blue-600 hover:underline'}`}
                              title={routeOff ? 'Route is disabled' : readOnly ? undefined : 'Click to edit'}
                            >
                              {model.maxInputTokens ? `${(model.maxInputTokens / 1000).toFixed(0)}K` : '\u2014'}
                            </button>
                          )}
                        </td>

                        {/* Max Output — inline edit */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {editingMaxOutput === model.id ? (
                            <div>
                              <div className="flex items-center gap-1">
                                <input type="number" value={editedMaxOutput} onChange={(e) => { setEditedMaxOutput(parseInt(e.target.value) || 0); setEditingMaxOutputError(null); }}
                                  className={`w-24 px-2 py-1 text-sm border rounded focus:ring-2 focus:ring-blue-500 ${editingMaxOutputError ? 'border-red-400' : ''}`} min={100} max={2000000} autoFocus />
                                <button onClick={() => handleEditMaxOutput(model.id)} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check size={14} /></button>
                                <button onClick={() => { setEditingMaxOutput(null); setEditedMaxOutput(0); setEditingMaxOutputError(null); }} className="p-1 text-gray-400 hover:bg-gray-100 rounded">×</button>
                              </div>
                              {editingMaxOutputError && <p className="text-xs text-red-600 mt-0.5">{editingMaxOutputError}</p>}
                            </div>
                          ) : (
                            <button
                              onClick={() => !readOnly && !routeOff && (setEditingMaxOutput(model.id), setEditedMaxOutput(model.maxOutputTokens || 16000))}
                              disabled={readOnly || routeOff}
                              className={`text-sm text-gray-600 ${readOnly || routeOff ? '' : 'hover:text-blue-600 hover:underline'}`}
                              title={routeOff ? 'Route is disabled' : readOnly ? undefined : 'Click to edit'}
                            >
                              {model.maxOutputTokens ? `${(model.maxOutputTokens / 1000).toFixed(0)}K` : '—'}
                            </button>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {routeOff ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500"
                              title={`${isRoute3Model(model.id) ? 'Route 3' : isRoute2Model(model.id) ? 'Route 2' : 'Route 1'} is disabled`}>Route Off</span>
                          ) : model.providerEnabled === false ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700" title="Provider is disabled">Provider Off</span>
                          ) : model.enabled ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Active</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Disabled</span>
                          )}
                          {fallbackError?.modelId === model.id && (
                            <p className="text-xs text-red-500 mt-0.5 max-w-[140px]">{fallbackError.msg}</p>
                          )}
                        </td>

                        {/* Actions */}
                        {!readOnly && (
                          <td className="px-4 py-3 whitespace-nowrap text-right">
                            <button
                              onClick={(e) => {
                                if (activeModelMenu === model.id) {
                                  setActiveModelMenu(null);
                                  setMenuAnchor(null);
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const MENU_HEIGHT = 320; // 7 items × ~40px + separators
                                  const spaceBelow = window.innerHeight - rect.bottom;
                                  setActiveModelMenu(model.id);
                                  setMenuAnchor(
                                    spaceBelow < MENU_HEIGHT
                                      ? { bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right }
                                      : { top: rect.bottom + 4, right: window.innerWidth - rect.right }
                                  );
                                }
                              }}
                              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
                              <MoreVertical size={16} />
                            </button>
                          </td>
                        )}
                      </tr>

                      {/* Get Details preview row */}
                      {detailsPreview?.modelId === model.id && (
                        <tr key={`${model.id}-preview`} className="bg-purple-50">
                          <td colSpan={!readOnly ? 8 : 7} className="px-4 py-3">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  {detailsPreview.data.source === 'web_search' && (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-700 bg-purple-100 px-2 py-0.5 rounded">
                                      <Sparkles size={10} />Web search
                                    </span>
                                  )}
                                  {detailsPreview.data.source === 'pattern_match' && (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                                      ⚙ Pattern match (fallback)
                                    </span>
                                  )}
                                  {detailsPreview.data.source === 'llm_knowledge' && (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                                      <Sparkles size={10} />AI knowledge
                                    </span>
                                  )}
                                  <span className="text-xs text-gray-500 capitalize">{detailsPreview.data.confidence} confidence</span>
                                </div>
                                <div className="flex items-center gap-4 text-sm text-gray-700">
                                  <span className="text-gray-400">Tools: {detailsPreview.data.toolCapable ? '✓' : '✗'}</span>
                                  <span className="text-gray-400">Vision: {detailsPreview.data.visionCapable ? '✓' : '✗'}</span>
                                  <span className="text-gray-400">Parallel: {detailsPreview.data.parallelToolCapable ? '✓' : '✗'}</span>
                                  <span className="text-gray-400">Thinking: {detailsPreview.data.thinkingCapable ? '✓' : '✗'}</span>
                                  {detailsPreview.data.maxInputTokens ? (
                                    <span>Context: <strong>{(detailsPreview.data.maxInputTokens / 1000).toFixed(0)}K</strong></span>
                                  ) : null}
                                  {detailsPreview.data.maxOutputTokens ? (
                                    <span>Max Output: <strong>{(detailsPreview.data.maxOutputTokens / 1000).toFixed(0)}K</strong></span>
                                  ) : null}
                                </div>
                                {(detailsPreview.data.maxInputTokens || detailsPreview.data.maxOutputTokens) ? (
                                  <p className="text-xs text-gray-400 mt-0.5">Apply will update token limits only. Toggle tools/vision manually.</p>
                                ) : (
                                  <p className="text-xs text-gray-400 mt-0.5">No token limits found. Toggle tools/vision manually.</p>
                                )}
                                {detailsPreview.data.sources.length > 0 && (
                                  <div className="text-xs text-gray-400 mt-1 truncate max-w-lg">
                                    Source: {detailsPreview.data.sources[0]}
                                  </div>
                                )}
                                {detailsPreview.applyError && (
                                  <div className="text-xs text-red-600 mt-1">{detailsPreview.applyError}</div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Button
                                  onClick={() => handleApplyDetails(model.id, detailsPreview.data)}
                                  disabled={!detailsPreview.data.maxInputTokens && !detailsPreview.data.maxOutputTokens}
                                >
                                  Apply Token Limits
                                </Button>
                                <Button variant="secondary" onClick={() => setDetailsPreview(null)}>
                                  Dismiss
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    )})}
                  </tbody>
                </table>
              )}
            </div>
            {enabledModels.length > 0 && (
              <div className="px-6 py-3 border-t bg-gray-50 text-xs text-gray-500 flex items-center gap-4">
                <span className="flex items-center gap-1"><Star size={12} className="text-yellow-500 fill-yellow-500" /> Default model</span>
                <span className="flex items-center gap-1"><RotateCcw size={12} className="text-gray-400" /> Fallback model</span>
                <span className="flex items-center gap-1"><Wrench size={12} className="text-purple-500" /> Tool support</span>
                <span className="flex items-center gap-1"><Eye size={12} className="text-blue-500" /> Vision support</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ============ Section 3: Model Settings Overview ============ */}
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

      {/* Model action menu — portal into document.body to escape stacking contexts */}
      {activeModelMenu && menuAnchor && (() => {
        const m = enabledModels.find(mo => mo.id === activeModelMenu);
        if (!m) return null;
        const menuRouteOff = isModelOnDisabledRoute(m.id);
        return createPortal(
          <>
            {/* Backdrop: captures outside clicks; unmounts with menu so no post-close scroll lock */}
            <div
              className="fixed inset-0 z-[49]"
              onClick={() => { setActiveModelMenu(null); setMenuAnchor(null); }}
            />
            <div
            style={{ position: 'fixed', top: menuAnchor.top, bottom: menuAnchor.bottom, right: menuAnchor.right, maxHeight: '80vh', overflowY: 'auto' }}
            className="w-52 bg-white rounded-lg shadow-lg border z-[50]">
            <button onClick={() => handleGetDetails(m.id)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
              <Sparkles size={14} className="text-purple-500" />Get Details
            </button>
            <div className="border-t my-1" />
            {!m.isDefault && (
              menuRouteOff ? (
                <div className="w-full px-4 py-2 text-left text-sm text-gray-300 flex items-center gap-2 cursor-not-allowed"
                  title="Model's route is disabled">
                  <Star size={14} />Set as Default
                </div>
              ) : (
                <button onClick={() => handleSetDefault(m.id)}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                  <Star size={14} />Set as Default
                </button>
              )
            )}
            {fallbackModelId === m.id ? (
              <button onClick={() => handleSetFallback(null)}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                <RotateCcw size={14} />Remove Fallback
              </button>
            ) : (
              menuRouteOff ? (
                <div className="w-full px-4 py-2 text-left text-sm text-gray-300 flex items-center gap-2 cursor-not-allowed"
                  title="Model's route is disabled">
                  <RotateCcw size={14} />Set as Fallback
                </div>
              ) : (
                <button onClick={() => handleSetFallback(m.id)}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
                  <RotateCcw size={14} />Set as Fallback
                </button>
              )
            )}
            <div className="border-t my-1" />
            <button onClick={() => { setEditingModel(m.id); setEditedDisplayName(m.displayName); setActiveModelMenu(null); setMenuAnchor(null); }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
              <Edit2 size={14} />Edit Display Name
            </button>
            <button onClick={() => handleToggleModel(m.id, !m.enabled)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2">
              {m.enabled ? <><EyeOff size={14} />Disable</> : <><Eye size={14} />Enable</>}
            </button>
            <button onClick={() => handleDeleteModel(m.id)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2">
              <Trash2 size={14} />Remove
            </button>
          </div>
          </>,
          document.body
        );
      })()}
    </div>
  );
}

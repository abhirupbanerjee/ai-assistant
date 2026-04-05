'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Network, Server, Zap, HardDrive, AlertTriangle, CheckCircle2, XCircle,
  RefreshCw, Shield,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

// ============ Types ============

interface RoutesSettings {
  route1Enabled: boolean;
  route2Enabled: boolean;
  route3Enabled: boolean;
  primaryRoute: 'route1' | 'route2' | 'route3';
}

interface RouteHealth {
  route1: { healthy: boolean; latencyMs: number | null; error?: string };
  route2: {
    fireworks: { healthy: boolean; latencyMs: number | null; configured: boolean; error?: string };
    claude: { configured: boolean };
  };
}

// ============ Route Classification (mirrors server-side isRoute2Model) ============

const isRoute2Model = (id: string) =>
  id.startsWith('anthropic/') || id.startsWith('claude-') || id.startsWith('fireworks/');

const isRoute3Model = (id: string) =>
  id.startsWith('ollama-') || id.startsWith('ollama/');

// ============ Component ============

export default function RoutesSettingsPanel() {
  const [settings, setSettings] = useState<RoutesSettings | null>(null);
  const [edited, setEdited] = useState<RoutesSettings | null>(null);
  const [health, setHealth] = useState<RouteHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Model validation state
  const [defaultModel, setDefaultModel] = useState<{ id: string; displayName: string } | null>(null);
  const [fallbackModel, setFallbackModel] = useState<{ id: string; displayName: string } | null>(null);

  const isModified = edited && settings && (
    edited.route1Enabled !== settings.route1Enabled ||
    edited.route2Enabled !== settings.route2Enabled ||
    edited.route3Enabled !== settings.route3Enabled ||
    edited.primaryRoute !== settings.primaryRoute
  );

  // Fetch settings
  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/settings/routes');
      if (!res.ok) throw new Error('Failed to load routes settings');
      const data = await res.json();
      setSettings(data.settings);
      setEdited(data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check health
  const checkHealth = useCallback(async () => {
    setIsCheckingHealth(true);
    try {
      const res = await fetch('/api/admin/routes/health');
      if (res.ok) {
        setHealth(await res.json());
      }
    } catch {
      // Health check failure is informational, don't block UI
    } finally {
      setIsCheckingHealth(false);
    }
  }, []);

  // Fetch default & fallback model info for route-conflict validation
  const fetchModelValidation = useCallback(async () => {
    try {
      const [modelsRes, fbRes] = await Promise.all([
        fetch('/api/admin/llm/models'),
        fetch('/api/admin/settings/llm-fallback'),
      ]);

      let models: Array<{ id: string; displayName: string; isDefault: boolean }> = [];
      if (modelsRes.ok) {
        const data = await modelsRes.json();
        models = data.models || [];
      }

      const def = models.find(m => m.isDefault);
      setDefaultModel(def ? { id: def.id, displayName: def.displayName } : null);

      if (fbRes.ok) {
        const fbData = await fbRes.json();
        const fbId = fbData.settings?.universalFallback;
        if (fbId) {
          const fbModel = models.find(m => m.id === fbId);
          setFallbackModel(fbModel
            ? { id: fbModel.id, displayName: fbModel.displayName }
            : { id: fbId, displayName: fbId }
          );
        } else {
          setFallbackModel(null);
        }
      }
    } catch {
      // Non-critical — warnings just won't show
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    checkHealth();
    fetchModelValidation();
  }, [fetchSettings, checkHealth, fetchModelValidation]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!edited) return;
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/admin/settings/routes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edited),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      const data = await res.json();
      setSettings(data.settings);
      setEdited(data.settings);
      setSuccess('Routes settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  }, [edited]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!edited) return null;

  const route1IsPrimary = edited.primaryRoute === 'route1';
  const route2IsPrimary = edited.primaryRoute === 'route2';
  const route3IsPrimary = edited.primaryRoute === 'route3';
  const enabledCount = [edited.route1Enabled, edited.route2Enabled, edited.route3Enabled].filter(Boolean).length;
  const onlyOneEnabled = enabledCount === 1;

  // Model route-conflict validation (uses edited for real-time feedback)
  const defaultModelInvalid = defaultModel && (() => {
    const isR2 = isRoute2Model(defaultModel.id);
    const isR3 = isRoute3Model(defaultModel.id);
    if (isR3 && !edited.route3Enabled) return { model: defaultModel, route: 'Route 3' };
    if (isR2 && !edited.route2Enabled) return { model: defaultModel, route: 'Route 2' };
    if (!isR2 && !isR3 && !edited.route1Enabled) return { model: defaultModel, route: 'Route 1' };
    return null;
  })();

  const fallbackModelInvalid = fallbackModel && (() => {
    const isR2 = isRoute2Model(fallbackModel.id);
    const isR3 = isRoute3Model(fallbackModel.id);
    if (isR3 && !edited.route3Enabled) return { model: fallbackModel, route: 'Route 3' };
    if (isR2 && !edited.route2Enabled) return { model: fallbackModel, route: 'Route 2' };
    if (!isR2 && !isR3 && !edited.route1Enabled) return { model: fallbackModel, route: 'Route 1' };
    return null;
  })();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Network size={24} className="text-blue-600" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900">LLM Routes</h2>
            <p className="text-sm text-gray-500">Configure primary and fallback LLM routing</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={checkHealth}
          disabled={isCheckingHealth}
        >
          <RefreshCw size={16} className={isCheckingHealth ? 'animate-spin' : ''} />
          Check Health
        </Button>
      </div>

      {/* Warning banner */}
      {onlyOneEnabled && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-800">
            <span className="font-medium">No fallback route.</span> Enable both routes for automatic failover when the primary route is unavailable.
          </div>
        </div>
      )}

      {/* Default model route-conflict warning */}
      {defaultModelInvalid && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle size={18} className="text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm text-red-800">
            <span className="font-medium">Default model conflict.</span>{' '}
            The current default model ({defaultModelInvalid.model.displayName}) belongs to{' '}
            {defaultModelInvalid.route}, which is disabled. Select a new default from the active route.{' '}
            <a href="/admin?tab=settings&section=llm" className="text-red-600 underline hover:text-red-800">
              Go to LLM Settings
            </a>
          </div>
        </div>
      )}

      {/* Fallback model route-conflict warning */}
      {fallbackModelInvalid && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle size={18} className="text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm text-red-800">
            <span className="font-medium">Fallback model conflict.</span>{' '}
            The current fallback model ({fallbackModelInvalid.model.displayName}) belongs to{' '}
            {fallbackModelInvalid.route}, which is disabled. Select a new fallback from the active route.{' '}
            <a href="/admin?tab=settings&section=llm" className="text-red-600 underline hover:text-red-800">
              Go to LLM Settings
            </a>
          </div>
        </div>
      )}

      {/* Status messages */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{success}</div>
      )}

      {/* Route 1 Card */}
      <div className={`border rounded-lg overflow-hidden ${edited.route1Enabled ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
        <div className="px-5 py-4 bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Server size={20} className="text-gray-600" />
            <div>
              <h3 className="font-medium text-gray-900">Route 1: LiteLLM Proxy</h3>
              <p className="text-xs text-gray-500">OpenAI, Gemini, Mistral, DeepSeek, Ollama</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Health indicator */}
            {health && (
              <span className="flex items-center gap-1 text-xs">
                {health.route1.healthy ? (
                  <><CheckCircle2 size={14} className="text-green-500" /> Healthy{health.route1.latencyMs != null && <span className="text-gray-400">({health.route1.latencyMs}ms)</span>}</>
                ) : (
                  <><XCircle size={14} className="text-red-500" /> {health.route1.error || 'Unreachable'}</>
                )}
              </span>
            )}
            {/* Primary badge */}
            {edited.route1Enabled && route1IsPrimary && (
              <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">Primary</span>
            )}
            {edited.route1Enabled && !route1IsPrimary && (
              <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">Fallback</span>
            )}
            {/* Toggle */}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={edited.route1Enabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setEdited(prev => {
                    if (!prev) return prev;
                    const next = { ...prev, route1Enabled: enabled };
                    // If disabling, switch primary to first available route
                    if (!enabled && prev.primaryRoute === 'route1') {
                      next.primaryRoute = prev.route2Enabled ? 'route2' : 'route3';
                    }
                    // Don't allow disabling all
                    if (!enabled && !prev.route2Enabled && !prev.route3Enabled) return prev;
                    return next;
                  });
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>
        {edited.route1Enabled && (
          <div className="px-5 py-3 border-t space-y-2">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setEdited(prev => prev ? { ...prev, primaryRoute: 'route1' } : prev)}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
                  route1IsPrimary ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                <div className={`w-3 h-3 rounded-full border-2 ${route1IsPrimary ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`}>
                  {route1IsPrimary && <div className="w-1 h-1 bg-white rounded-full m-auto mt-[2px]" />}
                </div>
                Set as Primary
              </button>
            </div>
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <Shield size={12} />
              Requires: <code className="bg-gray-100 px-1 rounded">OPENAI_BASE_URL</code>, <code className="bg-gray-100 px-1 rounded">LITELLM_MASTER_KEY</code>
            </div>
          </div>
        )}
      </div>

      {/* Route 2 Card */}
      <div className={`border rounded-lg overflow-hidden ${edited.route2Enabled ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
        <div className="px-5 py-4 bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap size={20} className="text-orange-500" />
            <div>
              <h3 className="font-medium text-gray-900">Route 2: Direct Providers</h3>
              <p className="text-xs text-gray-500">Fireworks AI, Claude (Anthropic) — bypasses LiteLLM</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Health indicator */}
            {health && (
              <span className="flex items-center gap-1 text-xs">
                {health.route2.fireworks.configured ? (
                  health.route2.fireworks.healthy ? (
                    <><CheckCircle2 size={14} className="text-green-500" /> Fireworks OK{health.route2.fireworks.latencyMs != null && <span className="text-gray-400">({health.route2.fireworks.latencyMs}ms)</span>}</>
                  ) : (
                    <><XCircle size={14} className="text-red-500" /> Fireworks: {health.route2.fireworks.error || 'Unreachable'}</>
                  )
                ) : (
                  <><XCircle size={14} className="text-gray-400" /> Fireworks not configured</>
                )}
                <span className="text-gray-300 mx-1">|</span>
                {health.route2.claude.configured ? (
                  <><CheckCircle2 size={14} className="text-green-500" /> Claude OK</>
                ) : (
                  <><XCircle size={14} className="text-gray-400" /> Claude not configured</>
                )}
              </span>
            )}
            {/* Primary badge */}
            {edited.route2Enabled && route2IsPrimary && (
              <span className="px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 rounded-full">Primary</span>
            )}
            {edited.route2Enabled && !route2IsPrimary && (
              <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">Fallback</span>
            )}
            {/* Toggle */}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={edited.route2Enabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setEdited(prev => {
                    if (!prev) return prev;
                    const next = { ...prev, route2Enabled: enabled };
                    if (!enabled && prev.primaryRoute === 'route2') {
                      next.primaryRoute = prev.route1Enabled ? 'route1' : 'route3';
                    }
                    if (!enabled && !prev.route1Enabled && !prev.route3Enabled) return prev;
                    return next;
                  });
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"></div>
            </label>
          </div>
        </div>
        {edited.route2Enabled && (
          <div className="px-5 py-3 border-t space-y-2">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setEdited(prev => prev ? { ...prev, primaryRoute: 'route2' } : prev)}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
                  route2IsPrimary ? 'bg-orange-50 text-orange-700 font-medium' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                <div className={`w-3 h-3 rounded-full border-2 ${route2IsPrimary ? 'border-orange-600 bg-orange-600' : 'border-gray-300'}`}>
                  {route2IsPrimary && <div className="w-1 h-1 bg-white rounded-full m-auto mt-[2px]" />}
                </div>
                Set as Primary
              </button>
            </div>
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <Shield size={12} />
              Requires: <code className="bg-gray-100 px-1 rounded">FIREWORKS_AI_API_KEY</code>, <code className="bg-gray-100 px-1 rounded">ANTHROPIC_API_KEY</code>
            </div>
          </div>
        )}
      </div>

      {/* Route 3 Card */}
      <div className={`border rounded-lg overflow-hidden ${edited.route3Enabled ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
        <div className="px-5 py-4 bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HardDrive size={20} className="text-emerald-600" />
            <div>
              <h3 className="font-medium text-gray-900">Route 3: Local / Ollama</h3>
              <p className="text-xs text-gray-500">Direct connection to local Ollama server. Air-gapped capable — no external API calls.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Primary badge */}
            {edited.route3Enabled && route3IsPrimary && (
              <span className="px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full">Primary</span>
            )}
            {edited.route3Enabled && !route3IsPrimary && (
              <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">Fallback</span>
            )}
            {/* Toggle */}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={edited.route3Enabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setEdited(prev => {
                    if (!prev) return prev;
                    const next = { ...prev, route3Enabled: enabled };
                    if (!enabled && prev.primaryRoute === 'route3') {
                      next.primaryRoute = prev.route1Enabled ? 'route1' : 'route2';
                    }
                    if (!enabled && !prev.route1Enabled && !prev.route2Enabled) return prev;
                    return next;
                  });
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>
        </div>
        {edited.route3Enabled && (
          <div className="px-5 py-3 border-t space-y-2">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setEdited(prev => prev ? { ...prev, primaryRoute: 'route3' } : prev)}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
                  route3IsPrimary ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                <div className={`w-3 h-3 rounded-full border-2 ${route3IsPrimary ? 'border-emerald-600 bg-emerald-600' : 'border-gray-300'}`}>
                  {route3IsPrimary && <div className="w-1 h-1 bg-white rounded-full m-auto mt-[2px]" />}
                </div>
                Set as Primary
              </button>
            </div>
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <Shield size={12} />
              Providers: <code className="bg-gray-100 px-1 rounded">Ollama</code>
            </div>
          </div>
        )}
      </div>

      {/* Save button */}
      {isModified && (
        <div className="flex justify-end pt-2">
          <Button
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? <><Spinner size="sm" /> Saving...</> : 'Save Changes'}
          </Button>
        </div>
      )}
    </div>
  );
}

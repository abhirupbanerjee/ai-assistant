'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Network, Server, Zap, AlertTriangle, CheckCircle2, XCircle,
  RefreshCw, Shield,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

// ============ Types ============

interface RoutesSettings {
  route1Enabled: boolean;
  route2Enabled: boolean;
  primaryRoute: 'route1' | 'route2';
}

interface RouteHealth {
  route1: { healthy: boolean; latencyMs: number | null; error?: string };
  route2: {
    fireworks: { healthy: boolean; latencyMs: number | null; configured: boolean; error?: string };
    claude: { configured: boolean };
  };
}

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

  const isModified = edited && settings && (
    edited.route1Enabled !== settings.route1Enabled ||
    edited.route2Enabled !== settings.route2Enabled ||
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

  useEffect(() => {
    fetchSettings();
    checkHealth();
  }, [fetchSettings, checkHealth]);

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
  const onlyOneEnabled = edited.route1Enabled !== edited.route2Enabled;

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
                    // If disabling, switch primary to route2
                    if (!enabled && prev.primaryRoute === 'route1') {
                      next.primaryRoute = 'route2';
                    }
                    // Don't allow disabling both
                    if (!enabled && !prev.route2Enabled) return prev;
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
                      next.primaryRoute = 'route1';
                    }
                    if (!enabled && !prev.route1Enabled) return prev;
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

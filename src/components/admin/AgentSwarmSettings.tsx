'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, RotateCcw, CheckCircle, AlertCircle, XCircle, RefreshCw, Users } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface AgentSwarmSettings {
  enabled: boolean;
  model: string;
  maxTokens: number;
  systemPrompt: string;
}

interface MoonshotCapabilities {
  apiKeyValid: boolean;
  balance: number | null;
  modelAvailable: boolean;
  errors: string[];
}

interface SettingsResponse {
  settings: AgentSwarmSettings;
  moonshotConfigured: boolean;
  capabilities: MoonshotCapabilities | null;
}

const DEFAULT_SYSTEM_PROMPT = `You are Kimi K2.6, an advanced AI assistant with agent swarm capabilities. 
You can decompose complex tasks into parallel subtasks and coordinate multiple 
specialized agents to solve problems efficiently. You have access to tools for 
web search, document generation, data visualization, and code execution.

When given a task:
1. Analyze the request and break it into subtasks
2. Use available tools as needed
3. Synthesize results into a clear, actionable response`;

export default function AgentSwarmSettingsTab() {
  const [settings, setSettings] = useState<AgentSwarmSettings | null>(null);
  const [editedSettings, setEditedSettings] = useState<AgentSwarmSettings | null>(null);
  const [isModified, setIsModified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<MoonshotCapabilities | null>(null);
  const [moonshotConfigured, setMoonshotConfigured] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/admin/settings/agent-swarm');
      if (!res.ok) throw new Error('Failed to fetch agent swarm settings');
      const data: SettingsResponse = await res.json();

      setSettings(data.settings);
      setEditedSettings({
        enabled: data.settings.enabled ?? false,
        model: data.settings.model || 'kimi-k2.6',
        maxTokens: data.settings.maxTokens || 32768,
        systemPrompt: data.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      });
      setMoonshotConfigured(data.moonshotConfigured);
      setCapabilities(data.capabilities);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent swarm settings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    if (!editedSettings || !isModified) return;

    try {
      setIsSaving(true);
      const res = await fetch('/api/admin/settings/agent-swarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedSettings),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Failed to save' }));
        throw new Error(errData.error || 'Failed to save agent swarm settings');
      }

      const data = await res.json();
      setSettings(data.settings);
      setIsModified(false);
      // Refresh capabilities after save
      await fetchSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent swarm settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (settings) {
      setEditedSettings({
        enabled: settings.enabled ?? false,
        model: settings.model || 'kimi-k2.6',
        maxTokens: settings.maxTokens || 32768,
        systemPrompt: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      });
      setIsModified(false);
      setError(null);
    }
  };

  const handleTestConnection = async () => {
    try {
      setIsTesting(true);
      const res = await fetch('/api/admin/settings/agent-swarm');
      if (!res.ok) throw new Error('Failed to test connection');
      const data: SettingsResponse = await res.json();
      setMoonshotConfigured(data.moonshotConfigured);
      setCapabilities(data.capabilities);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed');
    } finally {
      setIsTesting(false);
    }
  };

  const updateSetting = <K extends keyof AgentSwarmSettings>(
    key: K,
    value: AgentSwarmSettings[K]
  ) => {
    if (editedSettings) {
      setEditedSettings({ ...editedSettings, [key]: value });
      setIsModified(true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Users size={24} className="text-purple-600" />
              <div>
                <h2 className="font-semibold text-gray-900">Agent Swarm Configuration</h2>
                <p className="text-sm text-gray-500">Configure Kimi K2.6 native agent swarm mode</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isModified && (
                <Button variant="secondary" onClick={handleReset} disabled={isSaving}>
                  <RotateCcw size={16} className="mr-1" />
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
          {/* Connection Status Card */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-gray-900">Moonshot Connection Status</h3>
                <Button
                  variant="secondary"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  loading={isTesting}
                  className="text-sm"
                >
                  <RefreshCw size={14} className="mr-1" />
                  Test Connection
                </Button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {!moonshotConfigured ? (
                <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertCircle size={18} className="text-amber-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Moonshot API key not configured</p>
                    <p className="text-xs text-amber-700 mt-1">
                      Go to <strong>Settings → API Keys</strong> to add your Moonshot API key before enabling agent swarm.
                    </p>
                  </div>
                </div>
              ) : capabilities ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    {capabilities.apiKeyValid ? (
                      <CheckCircle size={18} className="text-emerald-600" />
                    ) : (
                      <XCircle size={18} className="text-red-600" />
                    )}
                    <span className="text-sm text-gray-700">
                      API Key: {capabilities.apiKeyValid ? 'Valid' : 'Invalid'}
                    </span>
                  </div>
                  {capabilities.balance !== null && (
                    <div className="flex items-center gap-3">
                      <CheckCircle size={18} className="text-emerald-600" />
                      <span className="text-sm text-gray-700">
                        Account Balance: ${capabilities.balance.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    {capabilities.modelAvailable ? (
                      <CheckCircle size={18} className="text-emerald-600" />
                    ) : (
                      <XCircle size={18} className="text-red-600" />
                    )}
                    <span className="text-sm text-gray-700">
                      Model {editedSettings.model}: {capabilities.modelAvailable ? 'Available' : 'Not Available'}
                    </span>
                  </div>
                  {capabilities.errors.length > 0 && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-xs font-medium text-red-800 mb-1">Errors:</p>
                      <ul className="text-xs text-red-700 list-disc list-inside">
                        {capabilities.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Click "Test Connection" to verify Moonshot API access.</p>
              )}

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-800">
                  <strong>Note:</strong> Moonshot does not expose a subscription/features API. 
                  Native document creation, slide creation, and image generation are available 
                  on the kimi.com web interface but <strong>not</strong> via the API. The agent swarm 
                  uses standard chat completions with tool calling.
                </p>
              </div>
            </div>
          </div>

          {/* Enable Agent Swarm Toggle */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Enable Agent Swarm Mode</h3>
                  <p className="text-sm text-gray-500">
                    When enabled, admin and superuser users can activate agent swarm mode in chat. 
                    This uses Moonshot Kimi K2.6 native multi-agent orchestration.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={editedSettings.enabled}
                  onClick={() => updateSetting('enabled', !editedSettings.enabled)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                    editedSettings.enabled ? 'bg-purple-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      editedSettings.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {!editedSettings.enabled && (
                <p className="text-xs text-amber-600 mt-2">
                  Agent swarm mode is currently disabled. Users will not see the swarm toggle in chat.
                </p>
              )}
              {editedSettings.enabled && !moonshotConfigured && (
                <p className="text-xs text-red-600 mt-2">
                  Warning: Agent swarm is enabled but Moonshot API key is not configured. 
                  The toggle will appear but requests will fail.
                </p>
              )}
            </div>
          </div>

          {/* Model Configuration */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <h3 className="font-medium text-gray-900">Model Configuration</h3>
              <p className="text-sm text-gray-500">Configure the swarm model and output limits</p>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Model</label>
                <input
                  type="text"
                  value={editedSettings.model}
                  onChange={(e) => updateSetting('model', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="kimi-k2.6"
                />
                <p className="text-xs text-gray-500 mt-1">Recommended: kimi-k2.6</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Max Output Tokens</label>
                <input
                  type="number"
                  min={1024}
                  max={128000}
                  step={1024}
                  value={editedSettings.maxTokens}
                  onChange={(e) => updateSetting('maxTokens', parseInt(e.target.value, 10) || 32768)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {editedSettings.maxTokens >= 16000
                    ? 'Good for long-form outputs'
                    : editedSettings.maxTokens >= 8000
                    ? 'Suitable for most tasks'
                    : 'May truncate complex swarm outputs'}
                </p>
              </div>
            </div>
          </div>

          {/* System Prompt */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">System Prompt</h3>
                  <p className="text-sm text-gray-500">Customize how the swarm coordinator behaves</p>
                </div>
                <button
                  onClick={() => updateSetting('systemPrompt', DEFAULT_SYSTEM_PROMPT)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  <RotateCcw size={12} />
                  Reset to Default
                </button>
              </div>
            </div>
            <div className="p-6">
              <textarea
                value={editedSettings.systemPrompt}
                onChange={(e) => updateSetting('systemPrompt', e.target.value)}
                rows={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                placeholder="Enter custom system prompt for the agent swarm..."
              />
            </div>
          </div>

          {/* Info Card */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <h3 className="font-medium text-gray-900">About Agent Swarm</h3>
            </div>
            <div className="p-6 space-y-3 text-sm text-gray-600">
              <p>
                <strong>Kimi K2.6 Agent Swarm</strong> is Moonshot's native multi-agent orchestration 
                capability. Unlike Policy Bot's application-level autonomous mode (which uses separate 
                planner/executor/checker/summarizer models), the swarm is coordinated entirely by 
                K2.6 internally.
              </p>
              <p>
                <strong>Key differences from Autonomous Mode:</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Single API call to K2.6 — swarm orchestration happens server-side at Moonshot</li>
                <li>Supports up to 300 parallel sub-agents and 4,000 coordinated steps</li>
                <li>Agent activity feedback comes from the model's reasoning_content stream</li>
                <li>Only admin and superuser roles can enable this mode in chat</li>
              </ul>
              <p className="text-xs text-gray-500 mt-2">
                For more details, see the{' '}
                <a
                  href="https://platform.moonshot.ai/docs/guide/use-kimi-k2-thinking-model"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Moonshot K2.6 Documentation
                </a>
                .
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-lg border shadow-sm px-6 py-12 text-center text-gray-500">
          No agent swarm settings available
        </div>
      )}
    </div>
  );
}

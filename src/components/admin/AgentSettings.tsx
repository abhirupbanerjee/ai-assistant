'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Save, RotateCcw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface AgentModelConfig {
  provider: 'openai' | 'gemini' | 'mistral';
  model: string;
  temperature: number;
  max_tokens?: number;
}

interface AgentSettings {
  autonomousModeEnabled: boolean;
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
  summarizerSystemPrompt: string;
  plannerSystemPrompt: string;
  executorSystemPrompt: string;
  checkerSystemPrompt: string;
  hitlEnabled: boolean;
  hitlMinTasks: number;
  hitlTimeoutSeconds: number;
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

/** Role-specific hints for recommended models */
const MODEL_ROLE_HINTS: Record<typeof MODEL_KEYS[number], string> = {
  plannerModel: 'Recommended: claude-sonnet-4-6 (best instruction following) or gemini-2.5-pro (strong reasoning)',
  executorModel: 'Recommended: fireworks/minimax-m2p5 (best agentic quality/cost). Premium: gpt-4.1',
  checkerModel: 'Recommended: gpt-4.1-mini (sufficient for quality evaluation)',
  summarizerModel: 'Recommended: gpt-4.1-mini or same as executor',
};

const DEFAULT_SUMMARIZER_PROMPT = `You are a content consolidation agent. You compile task results into a single, cohesive response that directly answers the user's original request.

Key principles:
- Present the ACTUAL CONTENT and FINDINGS from task results — not commentary about how well the tasks ran
- Structure the output as if YOU are answering the user's original question directly
- Include all data, links, files, and key information from task results
- If tasks produced downloadable files (documents, spreadsheets, images), list them clearly
- Only mention failed/skipped tasks briefly at the end if relevant
- Write as a direct answer, not as a plan execution report

Output your response in markdown format.`;

const DEFAULT_PLANNER_PROMPT = `You are an expert task planner. You break down complex requests into structured, executable task plans.

Before generating the JSON plan, analyze the request step by step:
1. DOMAIN: What domain is this? (policy, security, finance, technology, comparison, architecture, code analysis, etc.)
2. ENTITIES: What specific items/entities are mentioned or implied?
3. SCOPE: Is this per-item (separate outputs) or consolidated (single output)?
4. DATA SOURCE: Is data provided by user, in conversation history, in the knowledge base, or does it need web search?
5. OUTPUTS: What deliverables are expected? (report, chart, presentation, diagram, spreadsheet, etc.)
6. COMPLEXITY: Simple (≤3 tasks) or complex (requires analysis chains)?

Then generate the JSON plan.

Key principles:
- Create clear, specific tasks with measurable outcomes
- Define proper dependencies (no circular references)
- Use explicit tool types (document, image, chart, spreadsheet, presentation, podcast, diagram) when a specific output format is needed — do NOT use "generate" when a tool type applies
- Look for data in BOTH the user message AND recent conversation history
- CRITICAL: Do NOT create search tasks when the user has provided the data in their message. If the user lists items, features, or content, use "extract" to capture it. Web search is ONLY for finding NEW information not in the user's message or conversation history.
- For per-item requests ("for each", "individual", "separate"): create separate tasks per item (up to 50 tasks)
- For consolidated requests: keep plans concise (3-10 tasks)
- For multi-item analysis, always include a synthesize or summarize task at the end
- Include expected_output for each task — a one-line description of what good output looks like
- Ensure logical execution order

Output valid JSON matching the schema provided.`;

const DEFAULT_EXECUTOR_PROMPT = `You are a task execution agent. You complete specific tasks as part of a larger plan.

Key principles:
- Follow the task type and description precisely
- Provide clear, actionable results
- Reference dependent task results when relevant
- Be concise but thorough
- If information is missing, explain what's needed

Output your result directly without JSON formatting.`;

const DEFAULT_CHECKER_PROMPT = 'You are a quality checker. Evaluate task results objectively and provide confidence scores.';

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
        autonomousModeEnabled: data.autonomousModeEnabled ?? true,
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
        summarizerSystemPrompt: data.summarizerSystemPrompt ?? DEFAULT_SUMMARIZER_PROMPT,
        plannerSystemPrompt: data.plannerSystemPrompt ?? DEFAULT_PLANNER_PROMPT,
        executorSystemPrompt: data.executorSystemPrompt ?? DEFAULT_EXECUTOR_PROMPT,
        checkerSystemPrompt: data.checkerSystemPrompt ?? DEFAULT_CHECKER_PROMPT,
        hitlEnabled: data.hitlEnabled ?? true,
        hitlMinTasks: data.hitlMinTasks ?? 5,
        hitlTimeoutSeconds: data.hitlTimeoutSeconds ?? 300,
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
        autonomousModeEnabled: settings.autonomousModeEnabled ?? true,
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
        summarizerSystemPrompt: settings.summarizerSystemPrompt ?? DEFAULT_SUMMARIZER_PROMPT,
        plannerSystemPrompt: settings.plannerSystemPrompt ?? DEFAULT_PLANNER_PROMPT,
        executorSystemPrompt: settings.executorSystemPrompt ?? DEFAULT_EXECUTOR_PROMPT,
        checkerSystemPrompt: settings.checkerSystemPrompt ?? DEFAULT_CHECKER_PROMPT,
        hitlEnabled: settings.hitlEnabled ?? true,
        hitlMinTasks: settings.hitlMinTasks ?? 5,
        hitlTimeoutSeconds: settings.hitlTimeoutSeconds ?? 300,
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
          {/* Autonomous Mode Toggle */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Enable Autonomous Mode</h3>
                  <p className="text-sm text-gray-500">When disabled, users cannot activate autonomous mode in chat. Use this to control token costs.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={editedSettings.autonomousModeEnabled}
                  onClick={() => updateSetting('autonomousModeEnabled', !editedSettings.autonomousModeEnabled)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                    editedSettings.autonomousModeEnabled ? 'bg-purple-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      editedSettings.autonomousModeEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {!editedSettings.autonomousModeEnabled && (
                <p className="text-xs text-amber-600 mt-2">Autonomous mode is currently disabled. Users will see the toggle greyed out with an admin notice.</p>
              )}
            </div>
          </div>

          {/* Plan Approval (HITL) */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <h3 className="font-medium text-gray-900">Plan Approval (HITL)</h3>
              <p className="text-sm text-gray-500">Require human approval before executing autonomous plans</p>
            </div>
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Require plan approval before execution</label>
                  <p className="text-xs text-gray-500 mt-0.5">When enabled, users must approve the task plan before execution begins</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={editedSettings.hitlEnabled}
                  onClick={() => updateSetting('hitlEnabled', !editedSettings.hitlEnabled)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${
                    editedSettings.hitlEnabled ? 'bg-emerald-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      editedSettings.hitlEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Minimum tasks for approval</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={editedSettings.hitlMinTasks}
                    onChange={(e) => updateSetting('hitlMinTasks', parseInt(e.target.value) || 1)}
                    disabled={!editedSettings.hitlEnabled}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:bg-gray-50"
                  />
                  <p className="text-xs text-gray-500 mt-1">Plans with fewer tasks skip approval (1-50)</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Approval timeout (seconds)</label>
                  <input
                    type="number"
                    min={30}
                    max={600}
                    value={editedSettings.hitlTimeoutSeconds}
                    onChange={(e) => updateSetting('hitlTimeoutSeconds', parseInt(e.target.value) || 300)}
                    disabled={!editedSettings.hitlEnabled}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:bg-gray-50"
                  />
                  <p className="text-xs text-gray-500 mt-1">Plans auto-reject if no response within timeout (30-600)</p>
                </div>
              </div>
            </div>
          </div>

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
                        <span className="text-xs text-blue-500 mt-0.5 block">
                          {MODEL_ROLE_HINTS[modelKey]}
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
                          className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm ${
                            (currentModel.max_tokens || 0) > 32000 ? 'border-amber-400 bg-amber-50' : 'border-gray-300'
                          }`}
                        />
                        {(currentModel.max_tokens || 0) > 32000 && (
                          <span className="text-xs text-amber-600 mt-1 block">
                            Will be capped to 32,000 at runtime
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Planner System Prompt */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Planner System Prompt</h3>
                  <p className="text-sm text-gray-500">Customize how the agent breaks down requests into task plans</p>
                </div>
                <button
                  onClick={() => {
                    if (editedSettings) {
                      setEditedSettings({ ...editedSettings, plannerSystemPrompt: DEFAULT_PLANNER_PROMPT });
                      setIsModified(true);
                    }
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  <RotateCcw size={12} />
                  Reset to Default
                </button>
              </div>
            </div>
            <div className="p-6">
              <textarea
                value={editedSettings.plannerSystemPrompt}
                onChange={(e) => updateSetting('plannerSystemPrompt', e.target.value)}
                rows={12}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                placeholder="Enter custom system prompt for the planner agent..."
              />
            </div>
          </div>

          {/* Summarizer System Prompt */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Summarizer System Prompt</h3>
                  <p className="text-sm text-gray-500">Customize how the agent consolidates task results into a final response</p>
                </div>
                <button
                  onClick={() => {
                    if (editedSettings) {
                      setEditedSettings({ ...editedSettings, summarizerSystemPrompt: DEFAULT_SUMMARIZER_PROMPT });
                      setIsModified(true);
                    }
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  <RotateCcw size={12} />
                  Reset to Default
                </button>
              </div>
            </div>
            <div className="p-6">
              <textarea
                value={editedSettings.summarizerSystemPrompt}
                onChange={(e) => updateSetting('summarizerSystemPrompt', e.target.value)}
                rows={8}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                placeholder="Enter custom system prompt for the summarizer agent..."
              />
            </div>
          </div>

          {/* Executor System Prompt */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Executor System Prompt</h3>
                  <p className="text-sm text-gray-500">Customize how the agent executes individual tasks</p>
                </div>
                <button
                  onClick={() => {
                    if (editedSettings) {
                      setEditedSettings({ ...editedSettings, executorSystemPrompt: DEFAULT_EXECUTOR_PROMPT });
                      setIsModified(true);
                    }
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  <RotateCcw size={12} />
                  Reset to Default
                </button>
              </div>
            </div>
            <div className="p-6">
              <textarea
                value={editedSettings.executorSystemPrompt}
                onChange={(e) => updateSetting('executorSystemPrompt', e.target.value)}
                rows={8}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                placeholder="Enter custom system prompt for the executor agent..."
              />
            </div>
          </div>

          {/* Checker System Prompt */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Checker System Prompt</h3>
                  <p className="text-sm text-gray-500">Customize how the agent evaluates task quality</p>
                </div>
                <button
                  onClick={() => {
                    if (editedSettings) {
                      setEditedSettings({ ...editedSettings, checkerSystemPrompt: DEFAULT_CHECKER_PROMPT });
                      setIsModified(true);
                    }
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  <RotateCcw size={12} />
                  Reset to Default
                </button>
              </div>
            </div>
            <div className="p-6">
              <textarea
                value={editedSettings.checkerSystemPrompt}
                onChange={(e) => updateSetting('checkerSystemPrompt', e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                placeholder="Enter custom system prompt for the checker agent..."
              />
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

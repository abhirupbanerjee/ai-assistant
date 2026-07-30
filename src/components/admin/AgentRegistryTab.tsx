'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Power,
  PowerOff,
  AlertCircle,
  CheckCircle,
  Save,
  X,
  Users,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import type { ModelRequirements } from '@/lib/tools';

// ============ Types ============

type RoleFamily = 'planner' | 'executor' | 'critic' | 'researcher' | 'presenter';
type CapabilityTier = 'swarm_full' | 'swarm_limited' | 'unclassified';

interface AgentRecord {
  id: string;
  name: string;
  roleFamily: RoleFamily;
  categoryId: number | null;
  modelId: string | null;
  systemPrompt: string;
  toolAllowlist: string[];
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Category {
  id: number;
  name: string;
  slug: string;
}

interface EnabledModel {
  id: string;
  displayName: string;
  capabilityTier: CapabilityTier;
  enabled: boolean;
}

interface ToolMeta {
  name: string;
  displayName: string;
  enabled: boolean;
  group: string | null;
  subagentSafe: boolean | null;
  modelRequirements: ModelRequirements | null;
}

interface AgentFormData {
  id: string;
  name: string;
  roleFamily: RoleFamily;
  categoryId: number | null;
  modelId: string | null;
  systemPrompt: string;
  toolAllowlist: string[];
  enabled: boolean;
}

const ROLE_OPTIONS: { value: RoleFamily; label: string; description: string }[] = [
  { value: 'planner', label: 'Planner', description: 'Decomposes tasks into a DAG of steps' },
  { value: 'executor', label: 'Executor', description: 'Runs individual steps and produces artifacts' },
  { value: 'critic', label: 'Critic', description: 'Reviews executor output for quality gates' },
  { value: 'researcher', label: 'Researcher', description: 'Gathers context, facts, and sources' },
  { value: 'presenter', label: 'Presenter', description: 'Formats final deliverables for the user' },
];

const TIER_LABELS: Record<CapabilityTier, string> = {
  swarm_full: 'Swarm Full (any role)',
  swarm_limited: 'Swarm Limited (executor/researcher/presenter)',
  unclassified: 'Unclassified (swarm-ineligible)',
};

const TIER_COLORS: Record<CapabilityTier, string> = {
  swarm_full: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  swarm_limited: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  unclassified: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

function emptyForm(): AgentFormData {
  return {
    id: '',
    name: '',
    roleFamily: 'executor',
    categoryId: null,
    modelId: null,
    systemPrompt: '',
    toolAllowlist: [],
    enabled: true,
  };
}

function formFromAgent(agent: AgentRecord): AgentFormData {
  return {
    id: agent.id,
    name: agent.name,
    roleFamily: agent.roleFamily,
    categoryId: agent.categoryId,
    modelId: agent.modelId,
    systemPrompt: agent.systemPrompt,
    toolAllowlist: [...agent.toolAllowlist],
    enabled: agent.enabled,
  };
}

// ============ Component ============

export default function AgentRegistryTab() {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [models, setModels] = useState<EnabledModel[]>([]);
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<AgentFormData>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AgentRecord | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/agents');
      if (!res.ok) throw new Error('Failed to load agents');
      const data = await res.json();
      setAgents(data.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  const loadMetadata = useCallback(async () => {
    try {
      const [catRes, modelRes, toolRes] = await Promise.all([
        fetch('/api/admin/categories'),
        fetch('/api/admin/llm/models'),
        fetch('/api/admin/tools'),
      ]);
      if (catRes.ok) {
        const catData = await catRes.json();
        setCategories(catData.categories ?? []);
      }
      if (modelRes.ok) {
        const modelData = await modelRes.json();
        setModels(modelData.models ?? []);
      }
      if (toolRes.ok) {
        const toolData = await toolRes.json();
        setTools(toolData.tools ?? []);
      }
    } catch {
      // Non-fatal — the forms still work without these
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      await Promise.all([loadAgents(), loadMetadata()]);
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [loadAgents, loadMetadata]);

  // Auto-dismiss success banner
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(t);
    }
  }, [success]);

  function openCreate() {
    setForm(emptyForm());
    setEditing(false);
    setModalOpen(true);
  }

  function openEdit(agent: AgentRecord) {
    setForm(formFromAgent(agent));
    setEditing(true);
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.id.trim() || !form.name.trim()) {
      setError('Agent ID and name are required');
      return;
    }
    // Agent ids become OpenAI function tool names (`agent__<id>`), so they must
    // match the function-name charset and stay within the length budget.
    const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
    const AGENT_ID_MAX_LENGTH = 57;
    if (!editing && (!AGENT_ID_PATTERN.test(form.id.trim()) || form.id.trim().length > AGENT_ID_MAX_LENGTH)) {
      setError(
        `Agent ID must contain only letters, numbers, hyphens, and underscores (max ${AGENT_ID_MAX_LENGTH} chars). It is used to build the agent__<id> tool name.`
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        roleFamily: form.roleFamily,
        categoryId: form.categoryId,
        modelId: form.modelId,
        systemPrompt: form.systemPrompt,
        toolAllowlist: form.toolAllowlist,
        enabled: form.enabled,
      };

      const url = editing
        ? `/api/admin/agents/${encodeURIComponent(form.id)}`
        : '/api/admin/agents';
      const method = editing ? 'PUT' : 'POST';

      const body = editing
        ? payload
        : { id: form.id.trim(), ...payload };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const result = await res.json();
      let msg = editing ? 'Agent updated' : 'Agent created';
      if (result.warnings && result.warnings.length > 0) {
        msg += ` (${result.warnings.length} warning${result.warnings.length > 1 ? 's' : ''})`;
      }
      setSuccess(msg);
      setModalOpen(false);
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled(agent: AgentRecord) {
    try {
      const res = await fetch(`/api/admin/agents/${encodeURIComponent(agent.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !agent.enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSuccess(`Agent ${agent.name} ${agent.enabled ? 'disabled' : 'enabled'}`);
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle agent');
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/agents/${encodeURIComponent(deleteTarget.id)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSuccess(`Agent ${deleteTarget.name} deleted`);
      setDeleteTarget(null);
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
    } finally {
      setSaving(false);
    }
  }

  const modelById = new Map(models.map((m) => [m.id, m]));

  // ============ Render ============

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="w-5 h-5" />
            Agent Registry
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage registered agents, their role families, bound models, and capability tiers.
            Template agents (category: Global) apply to all categories.
          </p>
        </div>
        <Button onClick={openCreate} variant="primary" size="sm">
          <Plus className="w-4 h-4 mr-1" />
          New Agent
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-sm">
          <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {agents.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          No agents registered yet. Click &ldquo;New Agent&rdquo; to create one.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Model</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Capability</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
              {agents.map((agent) => {
                const model = agent.modelId ? modelById.get(agent.modelId) : null;
                const category = agent.categoryId
                  ? categories.find((c) => c.id === agent.categoryId)
                  : null;
                return (
                  <tr key={agent.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{agent.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{agent.id}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 capitalize">
                        {agent.roleFamily}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {category ? category.name : <span className="italic text-purple-600 dark:text-purple-400">Global</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {model ? model.displayName : <span className="italic text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {model ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${TIER_COLORS[model.capabilityTier]}`}>
                          {model.capabilityTier}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {agent.enabled ? (
                        <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 text-xs">
                          <CheckCircle className="w-3.5 h-3.5" /> Enabled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-gray-400 text-xs">
                          <X className="w-3.5 h-3.5" /> Disabled
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => handleToggleEnabled(agent)}
                          title={agent.enabled ? 'Disable' : 'Enable'}
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                        >
                          {agent.enabled ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => openEdit(agent)}
                          title="Edit"
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(agent)}
                          title="Delete"
                          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Agent' : 'New Agent'}
      >
        <div className="space-y-4">
          {/* ID (only editable on create) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Agent ID
            </label>
            <input
              type="text"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              disabled={editing}
              placeholder="e.g. my-planner"
              pattern="^[a-zA-Z0-9_-]+$"
              maxLength={57}
              title="Letters, numbers, hyphens, and underscores only (max 57 chars)"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-60 font-mono"
            />
            <p className="text-xs text-gray-500 mt-1">
              Unique identifier (letters, numbers, hyphens, underscores; max 57 chars). Cannot be changed after creation.
            </p>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Research Planner"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>

          {/* Role Family */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Role Family
            </label>
            <select
              value={form.roleFamily}
              onChange={(e) => setForm({ ...form, roleFamily: e.target.value as RoleFamily })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} — {opt.description}
                </option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Category
            </label>
            <select
              value={form.categoryId ?? ''}
              onChange={(e) =>
                setForm({ ...form, categoryId: e.target.value ? parseInt(e.target.value, 10) : null })
              }
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              <option value="">Global (all categories)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Model + Capability Tier */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Bound Model
            </label>
            <select
              value={form.modelId ?? ''}
              onChange={(e) => setForm({ ...form, modelId: e.target.value || null })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              <option value="">None (use default)</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} — {TIER_LABELS[m.capabilityTier]}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Capability tier determines which swarm roles the model may fill.
              <strong className="font-semibold"> swarm_full</strong> = any role,
              <strong className="font-semibold"> swarm_limited</strong> = executor/researcher/presenter only,
              <strong className="font-semibold"> unclassified</strong> = swarm-ineligible.
            </p>
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              System Prompt
            </label>
            <textarea
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              rows={5}
              placeholder="Define the agent's persona, instructions, and output format…"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
            />
          </div>

          {/* Tool Allowlist */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Tool Allowlist
            </label>
            {tools.length === 0 ? (
              <p className="text-xs text-gray-400 italic">Loading tools…</p>
            ) : (
              <div className="border border-gray-300 dark:border-gray-600 rounded-md max-h-64 overflow-y-auto bg-white dark:bg-gray-800">
                {(() => {
                  const allowSet = new Set(form.toolAllowlist);
                  const groupOrder = ['tavily', 'kb', 'generative', 'data', 'utility', 'mcp'];
                  const grouped = new Map<string | 'Other', ToolMeta[]>();
                  for (const t of tools) {
                    const g = t.group && groupOrder.includes(t.group) ? t.group : 'Other';
                    if (!grouped.has(g)) grouped.set(g, []);
                    grouped.get(g)!.push(t);
                  }
                  const orderedGroups = [
                    ...groupOrder.filter((g) => grouped.has(g)),
                    ...(grouped.has('Other') ? ['Other' as const] : []),
                  ];

                  const toggleTool = (name: string) => {
                    const next = allowSet.has(name)
                      ? form.toolAllowlist.filter((t) => t !== name)
                      : [...form.toolAllowlist, name];
                    setForm({ ...form, toolAllowlist: next });
                  };

                  const reqLabel = (reqs: ModelRequirements | null) => {
                    if (!reqs) return null;
                    const badges: string[] = [];
                    if (reqs.minimumContextTokens) badges.push(`needs ${reqs.minimumContextTokens}`);
                    if (reqs.prefersCodeQuality) badges.push('code-quality');
                    if (reqs.prefersInstructionFollowing) badges.push('instr-follow');
                    if (reqs.prefersLargeContext) badges.push('large-ctx');
                    if (badges.length === 0) return null;
                    return badges.map((b) => (
                      <span key={b} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                        {b}
                      </span>
                    ));
                  };

                  return orderedGroups.map((group) => {
                    const groupTools = grouped.get(group)!;
                    const selectedCount = groupTools.filter((t) => allowSet.has(t.name)).length;
                    return (
                      <div key={group}>
                        <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between border-b border-gray-200 dark:border-gray-700">
                          <span>{group}</span>
                          <span className="font-normal normal-case">{selectedCount}/{groupTools.length}</span>
                        </div>
                        {groupTools.map((tool) => {
                          const checked = allowSet.has(tool.name);
                          const disabled = !tool.enabled;
                          return (
                            <label
                              key={tool.name}
                              className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700/50 last:border-b-0 ${
                                disabled ? 'opacity-50 cursor-not-allowed' : ''
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={disabled}
                                onChange={() => toggleTool(tool.name)}
                                className="rounded border-gray-300 dark:border-gray-600 flex-shrink-0"
                              />
                              <span className="flex-1 text-gray-800 dark:text-gray-200">{tool.displayName}</span>
                              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono flex-shrink-0">{tool.name}</span>
                              {tool.subagentSafe === true && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 flex-shrink-0">
                                  subagent-safe
                                </span>
                              )}
                              {tool.subagentSafe === false && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 flex-shrink-0">
                                  heavy
                                </span>
                              )}
                              {tool.subagentSafe === null && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 flex-shrink-0">
                                  —
                                </span>
                              )}
                              {tool.modelRequirements && (
                                <span className="flex items-center gap-0.5 flex-shrink-0">{reqLabel(tool.modelRequirements)}</span>
                              )}
                              {disabled && <span className="text-[10px] text-gray-400 italic flex-shrink-0">(disabled)</span>}
                            </label>
                          );
                        })}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-1">
              {form.toolAllowlist.length === 0
                ? 'No tools selected — agent will have no static tools available.'
                : `${form.toolAllowlist.length} tool${form.toolAllowlist.length !== 1 ? 's' : ''} selected.`}
            </p>
            {form.toolAllowlist.some((t) => {
              const meta = tools.find((tm) => tm.name === t);
              return meta?.subagentSafe === false;
            }) && !form.modelId && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Heavy tools selected without a bound model. Consider binding a capable model.
              </p>
            )}
            {(() => {
              const selectedTools = form.toolAllowlist
                .map((t) => tools.find((tm) => tm.name === t))
                .filter(Boolean) as ToolMeta[];
              const hasLargeContext = selectedTools.some(
                (t) => t.modelRequirements && (t.modelRequirements.minimumContextTokens || t.modelRequirements.prefersLargeContext)
              );
              const needsInstruction = selectedTools.some(
                (t) => t.modelRequirements && t.modelRequirements.prefersInstructionFollowing
              );
              if ((hasLargeContext || needsInstruction) && !form.modelId) {
                const notes: string[] = [];
                if (hasLargeContext) notes.push('large context window');
                if (needsInstruction) notes.push('strong instruction following');
                return (
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Selected tools require {notes.join(' + ')}. Consider binding a specific model rather than using the category default.
                  </p>
                );
              }
              return null;
            })()}
          </div>

          {/* Enabled toggle */}
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            Enabled
          </label>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Spinner size="sm" /> : <Save className="w-4 h-4 mr-1" />}
              {editing ? 'Save Changes' : 'Create Agent'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Agent"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>{' '}
            (<code className="text-xs">{deleteTarget?.id}</code>)? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleDelete} disabled={saving}>
              {saving ? <Spinner size="sm" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

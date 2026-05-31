'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Image,
  BarChart3,
  Workflow,
  FileText,
  Code,
  Presentation,
  Sheet,
  Save,
  RotateCcw,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  CheckCircle,
  type LucideIcon,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import type { SlashCommandConfig } from '@/types/slash-commands';

const ICON_MAP: Record<string, LucideIcon> = {
  Image,
  BarChart3,
  Workflow,
  FileText,
  Code,
  Presentation,
  Sheet,
};

const AVAILABLE_ICONS = ['Image', 'BarChart3', 'Workflow', 'FileText', 'Code', 'Presentation', 'Sheet'];

interface CommandWithToolStatus extends SlashCommandConfig {
  toolEnabled: boolean;
}

export default function SlashCommandsTab() {
  const [commands, setCommands] = useState<CommandWithToolStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingCommand, setEditingCommand] = useState<CommandWithToolStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);

  const fetchCommands = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/slash-commands');
      if (!response.ok) throw new Error('Failed to fetch commands');
      const data = await response.json();
      setCommands(data.commands || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load commands');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCommands();
  }, [fetchCommands]);

  const handleSave = async (commandKey: string, updates: {
    label: string;
    description: string;
    aliases: string;
    hint: string;
    icon: string;
    enabled: boolean;
    sortOrder: number;
  }) => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    // Validate aliases
    const aliasList = updates.aliases.split(',').map((a) => a.trim()).filter(Boolean);
    const invalidAlias = aliasList.find((a) => !/^[a-z0-9_-]+$/.test(a));
    if (invalidAlias) {
      setError(`Invalid alias: '${invalidAlias}'. Use only lowercase letters, numbers, underscores, and hyphens.`);
      setSaving(false);
      return;
    }

    try {
      const response = await fetch(`/api/admin/slash-commands/${commandKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: updates.label,
          description: updates.description,
          aliases: aliasList,
          hint: updates.hint,
          icon: updates.icon,
          enabled: updates.enabled,
          sortOrder: updates.sortOrder,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save command');
      }

      setSuccess(`/${commandKey} updated successfully`);
      setEditingCommand(null);
      await fetchCommands();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save command');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/slash-commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });

      if (!response.ok) throw new Error('Failed to reset commands');

      setSuccess('All commands reset to defaults');
      setShowResetModal(false);
      await fetchCommands();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset commands');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Slash Commands Registry</h2>
          <p className="text-sm text-gray-500 mt-1">
            Configure the slash commands available in the chat input. Users type <code className="bg-gray-100 px-1 rounded">/</code> followed by a command to trigger creative tools.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => setShowResetModal(true)}
          disabled={saving}
          className="flex items-center gap-2"
        >
          <RotateCcw size={16} />
          Reset to Defaults
        </Button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-red-700">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3 text-green-700">
          <CheckCircle size={18} />
          <span>{success}</span>
        </div>
      )}

      {/* Command Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {commands.map((cmd) => {
          const Icon = ICON_MAP[cmd.icon] || FileText;
          return (
            <div
              key={cmd.commandKey}
              className={`bg-white rounded-lg border shadow-sm overflow-hidden ${
                !cmd.enabled ? 'opacity-60' : ''
              }`}
            >
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-100 rounded-lg">
                      <Icon size={20} className="text-gray-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">/{cmd.commandKey}</h3>
                      <p className="text-xs text-gray-500">{cmd.label}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingCommand(cmd)}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Edit
                  </button>
                </div>

                <p className="text-sm text-gray-600 mb-3">{cmd.description}</p>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 w-16">Tool:</span>
                    <span className="font-mono text-gray-700">{cmd.toolName}</span>
                    {!cmd.toolEnabled && (
                      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px]">
                        Tool disabled
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 w-16">Aliases:</span>
                    <span className="text-gray-700">{cmd.aliases.join(', ')}</span>
                  </div>
                  {cmd.formatHint && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 w-16">Format:</span>
                      <span className="font-mono text-gray-700">{cmd.formatHint}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 w-16">Status:</span>
                    {cmd.enabled ? (
                      <span className="flex items-center gap-1 text-green-700">
                        <ToggleRight size={14} /> Enabled
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-gray-500">
                        <ToggleLeft size={14} /> Disabled
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Modal */}
      {editingCommand && (
        <Modal
          isOpen={!!editingCommand}
          onClose={() => setEditingCommand(null)}
          title={`Edit /${editingCommand.commandKey}`}
        >
          <EditCommandForm
            command={editingCommand}
            onSave={handleSave}
            onCancel={() => setEditingCommand(null)}
            saving={saving}
          />
        </Modal>
      )}

      {/* Reset Confirmation Modal */}
      {showResetModal && (
        <Modal
          isOpen={showResetModal}
          onClose={() => setShowResetModal(false)}
          title="Reset to Defaults"
        >
          <div className="space-y-4">
            <p className="text-gray-700">
              This will reset all slash commands to their default settings. Any customizations you have made will be lost.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowResetModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleReset} disabled={saving} className="bg-red-600 hover:bg-red-700 text-white">
                {saving ? <Spinner size="sm" /> : 'Reset All'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EditCommandForm({
  command,
  onSave,
  onCancel,
  saving,
}: {
  command: CommandWithToolStatus;
  onSave: (commandKey: string, updates: {
    label: string;
    description: string;
    aliases: string;
    hint: string;
    icon: string;
    enabled: boolean;
    sortOrder: number;
  }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [label, setLabel] = useState(command.label);
  const [description, setDescription] = useState(command.description);
  const [aliases, setAliases] = useState(command.aliases.join(', '));
  const [hint, setHint] = useState(command.hint);
  const [icon, setIcon] = useState(command.icon);
  const [enabled, setEnabled] = useState(command.enabled);
  const [sortOrder, setSortOrder] = useState(command.sortOrder);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(command.commandKey, { label, description, aliases, hint, icon, enabled, sortOrder });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Command Key</label>
          <input
            type="text"
            value={command.commandKey}
            disabled
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tool Name</label>
          <input
            type="text"
            value={command.toolName}
            disabled
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Aliases <span className="text-gray-400 font-normal">(comma-separated)</span>
        </label>
        <input
          type="text"
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt Hint</label>
        <textarea
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          required
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Icon</label>
          <select
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
          >
            {AVAILABLE_ICONS.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
          />
        </div>
      </div>

      {command.formatHint && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Format Hint</label>
          <input
            type="text"
            value={command.formatHint}
            disabled
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">Format hint is read-only.</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          disabled={!command.toolEnabled}
          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
        />
        <label htmlFor="enabled" className="text-sm text-gray-700">
          Enabled
          {!command.toolEnabled && (
            <span className="text-amber-600 ml-2">(Cannot enable — underlying tool is disabled)</span>
          )}
        </label>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving} className="flex items-center gap-2">
          {saving ? <Spinner size="sm" /> : <Save size={16} />}
          Save Changes
        </Button>
      </div>
    </form>
  );
}

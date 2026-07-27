'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Server,
  Plus,
  Trash2,
  RefreshCw,
  TestTube,
  AlertCircle,
  CheckCircle,
  PowerOff,
  Power,
  X,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';

interface McpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  timeoutMs: number;
  hasAuthToken: boolean;
  toolCount: number;
  healthStatus: string;
  lastHealthCheck: string | null;
  createdAt: string;
  updatedAt: string;
}

interface McpServerFormData {
  id: string;
  name: string;
  url: string;
  authToken: string;
  timeoutMs: number;
  enabled: boolean;
}

const initialForm: McpServerFormData = {
  id: '',
  name: '',
  url: '',
  authToken: '',
  timeoutMs: 30000,
  enabled: true,
};

export default function McpServersTab() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mcpEnabled, setMcpEnabled] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);
  const [form, setForm] = useState<McpServerFormData>(initialForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionServerId, setActionServerId] = useState<string | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState<'enable' | 'disable'>('disable');

  const fetchServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/mcp/servers');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load MCP servers');
      }
      const data = await res.json();
      setServers(data.servers || []);
      setMcpEnabled(data.mcpEnabled ?? true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP servers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const openCreate = () => {
    setEditingServer(null);
    setForm(initialForm);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEdit = (server: McpServer) => {
    setEditingServer(server);
    setForm({
      id: server.id,
      name: server.name,
      url: server.url,
      authToken: '',
      timeoutMs: server.timeoutMs,
      enabled: server.enabled,
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingServer(null);
    setForm(initialForm);
    setFormError(null);
  };

  const validateForm = (): boolean => {
    if (!form.name.trim()) {
      setFormError('Name is required');
      return false;
    }
    if (!form.url.trim()) {
      setFormError('URL is required');
      return false;
    }
    try {
      const parsed = new URL(form.url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setFormError('URL must use http:// or https://');
        return false;
      }
    } catch {
      setFormError('URL must be valid');
      return false;
    }
    if (form.timeoutMs < 1000 || form.timeoutMs > 300000) {
      setFormError('Timeout must be between 1,000ms and 300,000ms');
      return false;
    }
    return true;
  };

  const saveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSaving(true);
    setFormError(null);

    try {
      const url = editingServer
        ? `/api/admin/mcp/servers/${editingServer.id}`
        : '/api/admin/mcp/servers';
      const method = editingServer ? 'PATCH' : 'POST';
      const body: Record<string, unknown> = {
        name: form.name,
        url: form.url,
        timeoutMs: form.timeoutMs,
        enabled: form.enabled,
      };
      if (!editingServer) body.id = form.id || undefined;
      if (form.authToken) body.authToken = form.authToken;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save server');
      }

      closeModal();
      await fetchServers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save server');
    } finally {
      setSaving(false);
    }
  };

  const deleteServer = async (id: string) => {
    if (!confirm('Are you sure you want to delete this MCP server? Its discovered tools will also be removed.')) return;

    setActionServerId(id);
    try {
      const res = await fetch(`/api/admin/mcp/servers/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete server');
      }
      await fetchServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete server');
    } finally {
      setActionServerId(null);
    }
  };

  const testServer = async (id: string) => {
    setActionServerId(id);
    try {
      const res = await fetch(`/api/admin/mcp/servers/${id}/test`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Test failed');
      }
      alert(`Connection ${data.status}${data.error ? `: ${data.error}` : ` (${data.toolCount} tools)`}`);
      await fetchServers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setActionServerId(null);
    }
  };

  const refreshServer = async (id: string) => {
    setActionServerId(id);
    try {
      const res = await fetch(`/api/admin/mcp/servers/${id}/refresh`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Refresh failed');
      }
      await fetchServers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setActionServerId(null);
    }
  };

  const toggleServerEnabled = async (server: McpServer) => {
    setActionServerId(server.id);
    try {
      const res = await fetch(`/api/admin/mcp/servers/${server.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update server');
      }
      await fetchServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update server');
    } finally {
      setActionServerId(null);
    }
  };

  const bulkToggle = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/mcp/servers/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: bulkAction === 'enable' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Bulk update failed');
      }
      setBulkConfirmOpen(false);
      await fetchServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk update failed');
    } finally {
      setSaving(false);
    }
  };

  const statusIcon = (status: string) => {
    if (status === 'connected') return <CheckCircle size={18} className="text-green-500" />;
    if (status === 'error') return <AlertCircle size={18} className="text-red-500" />;
    return <PowerOff size={18} className="text-gray-400" />;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!mcpEnabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="text-amber-600 mt-0.5 shrink-0" size={20} />
          <div>
            <h4 className="font-medium text-amber-800">MCP is globally disabled</h4>
            <p className="text-sm text-amber-700">
              MCP is disabled via the <code className="bg-amber-100 px-1 rounded">MCP_ENABLED</code> environment variable.
              Servers are still listed, but no tools will be discovered or executed until MCP is enabled and the process is restarted.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">MCP Servers</h3>
          <p className="text-sm text-gray-500">
            {servers.length} server{servers.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <div className="flex items-center gap-3">
          {servers.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => {
                setBulkAction('disable');
                setBulkConfirmOpen(true);
              }}
              className="flex items-center gap-2"
            >
              <PowerOff size={16} />
              Disable All
            </Button>
          )}
          <Button onClick={openCreate} className="flex items-center gap-2">
            <Plus size={16} />
            Add Server
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="text-red-600 mt-0.5 shrink-0" size={20} />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {servers.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <Server size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No MCP servers configured</h3>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Add an MCP server to expose its tools alongside the built-in tools. The server must implement the MCP HTTP+SSE transport.
          </p>
          <Button onClick={openCreate} className="flex items-center gap-2 mx-auto">
            <Plus size={16} />
            Add Your First MCP Server
          </Button>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Server</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tools</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timeout</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {servers.map((server) => (
                <tr key={server.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Server size={18} className="text-purple-500" />
                      <div>
                        <button
                          onClick={() => openEdit(server)}
                          className="text-sm font-medium text-gray-900 hover:text-blue-600 text-left"
                        >
                          {server.name}
                        </button>
                        <p className="text-xs text-gray-500 font-mono truncate max-w-[240px]">{server.url}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {statusIcon(server.healthStatus)}
                      <span className="text-sm text-gray-700 capitalize">{server.healthStatus}</span>
                      {server.lastHealthCheck && (
                        <span className="text-xs text-gray-400">
                          {new Date(server.lastHealthCheck).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{server.toolCount}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{server.timeoutMs}ms</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => toggleServerEnabled(server)}
                        disabled={actionServerId === server.id}
                        className={`p-2 rounded-lg transition-colors ${
                          server.enabled
                            ? 'text-green-600 hover:bg-green-50'
                            : 'text-gray-400 hover:bg-gray-100'
                        }`}
                        title={server.enabled ? 'Disable server' : 'Enable server'}
                      >
                        {server.enabled ? <Power size={18} /> : <PowerOff size={18} />}
                      </button>
                      <button
                        onClick={() => testServer(server.id)}
                        disabled={actionServerId === server.id}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Test connection"
                      >
                        <TestTube size={18} />
                      </button>
                      <button
                        onClick={() => refreshServer(server.id)}
                        disabled={actionServerId === server.id || !server.enabled}
                        className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-40"
                        title="Refresh tools"
                      >
                        <RefreshCw size={18} className={actionServerId === server.id ? 'animate-spin' : ''} />
                      </button>
                      <button
                        onClick={() => openEdit(server)}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Edit server"
                      >
                        <Server size={18} />
                      </button>
                      <button
                        onClick={() => deleteServer(server.id)}
                        disabled={actionServerId === server.id}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete server"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={closeModal} title={editingServer ? 'Edit MCP Server' : 'Add MCP Server'}>
        <form onSubmit={saveServer} className="space-y-4">
          {formError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle size={16} className="text-red-600 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700">{formError}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Server ID</label>
            <input
              type="text"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              disabled={!!editingServer}
              placeholder="e.g. jira-prod"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
            <p className="text-xs text-gray-500 mt-1">Lowercase letters, numbers, and hyphens only.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Jira Production"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
            <input
              type="url"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://mcp.example.com/jira"
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Auth Token</label>
            <input
              type="password"
              value={form.authToken}
              onChange={(e) => setForm({ ...form, authToken: e.target.value })}
              placeholder={editingServer?.hasAuthToken ? '•••••••• (leave blank to keep)' : 'Optional bearer token'}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timeout (ms)</label>
            <input
              type="number"
              min={1000}
              max={300000}
              step={1000}
              value={form.timeoutMs}
              onChange={(e) => setForm({ ...form, timeoutMs: parseInt(e.target.value) || 30000 })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enabled"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="enabled" className="text-sm font-medium text-gray-700">Enabled</label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={closeModal} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner size="sm" /> : editingServer ? 'Save Changes' : 'Add Server'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={bulkConfirmOpen}
        onClose={() => setBulkConfirmOpen(false)}
        title={bulkAction === 'disable' ? 'Disable All MCP Servers?' : 'Enable All MCP Servers?'}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            {bulkAction === 'disable'
              ? 'This will disable all configured MCP servers. MCP tools will no longer be available to the LLM until servers are re-enabled.'
              : 'This will enable all configured MCP servers.'}
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setBulkConfirmOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={bulkToggle}
              disabled={saving}
              className={bulkAction === 'disable' ? 'bg-red-600 hover:bg-red-700' : ''}
            >
              {saving ? <Spinner size="sm" /> : bulkAction === 'disable' ? 'Disable All' : 'Enable All'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

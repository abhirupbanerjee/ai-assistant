'use client';

/**
 * Agent Bots Management
 *
 * Admin UI for managing agent bots - API-accessible bots with
 * authentication, defined inputs/outputs, and skill-based processing.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Power,
  PowerOff,
  AlertCircle,
  Search,
  Bot,
  Key,
  BarChart3,
  Settings,
  ChevronRight,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';

interface AgentBot {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  created_by: string;
  created_by_role: 'admin' | 'superuser';
  created_at: string;
  updated_at: string;
  version_count?: number;
  default_version_label?: string;
}

interface AgentBotFormData {
  name: string;
  slug: string;
  description: string;
}

const initialFormData: AgentBotFormData = {
  name: '',
  slug: '',
  description: '',
};

interface AgentBotsManagementProps {
  onSelectBot?: (bot: AgentBot) => void;
}

export default function AgentBotsManagement({ onSelectBot }: AgentBotsManagementProps) {
  const [agentBots, setAgentBots] = useState<AgentBot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedBot, setSelectedBot] = useState<AgentBot | null>(null);
  const [formData, setFormData] = useState<AgentBotFormData>(initialFormData);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Generate slug from name
  const generateSlug = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
  };

  // Load agent bots
  const loadAgentBots = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/admin/agent-bots');
      if (!response.ok) throw new Error('Failed to load agent bots');
      const data = await response.json();
      setAgentBots(data.agentBots || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent bots');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgentBots();
  }, [loadAgentBots]);

  // Filter bots by search query
  const filteredBots = agentBots.filter(
    (bot) =>
      bot.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bot.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (bot.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Handle create bot
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/agent-bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          slug: formData.slug.trim() || undefined,
          description: formData.description.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create agent bot');
      }

      await loadAgentBots();
      setShowCreateModal(false);
      setFormData(initialFormData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent bot');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle edit bot
  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBot || !formData.name.trim()) return;

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/agent-bots/${selectedBot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          slug: formData.slug.trim() || undefined,
          description: formData.description.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update agent bot');
      }

      await loadAgentBots();
      setShowEditModal(false);
      setSelectedBot(null);
      setFormData(initialFormData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update agent bot');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle delete bot
  const handleDelete = async () => {
    if (!selectedBot) return;

    setIsDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/agent-bots/${selectedBot.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete agent bot');
      }

      await loadAgentBots();
      setShowDeleteModal(false);
      setSelectedBot(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent bot');
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle toggle active status
  const handleToggleActive = async (bot: AgentBot) => {
    try {
      const response = await fetch(`/api/admin/agent-bots/${bot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !bot.is_active }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to toggle agent bot status');
      }

      await loadAgentBots();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle status');
    }
  };

  // Open edit modal
  const openEditModal = (bot: AgentBot) => {
    setSelectedBot(bot);
    setFormData({
      name: bot.name,
      slug: bot.slug,
      description: bot.description || '',
    });
    setShowEditModal(true);
  };

  // Open delete modal
  const openDeleteModal = (bot: AgentBot) => {
    setSelectedBot(bot);
    setShowDeleteModal(true);
  };

  if (isLoading) {
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
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Agent Bots
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {agentBots.length} agent bot{agentBots.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Agent Bot
        </Button>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-sm text-red-600 dark:text-red-400 underline mt-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search agent bots..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Agent Bot List */}
      {filteredBots.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          <Bot className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {searchQuery ? 'No matching agent bots' : 'No Agent Bots'}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {searchQuery
              ? 'Try adjusting your search terms'
              : 'Create your first agent bot to enable API access'}
          </p>
          {!searchQuery && (
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Agent Bot
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBots.map((bot) => (
            <div
              key={bot.id}
              className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Bot className="w-5 h-5 text-blue-500 flex-shrink-0" />
                    <h3 className="text-base font-medium text-gray-900 dark:text-white truncate">
                      {bot.name}
                    </h3>
                    <span
                      className={`px-2 py-0.5 text-xs rounded-full ${
                        bot.is_active
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {bot.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                      {bot.slug}
                    </code>
                    {bot.description && <span className="ml-2">{bot.description}</span>}
                  </p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {bot.version_count !== undefined && (
                      <span>
                        {bot.version_count} version{bot.version_count !== 1 ? 's' : ''}
                        {bot.default_version_label && (
                          <span className="ml-1 text-blue-500">
                            (default: {bot.default_version_label})
                          </span>
                        )}
                      </span>
                    )}
                    <span>Created by {bot.created_by}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleToggleActive(bot)}
                    className={`p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      bot.is_active
                        ? 'text-green-500'
                        : 'text-gray-400'
                    }`}
                    title={bot.is_active ? 'Deactivate' : 'Activate'}
                  >
                    {bot.is_active ? (
                      <Power className="w-4 h-4" />
                    ) : (
                      <PowerOff className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => openEditModal(bot)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openDeleteModal(bot)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-red-500"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {onSelectBot && (
                    <button
                      onClick={() => onSelectBot(bot)}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-blue-500"
                      title="Manage"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setFormData(initialFormData);
        }}
        title="Create Agent Bot"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => {
                const name = e.target.value;
                setFormData({
                  ...formData,
                  name,
                  slug: generateSlug(name),
                });
              }}
              placeholder="Invoice Processor"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Slug (URL-safe identifier)
            </label>
            <input
              type="text"
              value={formData.slug}
              onChange={(e) =>
                setFormData({ ...formData, slug: e.target.value.toLowerCase() })
              }
              placeholder="invoice-processor"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Auto-generated from name if left empty
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="Process invoice PDFs and extract line items, totals, and vendor information."
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowCreateModal(false);
                setFormData(initialFormData);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || !formData.name.trim()}>
              {isSaving ? <Spinner size="sm" className="mr-2" /> : null}
              Create Agent Bot
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedBot(null);
          setFormData(initialFormData);
        }}
        title="Edit Agent Bot"
      >
        <form onSubmit={handleEdit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Slug
            </label>
            <input
              type="text"
              value={formData.slug}
              onChange={(e) =>
                setFormData({ ...formData, slug: e.target.value.toLowerCase() })
              }
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowEditModal(false);
                setSelectedBot(null);
                setFormData(initialFormData);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || !formData.name.trim()}>
              {isSaving ? <Spinner size="sm" className="mr-2" /> : null}
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedBot(null);
        }}
        title="Delete Agent Bot"
      >
        <div className="space-y-4">
          <p className="text-gray-600 dark:text-gray-300">
            Are you sure you want to delete{' '}
            <span className="font-medium">{selectedBot?.name}</span>? This will also
            delete all versions, API keys, and job history. This action cannot be
            undone.
          </p>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowDeleteModal(false);
                setSelectedBot(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? <Spinner size="sm" className="mr-2" /> : null}
              Delete Agent Bot
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

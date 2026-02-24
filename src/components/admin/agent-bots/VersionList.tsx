'use client';

/**
 * Version List
 *
 * Lists versions for an agent bot with ability to create, edit, and delete versions.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Star,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Settings,
  Layers,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import VersionEditor from './VersionEditor';

interface Version {
  id: string;
  agent_bot_id: string;
  version_number: number;
  version_label: string | null;
  is_default: boolean;
  is_active: boolean;
  input_schema: Record<string, unknown>;
  output_config: Record<string, unknown>;
  system_prompt: string | null;
  llm_model: string | null;
  temperature: number | null;
  max_tokens: number | null;
  created_by: string;
  created_at: string;
  categories?: Array<{ id: number; name: string }>;
  skills?: Array<{ id: number; name: string }>;
  tools?: Array<{ tool_name: string; is_enabled: boolean }>;
}

interface VersionListProps {
  agentBotId: string;
}

export default function VersionList({ agentBotId }: VersionListProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<Version | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load versions
  const loadVersions = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/admin/agent-bots/${agentBotId}/versions`);
      if (!response.ok) throw new Error('Failed to load versions');
      const data = await response.json();
      setVersions(data.versions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load versions');
    } finally {
      setIsLoading(false);
    }
  }, [agentBotId]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  // Toggle version expansion
  const toggleExpanded = (versionId: string) => {
    setExpandedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(versionId)) {
        next.delete(versionId);
      } else {
        next.add(versionId);
      }
      return next;
    });
  };

  // Set as default
  const handleSetDefault = async (version: Version) => {
    try {
      const response = await fetch(
        `/api/admin/agent-bots/${agentBotId}/versions/${version.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_default: true }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to set default version');
      }

      await loadVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set default');
    }
  };

  // Toggle active
  const handleToggleActive = async (version: Version) => {
    try {
      const response = await fetch(
        `/api/admin/agent-bots/${agentBotId}/versions/${version.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: !version.is_active }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to toggle version status');
      }

      await loadVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle status');
    }
  };

  // Delete version
  const handleDelete = async () => {
    if (!selectedVersion) return;

    setIsDeleting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/agent-bots/${agentBotId}/versions/${selectedVersion.id}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete version');
      }

      await loadVersions();
      setShowDeleteModal(false);
      setSelectedVersion(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete version');
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle version created/updated
  const handleVersionSaved = () => {
    loadVersions();
    setShowCreateModal(false);
    setShowEditModal(false);
    setSelectedVersion(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Versions
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Manage versioned configurations
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Version
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

      {/* Version List */}
      {versions.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          <Layers className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No Versions
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Create your first version to configure the agent bot
          </p>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Version
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {versions
            .sort((a, b) => b.version_number - a.version_number)
            .map((version) => {
              const isExpanded = expandedVersions.has(version.id);
              return (
                <div
                  key={version.id}
                  className={`bg-white dark:bg-gray-800 border rounded-lg ${
                    version.is_default
                      ? 'border-blue-300 dark:border-blue-700'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
                >
                  {/* Version Header */}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggleExpanded(version.id)}
                          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                        <div>
                          <div className="flex items-center gap-2">
                            {version.is_default && (
                              <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                            )}
                            <span className="font-medium text-gray-900 dark:text-white">
                              Version {version.version_number}
                              {version.is_default && ' (Default)'}
                            </span>
                            {!version.is_active && (
                              <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded">
                                Inactive
                              </span>
                            )}
                          </div>
                          {version.version_label && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                              Label: {version.version_label}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500 dark:text-gray-400">
                            {version.categories && version.categories.length > 0 && (
                              <span>
                                Categories:{' '}
                                {version.categories.map((c) => c.name).join(', ')}
                              </span>
                            )}
                            {version.skills && version.skills.length > 0 && (
                              <span>
                                Skills: {version.skills.map((s) => s.name).join(', ')}
                              </span>
                            )}
                            {version.tools && version.tools.filter((t) => t.is_enabled).length > 0 && (
                              <span>
                                Tools:{' '}
                                {version.tools
                                  .filter((t) => t.is_enabled)
                                  .map((t) => t.tool_name)
                                  .join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!version.is_default && (
                          <button
                            onClick={() => handleSetDefault(version)}
                            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-yellow-500"
                            title="Set as default"
                          >
                            <Star className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setSelectedVersion(version);
                            setShowEditModal(true);
                          }}
                          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {!version.is_default && (
                          <button
                            onClick={() => {
                              setSelectedVersion(version);
                              setShowDeleteModal(true);
                            }}
                            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-red-500"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700">
                      <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">
                            LLM Model:
                          </span>{' '}
                          <span className="text-gray-900 dark:text-white">
                            {version.llm_model || 'Default'}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">
                            Temperature:
                          </span>{' '}
                          <span className="text-gray-900 dark:text-white">
                            {version.temperature ?? 'Default'}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">
                            Max Tokens:
                          </span>{' '}
                          <span className="text-gray-900 dark:text-white">
                            {version.max_tokens ?? 'Default'}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">
                            Created:
                          </span>{' '}
                          <span className="text-gray-900 dark:text-white">
                            {new Date(version.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      {version.system_prompt && (
                        <div className="mt-4">
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            System Prompt:
                          </span>
                          <pre className="mt-1 p-3 bg-gray-50 dark:bg-gray-900 rounded text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-32 overflow-auto">
                            {version.system_prompt}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* Create Version Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Version"
      >
        <VersionEditor
          agentBotId={agentBotId}
          onSave={handleVersionSaved}
          onCancel={() => setShowCreateModal(false)}
        />
      </Modal>

      {/* Edit Version Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedVersion(null);
        }}
        title={`Edit Version ${selectedVersion?.version_number}`}
      >
        {selectedVersion && (
          <VersionEditor
            agentBotId={agentBotId}
            version={selectedVersion as any}
            onSave={handleVersionSaved}
            onCancel={() => {
              setShowEditModal(false);
              setSelectedVersion(null);
            }}
          />
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedVersion(null);
        }}
        title="Delete Version"
      >
        <div className="space-y-4">
          <p className="text-gray-600 dark:text-gray-300">
            Are you sure you want to delete Version {selectedVersion?.version_number}
            {selectedVersion?.version_label && ` (${selectedVersion.version_label})`}?
            This action cannot be undone.
          </p>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowDeleteModal(false);
                setSelectedVersion(null);
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
              Delete Version
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

'use client';

/**
 * Workspaces Tab
 *
 * Admin UI for managing workspace chatbots (both embed and standalone).
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
  ExternalLink,
  Copy,
  Check,
  Settings,
  Users,
  BarChart3,
  Code,
  Globe,
  MessageSquare,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';

interface Category {
  id: number;
  name: string;
  slug: string;
}

interface EnabledModel {
  id: string;
  providerId: string;
  displayName: string;
  toolCapable: boolean;
  visionCapable: boolean;
  isDefault: boolean;
}

interface Workspace {
  id: string;
  slug: string;
  name: string;
  type: 'embed' | 'standalone';
  is_enabled: boolean;
  access_mode: 'category' | 'explicit';
  primary_color: string;
  logo_url: string | null;
  chat_title: string | null;
  greeting_message: string;
  suggested_prompts: string[] | null;
  footer_text: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  temperature: number | null;
  system_prompt: string | null;
  allowed_domains: string[];
  daily_limit: number;
  session_limit: number;
  voice_enabled: boolean;
  file_upload_enabled: boolean;
  max_file_size_mb: number;
  web_search_enabled: boolean;
  auth_required: boolean;
  created_by: string;
  created_by_role: 'admin' | 'superuser';
  created_at: string;
  updated_at: string;
  category_ids?: number[];
  category_names?: string[];
}

interface WorkspaceFormData {
  name: string;
  type: 'embed' | 'standalone';
  categoryIds: number[];
  primaryColor: string;
  logoUrl: string;
  chatTitle: string;
  greetingMessage: string;
  suggestedPrompts: string[];
  footerText: string;
  llmProvider: string;
  llmModel: string;
  temperature: number | null;
  systemPrompt: string;
  allowedDomains: string[];
  dailyLimit: number;
  sessionLimit: number;
  voiceEnabled: boolean;
  fileUploadEnabled: boolean;
  maxFileSizeMb: number;
  webSearchEnabled: boolean;
  authRequired: boolean;
  accessMode: 'category' | 'explicit';
}

const initialFormData: WorkspaceFormData = {
  name: '',
  type: 'embed',
  categoryIds: [],
  primaryColor: '#2563eb',
  logoUrl: '',
  chatTitle: '',
  greetingMessage: 'How can I help you today?',
  suggestedPrompts: [],
  footerText: '',
  llmProvider: '',
  llmModel: '',
  temperature: null,
  systemPrompt: '',
  allowedDomains: [],
  dailyLimit: 1000,
  sessionLimit: 50,
  voiceEnabled: false,
  fileUploadEnabled: false,
  maxFileSizeMb: 5,
  webSearchEnabled: true,
  authRequired: false,
  accessMode: 'category',
};

interface WorkspacesTabProps {
  isAdmin: boolean;
}

export default function WorkspacesTab({ isAdmin }: WorkspacesTabProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [availableModels, setAvailableModels] = useState<EnabledModel[]>([]);
  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'embed' | 'standalone'>('all');

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEmbedModal, setShowEmbedModal] = useState(false);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [formData, setFormData] = useState<WorkspaceFormData>(initialFormData);
  const [isSaving, setIsSaving] = useState(false);

  // Embed code states
  const [embedCode, setEmbedCode] = useState<{
    basic?: string;
    withOptions?: string;
    manual?: string;
    iframeEmbed?: string;
    hostedUrl?: string;
    standaloneUrl?: string;
  }>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const apiBase = isAdmin ? '/api/admin' : '/api/superuser';

  // Fetch workspaces and categories
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [workspacesRes, categoriesRes, modelsRes] = await Promise.all([
        fetch(`${apiBase}/workspaces`),
        fetch(`${apiBase}/categories`),
        fetch('/api/admin/llm/models?active=true'),
      ]);

      if (!workspacesRes.ok) throw new Error('Failed to fetch workspaces');
      if (!categoriesRes.ok) throw new Error('Failed to fetch categories');

      const workspacesData = await workspacesRes.json();
      const categoriesData = await categoriesRes.json();

      setWorkspaces(workspacesData.workspaces || []);
      setFeatureEnabled(workspacesData.featureEnabled ?? true);
      setCategories(categoriesData.categories || []);

      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        setAvailableModels(modelsData.models || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Toggle feature enabled (admin only)
  const toggleFeature = async () => {
    if (!isAdmin) return;

    try {
      const res = await fetch('/api/admin/settings/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !featureEnabled }),
      });

      if (!res.ok) throw new Error('Failed to update setting');

      setFeatureEnabled(!featureEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update setting');
    }
  };

  // Create workspace
  const handleCreate = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          allowedDomains: formData.allowedDomains.filter((d) => d),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create workspace');
      }

      const data = await res.json();
      setWorkspaces([data.workspace, ...workspaces]);
      setShowCreateModal(false);
      setFormData(initialFormData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setIsSaving(false);
    }
  };

  // Update workspace
  const handleUpdate = async () => {
    if (!selectedWorkspace) return;

    setIsSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/workspaces/${selectedWorkspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          allowedDomains: formData.allowedDomains.filter((d) => d),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update workspace');
      }

      const data = await res.json();
      setWorkspaces(workspaces.map(w => (w.id === selectedWorkspace.id ? data.workspace : w)));
      setShowEditModal(false);
      setSelectedWorkspace(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update workspace');
    } finally {
      setIsSaving(false);
    }
  };

  // Delete workspace
  const handleDelete = async () => {
    if (!selectedWorkspace) return;

    setIsSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/workspaces/${selectedWorkspace.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete workspace');
      }

      setWorkspaces(workspaces.filter(w => w.id !== selectedWorkspace.id));
      setShowDeleteModal(false);
      setSelectedWorkspace(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workspace');
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle workspace enabled
  const toggleEnabled = async (workspace: Workspace) => {
    try {
      const res = await fetch(`${apiBase}/workspaces/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: !workspace.is_enabled }),
      });

      if (!res.ok) throw new Error('Failed to update workspace');

      const data = await res.json();
      setWorkspaces(workspaces.map(w => (w.id === workspace.id ? data.workspace : w)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update workspace');
    }
  };

  // Open edit modal
  const openEdit = (workspace: Workspace) => {
    setSelectedWorkspace(workspace);
    setFormData({
      name: workspace.name,
      type: workspace.type,
      categoryIds: workspace.category_ids || [],
      primaryColor: workspace.primary_color,
      logoUrl: workspace.logo_url || '',
      chatTitle: workspace.chat_title || '',
      greetingMessage: workspace.greeting_message,
      suggestedPrompts: workspace.suggested_prompts || [],
      footerText: workspace.footer_text || '',
      llmProvider: workspace.llm_provider || '',
      llmModel: workspace.llm_model || '',
      temperature: workspace.temperature,
      systemPrompt: workspace.system_prompt || '',
      allowedDomains: workspace.allowed_domains || [],
      dailyLimit: workspace.daily_limit,
      sessionLimit: workspace.session_limit,
      voiceEnabled: workspace.voice_enabled,
      fileUploadEnabled: workspace.file_upload_enabled,
      maxFileSizeMb: workspace.max_file_size_mb,
      webSearchEnabled: workspace.web_search_enabled,
      authRequired: workspace.auth_required,
      accessMode: workspace.access_mode,
    });
    setShowEditModal(true);
  };

  // Fetch embed code
  const fetchEmbedCode = async (workspace: Workspace) => {
    setSelectedWorkspace(workspace);
    setShowEmbedModal(true);

    try {
      const res = await fetch(`${apiBase}/workspaces/${workspace.id}/script`);
      if (!res.ok) throw new Error('Failed to fetch embed code');

      const data = await res.json();
      setEmbedCode(data.type === 'embed' ? {
        basic: data.scripts?.basic,
        withOptions: data.scripts?.withOptions,
        manual: data.scripts?.manual,
        iframeEmbed: data.iframeEmbed,
        hostedUrl: data.hostedUrl,
      } : {
        standaloneUrl: data.standaloneUrl,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch embed code');
    }
  };

  // Copy to clipboard
  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Filter workspaces
  const filteredWorkspaces = workspaces.filter(w => {
    const matchesSearch = w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         w.slug.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === 'all' || w.type === typeFilter;
    return matchesSearch && matchesType;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Workspaces</h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage embed and standalone chatbot workspaces
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isAdmin && (
            <Button
              variant={featureEnabled ? 'secondary' : 'primary'}
              onClick={toggleFeature}
              className="flex items-center gap-2"
            >
              {featureEnabled ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
              {featureEnabled ? 'Disable Feature' : 'Enable Feature'}
            </Button>
          )}

          <Button
            variant="primary"
            onClick={() => {
              setFormData(initialFormData);
              setShowCreateModal(true);
            }}
            disabled={!featureEnabled}
            className="flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Workspace
          </Button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Feature disabled warning */}
      {!featureEnabled && (
        <div className="flex items-center gap-2 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">
          <AlertCircle className="w-5 h-5" />
          Workspaces feature is disabled. All workspace URLs will return 404.
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search workspaces..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'all' | 'embed' | 'standalone')}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Types</option>
          <option value="embed">Embed</option>
          <option value="standalone">Standalone</option>
        </select>
      </div>

      {/* Workspaces list */}
      {filteredWorkspaces.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {searchQuery || typeFilter !== 'all'
            ? 'No workspaces match your filters'
            : 'No workspaces yet. Create one to get started.'}
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredWorkspaces.map((workspace) => (
            <WorkspaceCard
              key={workspace.id}
              workspace={workspace}
              onEdit={() => openEdit(workspace)}
              onDelete={() => {
                setSelectedWorkspace(workspace);
                setShowDeleteModal(true);
              }}
              onToggle={() => toggleEnabled(workspace)}
              onGetCode={() => fetchEmbedCode(workspace)}
            />
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Workspace"
      >
        <WorkspaceForm
          formData={formData}
          setFormData={setFormData}
          categories={categories}
          availableModels={availableModels}
          onSubmit={handleCreate}
          onCancel={() => setShowCreateModal(false)}
          isLoading={isSaving}
          submitLabel="Create"
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Edit Workspace"
      >
        <WorkspaceForm
          formData={formData}
          setFormData={setFormData}
          categories={categories}
          availableModels={availableModels}
          onSubmit={handleUpdate}
          onCancel={() => setShowEditModal(false)}
          isLoading={isSaving}
          submitLabel="Save Changes"
          isEdit
        />
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Workspace"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            Are you sure you want to delete <strong>{selectedWorkspace?.name}</strong>?
            This will also delete all associated sessions, threads, and messages.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={isSaving}>
              {isSaving ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Embed Code Modal */}
      <Modal
        isOpen={showEmbedModal}
        onClose={() => {
          setShowEmbedModal(false);
          setEmbedCode({});
        }}
        title={selectedWorkspace?.type === 'embed' ? 'Embed Code' : 'Workspace URL'}
      >
        <div className="space-y-4">
          {selectedWorkspace?.type === 'standalone' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Direct Link
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={embedCode.standaloneUrl || ''}
                  readOnly
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm"
                />
                <Button
                  variant="secondary"
                  onClick={() => copyToClipboard(embedCode.standaloneUrl || '', 'standaloneUrl')}
                  className="flex items-center gap-1"
                >
                  {copiedField === 'standaloneUrl' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
                <a
                  href={embedCode.standaloneUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-gray-600 hover:text-gray-900"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Basic Script Tag
                </label>
                <div className="relative">
                  <pre className="p-3 bg-gray-100 rounded-lg text-xs overflow-x-auto">
                    {embedCode.basic || 'Loading...'}
                  </pre>
                  {embedCode.basic && (
                    <button
                      onClick={() => copyToClipboard(embedCode.basic!, 'basic')}
                      className="absolute top-2 right-2 p-1 bg-white rounded border hover:bg-gray-50"
                    >
                      {copiedField === 'basic' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Hosted Page URL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={embedCode.hostedUrl || ''}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => copyToClipboard(embedCode.hostedUrl || '', 'hostedUrl')}
                  >
                    {copiedField === 'hostedUrl' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  iFrame Embed
                </label>
                <div className="relative">
                  <pre className="p-3 bg-gray-100 rounded-lg text-xs overflow-x-auto">
                    {embedCode.iframeEmbed || 'Loading...'}
                  </pre>
                  {embedCode.iframeEmbed && (
                    <button
                      onClick={() => copyToClipboard(embedCode.iframeEmbed!, 'iframe')}
                      className="absolute top-2 right-2 p-1 bg-white rounded border hover:bg-gray-50"
                    >
                      {copiedField === 'iframe' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

// Workspace card component
function WorkspaceCard({
  workspace,
  onEdit,
  onDelete,
  onToggle,
  onGetCode,
}: {
  workspace: Workspace;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onGetCode: () => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          {/* Color indicator */}
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-white"
            style={{ backgroundColor: workspace.primary_color }}
          >
            {workspace.type === 'embed' ? (
              <Code className="w-5 h-5" />
            ) : (
              <MessageSquare className="w-5 h-5" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-gray-900">{workspace.name}</h3>
              <span
                className={`px-2 py-0.5 text-xs rounded-full ${
                  workspace.type === 'embed'
                    ? 'bg-purple-100 text-purple-700'
                    : 'bg-blue-100 text-blue-700'
                }`}
              >
                {workspace.type}
              </span>
              {!workspace.is_enabled && (
                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                  Disabled
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              /{workspace.slug}
            </p>
            {workspace.category_names && workspace.category_names.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {workspace.category_names.map((name, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onToggle}
            className={`p-2 rounded-lg ${
              workspace.is_enabled
                ? 'text-green-600 hover:bg-green-50'
                : 'text-gray-400 hover:bg-gray-50'
            }`}
            title={workspace.is_enabled ? 'Disable' : 'Enable'}
          >
            {workspace.is_enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
          </button>

          <button
            onClick={onGetCode}
            className="p-2 text-gray-600 hover:bg-gray-50 rounded-lg"
            title="Get Code"
          >
            <Code className="w-4 h-4" />
          </button>

          <button
            onClick={onEdit}
            className="p-2 text-gray-600 hover:bg-gray-50 rounded-lg"
            title="Edit"
          >
            <Edit2 className="w-4 h-4" />
          </button>

          <button
            onClick={onDelete}
            className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Workspace form component
function WorkspaceForm({
  formData,
  setFormData,
  categories,
  availableModels,
  onSubmit,
  onCancel,
  isLoading,
  submitLabel,
  isEdit = false,
}: {
  formData: WorkspaceFormData;
  setFormData: (data: WorkspaceFormData) => void;
  categories: Category[];
  availableModels: EnabledModel[];
  onSubmit: () => void;
  onCancel: () => void;
  isLoading: boolean;
  submitLabel: string;
  isEdit?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<'basic' | 'branding' | 'limits' | 'ai'>('basic');

  const updateField = <K extends keyof WorkspaceFormData>(
    field: K,
    value: WorkspaceFormData[K]
  ) => {
    setFormData({ ...formData, [field]: value });
  };

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(['basic', 'branding', 'limits', 'ai'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === tab
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'ai' ? 'AI' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Basic tab */}
      {activeTab === 'basic' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="My Workspace"
            />
          </div>

          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={formData.type}
                onChange={(e) => updateField('type', e.target.value as 'embed' | 'standalone')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="embed">Embed (Widget for external sites)</option>
                <option value="standalone">Standalone (Full-featured chat)</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Categories</label>
            <div className="max-h-40 overflow-y-auto border border-gray-300 rounded-lg p-2 space-y-1">
              {categories.map((cat) => (
                <label key={cat.id} className="flex items-center gap-2 p-1 hover:bg-gray-50 rounded">
                  <input
                    type="checkbox"
                    checked={formData.categoryIds.includes(cat.id)}
                    onChange={(e) => {
                      const newIds = e.target.checked
                        ? [...formData.categoryIds, cat.id]
                        : formData.categoryIds.filter((id) => id !== cat.id);
                      updateField('categoryIds', newIds);
                    }}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-sm">{cat.name}</span>
                </label>
              ))}
            </div>
          </div>

          {formData.type === 'standalone' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Access Mode</label>
              <select
                value={formData.accessMode}
                onChange={(e) => updateField('accessMode', e.target.value as 'category' | 'explicit')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="category">Category-based (users with category access)</option>
                <option value="explicit">Explicit (manually added users only)</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* Branding tab */}
      {activeTab === 'branding' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Primary Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={formData.primaryColor}
                onChange={(e) => updateField('primaryColor', e.target.value)}
                className="w-10 h-10 rounded border-0 cursor-pointer"
              />
              <input
                type="text"
                value={formData.primaryColor}
                onChange={(e) => updateField('primaryColor', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Chat Title</label>
            <input
              type="text"
              value={formData.chatTitle}
              onChange={(e) => updateField('chatTitle', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="Chat with us"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Greeting Message</label>
            <textarea
              value={formData.greetingMessage}
              onChange={(e) => updateField('greetingMessage', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              rows={2}
              placeholder="How can I help you today?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Logo URL</label>
            <input
              type="text"
              value={formData.logoUrl}
              onChange={(e) => updateField('logoUrl', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="https://..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Footer Text</label>
            <input
              type="text"
              value={formData.footerText}
              onChange={(e) => updateField('footerText', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="Powered by..."
            />
          </div>
        </div>
      )}

      {/* Limits tab */}
      {activeTab === 'limits' && (
        <div className="space-y-4">
          {formData.type === 'embed' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Daily Limit (per IP)
                </label>
                <input
                  type="number"
                  value={formData.dailyLimit}
                  onChange={(e) => updateField('dailyLimit', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Session Limit (messages per session)
                </label>
                <input
                  type="number"
                  value={formData.sessionLimit}
                  onChange={(e) => updateField('sessionLimit', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Allowed Domains (one per line)
                </label>
                <textarea
                  value={formData.allowedDomains.join('\n')}
                  onChange={(e) =>
                    updateField(
                      'allowedDomains',
                      e.target.value.split('\n').map((d) => d.trim())
                    )
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  rows={3}
                  placeholder="example.com\nother-site.org"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Leave empty to allow all domains
                </p>
              </div>

              <div className="border-t pt-4 mt-4">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={formData.authRequired}
                    onChange={(e) => updateField('authRequired', e.target.checked)}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700">Require Authentication</span>
                    <p className="text-xs text-gray-500">Users must be logged in to use this embed</p>
                  </div>
                </label>
              </div>
            </>
          )}

          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.voiceEnabled}
                onChange={(e) => updateField('voiceEnabled', e.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm">Enable Voice Input</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.fileUploadEnabled}
                onChange={(e) => updateField('fileUploadEnabled', e.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm">Enable File Upload</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.webSearchEnabled}
                onChange={(e) => updateField('webSearchEnabled', e.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm">Enable Web Search</span>
            </label>
          </div>

          {formData.fileUploadEnabled && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max File Size (MB)
              </label>
              <input
                type="number"
                value={formData.maxFileSizeMb}
                onChange={(e) => updateField('maxFileSizeMb', parseInt(e.target.value) || 5)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                min={1}
                max={50}
              />
            </div>
          )}
        </div>
      )}

      {/* AI tab */}
      {activeTab === 'ai' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              LLM Model
            </label>
            <select
              value={formData.llmModel}
              onChange={(e) => {
                const selected = availableModels.find((m) => m.id === e.target.value);
                setFormData({ ...formData, llmModel: e.target.value, llmProvider: selected?.providerId || '' });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Use global default</option>
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                  {model.toolCapable ? ' [tools]' : ''}
                  {model.visionCapable ? ' [vision]' : ''}
                  {model.isDefault ? ' ★' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Overrides the global default model for this workspace. Leave blank to use the system default.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Temperature
            </label>
            <input
              type="number"
              value={formData.temperature ?? ''}
              onChange={(e) => updateField('temperature', e.target.value === '' ? null : parseFloat(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="Use global default"
              min={0}
              max={2}
              step={0.1}
            />
            <p className="text-xs text-gray-500 mt-1">
              Leave blank to use the global default temperature.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              System Prompt Override
            </label>
            <textarea
              value={formData.systemPrompt}
              onChange={(e) => updateField('systemPrompt', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              rows={5}
              placeholder="Custom instructions prepended to the global system prompt..."
            />
            <p className="text-xs text-gray-500 mt-1">
              Additional instructions prepended to the system prompt for this workspace. Leave blank to use the global prompt only.
            </p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={isLoading || !formData.name || formData.categoryIds.length === 0}
        >
          {isLoading ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </div>
  );
}

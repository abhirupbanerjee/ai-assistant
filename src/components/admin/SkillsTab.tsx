'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Power,
  PowerOff,
  AlertCircle,
  CheckCircle,
  Search,
  Zap,
  Layers,
  Lock,
  Settings,
  Save,
  Play,
  Eye,
  RotateCcw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Shield,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';

interface Category {
  id: number;
  name: string;
  slug: string;
}

interface Tool {
  name: string;
  displayName: string;
  enabled: boolean;
}

type MatchType = 'keyword' | 'regex';
type ForceMode = 'required' | 'preferred' | 'suggested';

interface SkillComplianceConfig {
  enabled?: boolean;
  sections?: string[];
  passThreshold?: number;
  warnThreshold?: number;
  clarificationInstructions?: string;
}

interface Skill {
  id: number;
  name: string;
  description: string | null;
  prompt_content: string;
  trigger_type: 'always' | 'category' | 'keyword';
  trigger_value: string | null;
  category_restricted: boolean;
  is_index: boolean;
  priority: number;
  is_active: boolean;
  is_core: boolean;
  token_estimate: number | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  categories: Category[];

  // Tool routing fields
  match_type?: MatchType;
  tool_name?: string | null;
  force_mode?: ForceMode | null;
  tool_config_override?: Record<string, unknown> | null;
  data_source_filter?: { type: 'include' | 'exclude'; source_ids: number[] } | null;

  // Compliance configuration
  compliance_config?: SkillComplianceConfig | null;
}

interface SkillsSettings {
  enabled: boolean;
  maxTotalTokens: number;
  debugMode: boolean;
}

interface PreviewResult {
  wouldActivate: { name: string; trigger: string; tokens: number }[];
  totalTokens: number;
  exceedsLimit: boolean;
}

interface SkillFormData {
  name: string;
  description: string;
  prompt_content: string;
  trigger_type: 'always' | 'category' | 'keyword';
  trigger_value: string;
  category_restricted: boolean;
  is_index: boolean;
  priority: number;
  category_ids: number[];

  // Tool routing fields
  match_type: MatchType;
  tool_name: string;
  force_mode: ForceMode;
  tool_config_override: string; // JSON string for editing

  // Compliance configuration
  compliance_enabled: boolean;
  compliance_sections: string; // Comma-separated list, stored as array in API
  compliance_passThreshold: number | undefined;
  compliance_warnThreshold: number | undefined;
  compliance_clarificationInstructions: string;
}

const initialFormData: SkillFormData = {
  name: '',
  description: '',
  prompt_content: '',
  trigger_type: 'keyword',
  trigger_value: '',
  category_restricted: false,
  is_index: false,
  priority: 100,
  category_ids: [],

  // Tool routing defaults
  match_type: 'keyword',
  tool_name: '',
  force_mode: 'required',
  tool_config_override: '',

  // Compliance defaults (opt-in, disabled by default)
  compliance_enabled: false,
  compliance_sections: '',
  compliance_passThreshold: undefined,
  compliance_warnThreshold: undefined,
  compliance_clarificationInstructions: '',
};

// Priority tiers
const PRIORITY_TIERS = {
  CORE: { min: 1, max: 9, label: 'Core', color: 'purple', adminOnly: true },
  HIGH: { min: 10, max: 99, label: 'High', color: 'red', adminOnly: true },
  MEDIUM: { min: 100, max: 499, label: 'Medium', color: 'amber', adminOnly: false },
  LOW: { min: 500, max: Infinity, label: 'Low', color: 'blue', adminOnly: false },
} as const;

// Superusers must use priority 100+
const PRIORITY_SUPERUSER_MIN = 100;
const PRIORITY_ADMIN_MAX = 99;

/**
 * Get priority tier info for a given priority value
 */
function getPriorityTier(priority: number): { label: string; color: string; adminOnly: boolean } {
  if (priority <= PRIORITY_TIERS.CORE.max) return PRIORITY_TIERS.CORE;
  if (priority <= PRIORITY_TIERS.HIGH.max) return PRIORITY_TIERS.HIGH;
  if (priority <= PRIORITY_TIERS.MEDIUM.max) return PRIORITY_TIERS.MEDIUM;
  return PRIORITY_TIERS.LOW;
}

/**
 * Get priority tier badge component
 */
function PriorityBadge({ priority }: { priority: number }) {
  const tier = getPriorityTier(priority);
  const colorClasses: Record<string, string> = {
    purple: 'bg-purple-100 text-purple-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
    gray: 'bg-gray-100 text-gray-600',
  };

  return (
    <span
      className={`px-2 py-0.5 text-xs rounded-full ${colorClasses[tier.color]}`}
      title={`Priority ${priority} (${tier.label}${tier.adminOnly ? ' - Admin only' : ''})`}
    >
      {priority} · {tier.label}
    </span>
  );
}

interface SkillsTabProps {
  /** If true, restricts to superuser permissions (no 'always' trigger, priority >= 100) */
  isSuperuser?: boolean;
}

export default function SkillsTab({ isSuperuser = false }: SkillsTabProps) {
  // State
  const [skills, setSkills] = useState<Skill[]>([]);
  const [settings, setSettings] = useState<SkillsSettings>({
    enabled: false,
    maxTotalTokens: 3000,
    debugMode: false,
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [formData, setFormData] = useState<SkillFormData>(initialFormData);

  // Preview state
  const [previewCategoryIds, setPreviewCategoryIds] = useState<number[]>([]);
  const [previewMessage, setPreviewMessage] = useState('');
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Filter/search state
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTriggerType, setFilterTriggerType] = useState<'all' | 'always' | 'category' | 'keyword'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [filterHasTool, setFilterHasTool] = useState<'all' | 'with-tool' | 'no-tool'>('all');

  // Sort state
  type SortField = 'id' | 'name' | 'trigger' | 'priority' | 'tokens' | 'status';
  type SortOrder = 'asc' | 'desc';
  const [sortBy, setSortBy] = useState<SortField>('id');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Data sources and function APIs for tool config
  const [dataSources, setDataSources] = useState<{ apis: { id: string; name: string }[]; csvs: { id: string; name: string }[] }>({ apis: [], csvs: [] });
  const [functionApis, setFunctionApis] = useState<{ id: string; name: string; toolsSchema?: unknown[] }[]>([]);

  // Domain validation for web search
  const [domainError, setDomainError] = useState<string | null>(null);

  // Fetch data
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Use superuser API endpoints when in superuser mode
      const apiBase = isSuperuser ? '/api/superuser' : '/api/admin';
      const [skillsRes, categoriesRes, toolsRes, dataSourcesRes, functionApisRes] = await Promise.all([
        fetch('/api/admin/skills'), // Skills API handles role-based filtering internally
        fetch(`${apiBase}/categories`),
        fetch(`${apiBase}/tools`),
        fetch('/api/admin/data-sources'),
        fetch('/api/admin/function-apis'),
      ]);

      if (!skillsRes.ok) throw new Error('Failed to fetch skills');
      if (!categoriesRes.ok) throw new Error('Failed to fetch categories');
      if (!toolsRes.ok) throw new Error('Failed to fetch tools');

      const skillsData = await skillsRes.json();
      const categoriesData = await categoriesRes.json();
      const toolsData = await toolsRes.json();

      setSkills(skillsData.skills || []);
      setSettings(skillsData.settings || { enabled: false, maxTotalTokens: 3000, debugMode: false });
      setCategories(categoriesData.categories || []);
      // Normalize tools data: superuser API returns 'globalEnabled', admin API returns 'enabled'
      const normalizedTools = (toolsData.tools || []).map((t: Tool & { globalEnabled?: boolean }) => ({
        ...t,
        enabled: t.enabled ?? t.globalEnabled ?? false,
      }));
      setTools(normalizedTools);

      // Fetch data sources (optional - don't fail if unavailable)
      if (dataSourcesRes.ok) {
        const dsData = await dataSourcesRes.json();
        setDataSources({ apis: dsData.apis || [], csvs: dsData.csvs || [] });
      }

      // Fetch function APIs (optional - don't fail if unavailable)
      if (functionApisRes.ok) {
        const faData = await functionApisRes.json();
        setFunctionApis(faData.functionApis || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // Save settings
  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'skills',
          settings: settings,
        }),
      });

      if (!response.ok) throw new Error('Failed to save settings');

      setSuccess('Settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Prepare form data for API submission
  const prepareFormDataForSubmit = () => {
    const data: Record<string, unknown> = { ...formData };

    // Parse tool_config_override from JSON string to object
    if (formData.tool_config_override) {
      try {
        data.tool_config_override = JSON.parse(formData.tool_config_override);
      } catch {
        // Invalid JSON - will be sent as empty
        data.tool_config_override = null;
      }
    } else {
      data.tool_config_override = null;
    }

    // Clear tool fields if no tool selected
    if (!formData.tool_name) {
      data.tool_name = null;
      data.force_mode = null;
      data.tool_config_override = null;
    }

    // Build compliance_config if enabled
    if (formData.compliance_enabled) {
      data.compliance_config = {
        enabled: true,
        sections: formData.compliance_sections
          ? formData.compliance_sections.split(',').map(s => s.trim()).filter(Boolean)
          : undefined,
        passThreshold: formData.compliance_passThreshold,
        warnThreshold: formData.compliance_warnThreshold,
        clarificationInstructions: formData.compliance_clarificationInstructions || undefined,
      };
    } else {
      data.compliance_config = null;
    }

    // Remove individual compliance fields that shouldn't be sent to API
    delete data.compliance_enabled;
    delete data.compliance_sections;
    delete data.compliance_passThreshold;
    delete data.compliance_warnThreshold;
    delete data.compliance_clarificationInstructions;

    return data;
  };

  // Create skill
  const handleCreate = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prepareFormDataForSubmit()),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create skill');
      }

      setShowCreateModal(false);
      setFormData(initialFormData);
      setSuccess('Skill created successfully');
      setTimeout(() => setSuccess(null), 3000);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create skill');
    } finally {
      setSaving(false);
    }
  };

  // Update skill
  const handleUpdate = async () => {
    if (!selectedSkill) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/skills/${selectedSkill.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prepareFormDataForSubmit()),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update skill');
      }

      setShowEditModal(false);
      setSelectedSkill(null);
      setFormData(initialFormData);
      setSuccess('Skill updated successfully');
      setTimeout(() => setSuccess(null), 3000);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update skill');
    } finally {
      setSaving(false);
    }
  };

  // Delete skill
  const handleDelete = async () => {
    if (!selectedSkill) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/skills/${selectedSkill.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete skill');
      }

      setShowDeleteModal(false);
      setSelectedSkill(null);
      setSuccess('Skill deleted successfully');
      setTimeout(() => setSuccess(null), 3000);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete skill');
    } finally {
      setSaving(false);
    }
  };

  // Toggle active status
  const handleToggleActive = async (skill: Skill) => {
    try {
      const response = await fetch(`/api/admin/skills/${skill.id}`, {
        method: 'PATCH',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to toggle skill');
      }

      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle skill');
    }
  };

  // Preview skills
  const handlePreview = async () => {
    if (!previewMessage.trim()) return;
    setPreviewLoading(true);
    try {
      const response = await fetch('/api/admin/skills/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_ids: previewCategoryIds,
          test_message: previewMessage,
        }),
      });

      if (!response.ok) throw new Error('Failed to preview skills');

      const data = await response.json();
      setPreviewResult(data.preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview skills');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Restore core skills to config defaults
  const handleRestoreDefaults = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/skills', {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to restore skills');
      }

      const data = await response.json();
      setShowRestoreModal(false);
      setSuccess(data.message || 'Core skills restored to defaults');
      setTimeout(() => setSuccess(null), 3000);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore skills');
    } finally {
      setSaving(false);
    }
  };

  // Open edit modal
  const openEditModal = (skill: Skill) => {
    setSelectedSkill(skill);
    setFormData({
      name: skill.name,
      description: skill.description || '',
      prompt_content: skill.prompt_content,
      trigger_type: skill.trigger_type,
      trigger_value: skill.trigger_value || '',
      category_restricted: skill.category_restricted,
      is_index: skill.is_index,
      priority: skill.priority,
      category_ids: skill.categories.map(c => c.id),

      // Tool routing fields
      match_type: skill.match_type || 'keyword',
      tool_name: skill.tool_name || '',
      force_mode: skill.force_mode || 'required',
      tool_config_override: skill.tool_config_override
        ? JSON.stringify(skill.tool_config_override, null, 2)
        : '',

      // Compliance config fields
      compliance_enabled: skill.compliance_config?.enabled || false,
      compliance_sections: skill.compliance_config?.sections?.join(', ') || '',
      compliance_passThreshold: skill.compliance_config?.passThreshold,
      compliance_warnThreshold: skill.compliance_config?.warnThreshold,
      compliance_clarificationInstructions: skill.compliance_config?.clarificationInstructions || '',
    });
    setShowEditModal(true);
  };

  // Filter and sort skills
  const filteredSkills = skills
    .filter(skill => {
      const matchesSearch =
        skill.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (skill.description?.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesTrigger = filterTriggerType === 'all' || skill.trigger_type === filterTriggerType;
      const matchesStatus =
        filterStatus === 'all' ||
        (filterStatus === 'active' && skill.is_active) ||
        (filterStatus === 'inactive' && !skill.is_active);
      const matchesHasTool =
        filterHasTool === 'all' ||
        (filterHasTool === 'with-tool' && skill.tool_name) ||
        (filterHasTool === 'no-tool' && !skill.tool_name);
      return matchesSearch && matchesTrigger && matchesStatus && matchesHasTool;
    })
    .sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'id':
          comparison = a.id - b.id;
          break;
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'trigger':
          comparison = a.trigger_type.localeCompare(b.trigger_type);
          break;
        case 'priority':
          comparison = a.priority - b.priority;
          break;
        case 'tokens':
          comparison = (a.token_estimate || 0) - (b.token_estimate || 0);
          break;
        case 'status':
          // Active first when ascending
          comparison = (a.is_active === b.is_active) ? 0 : (a.is_active ? -1 : 1);
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  // Toggle sort handler
  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  // Get trigger type badge
  const getTriggerBadge = (type: string) => {
    switch (type) {
      case 'always':
        return <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">Always</span>;
      case 'category':
        return <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">Category</span>;
      case 'keyword':
        return <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">Keyword</span>;
      default:
        return null;
    }
  };

  // Parse config override JSON safely
  const getConfigValue = (key: string): string => {
    try {
      const config = formData.tool_config_override
        ? JSON.parse(formData.tool_config_override)
        : {};
      return config[key] || '';
    } catch {
      return '';
    }
  };

  // Set a single config value, preserving others
  const setConfigValue = (key: string, value: string) => {
    try {
      const config = formData.tool_config_override
        ? JSON.parse(formData.tool_config_override)
        : {};
      if (value) {
        config[key] = value;
      } else {
        delete config[key];
      }
      const json = Object.keys(config).length > 0
        ? JSON.stringify(config, null, 2)
        : '';
      setFormData({ ...formData, tool_config_override: json });
    } catch {
      // If existing JSON is invalid, start fresh
      const json = value ? JSON.stringify({ [key]: value }, null, 2) : '';
      setFormData({ ...formData, tool_config_override: json });
    }
  };

  // Get array config value
  const getConfigArrayValue = (key: string): string[] => {
    try {
      const config = formData.tool_config_override
        ? JSON.parse(formData.tool_config_override)
        : {};
      return Array.isArray(config[key]) ? config[key] : [];
    } catch {
      return [];
    }
  };

  // Set array config value
  const setConfigArrayValue = (key: string, value: string[]) => {
    try {
      const config = formData.tool_config_override
        ? JSON.parse(formData.tool_config_override)
        : {};
      if (value.length > 0) {
        config[key] = value;
      } else {
        delete config[key];
      }
      const json = Object.keys(config).length > 0
        ? JSON.stringify(config, null, 2)
        : '';
      setFormData({ ...formData, tool_config_override: json });
    } catch {
      const json = value.length > 0 ? JSON.stringify({ [key]: value }, null, 2) : '';
      setFormData({ ...formData, tool_config_override: json });
    }
  };

  // Domain validation regex - supports wildcards as Tavily API accepts them
  // Patterns: *.com (all .com), *.gov.tt (all gov.tt subdomains), example.com (specific domain)
  const DOMAIN_REGEX = /^(?:\*\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z]{2,}$/;

  // Track raw input for domains to allow typing commas
  const [domainsRawInput, setDomainsRawInput] = useState<string>('');
  const [domainsUserEditing, setDomainsUserEditing] = useState(false);

  // Initialize raw input from config when modal opens
  const isModalOpen = showCreateModal || showEditModal;
  useEffect(() => {
    if (isModalOpen && !domainsUserEditing) {
      // Only initialize when not actively editing
      const existingDomains = getConfigArrayValue('includeDomains');
      setDomainsRawInput(existingDomains.join(', '));
    }
    if (!isModalOpen) {
      // Reset when modal closes
      setDomainsRawInput('');
      setDomainsUserEditing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen]);

  // Handle domains input change with validation
  const handleDomainsChange = (input: string) => {
    // Mark that user is actively editing
    setDomainsUserEditing(true);

    // Store raw input for display (allows typing commas)
    setDomainsRawInput(input);

    // Parse domains for validation and storage
    const domains = input.split(',').map(d => d.trim()).filter(Boolean);

    // Validate each non-empty domain
    const invalidDomains = domains.filter(d => !DOMAIN_REGEX.test(d));

    if (invalidDomains.length > 0) {
      setDomainError(`Invalid domain(s): ${invalidDomains.join(', ')}`);
    } else {
      setDomainError(null);
    }

    // Store as array in config (only non-empty entries)
    setConfigArrayValue('includeDomains', domains);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Messages */}
      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-lg flex items-center gap-3">
          <AlertCircle size={20} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">&times;</button>
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-50 text-green-600 rounded-lg flex items-center gap-3">
          <CheckCircle size={20} />
          <span>{success}</span>
        </div>
      )}

      {/* Settings Panel - Admin only */}
      {!isSuperuser && (
        <div className="bg-white rounded-lg border shadow-sm">
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Settings className="text-gray-600" size={20} />
              <div>
                <h2 className="font-semibold text-gray-900">Skills Settings</h2>
                <p className="text-sm text-gray-500">Configure the modular skills system</p>
              </div>
            </div>
            <Button onClick={handleSaveSettings} disabled={saving}>
              {saving ? <Spinner size="sm" className="mr-2" /> : <Save size={16} className="mr-2" />}
              Save Settings
            </Button>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="font-medium">Enable Skills</span>
                <p className="text-sm text-gray-500">Activate the modular skills system</p>
              </div>
            </label>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Total Tokens</label>
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium text-gray-900">{settings.maxTotalTokens.toLocaleString()}</span>
                <span className="text-xs text-gray-400">tokens</span>
              </div>
              <p className="text-xs text-blue-500 mt-1">Configure in Settings → Limits → Token Limits</p>
            </div>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.debugMode}
                onChange={(e) => setSettings({ ...settings, debugMode: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="font-medium">Debug Mode</span>
                <p className="text-sm text-gray-500">Log skill activation details</p>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Skills List */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Layers className="text-gray-600" size={20} />
            <div>
              <h2 className="font-semibold text-gray-900">Skills</h2>
              <p className="text-sm text-gray-500">{skills.length} skills configured</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isSuperuser && (
              <Button variant="secondary" onClick={() => setShowRestoreModal(true)} title="Restore core skills to config defaults">
                <RotateCcw size={16} className="mr-2" />
                Restore Defaults
              </Button>
            )}
            <Button variant="secondary" onClick={() => setShowPreviewModal(true)}>
              <Eye size={16} className="mr-2" />
              Preview
            </Button>
            <Button onClick={() => {
              setFormData({
                ...initialFormData,
                trigger_type: isSuperuser ? 'keyword' : 'keyword',
                priority: isSuperuser ? PRIORITY_SUPERUSER_MIN : 100,
              });
              setShowCreateModal(true);
            }}>
              <Plus size={16} className="mr-2" />
              Add Skill
            </Button>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="px-6 py-3 border-b bg-gray-50 flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search skills..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <select
            value={filterTriggerType}
            onChange={(e) => setFilterTriggerType(e.target.value as 'all' | 'always' | 'category' | 'keyword')}
            className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All Triggers</option>
            <option value="always">Always</option>
            <option value="category">Category</option>
            <option value="keyword">Keyword</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'all' | 'active' | 'inactive')}
            className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select
            value={filterHasTool}
            onChange={(e) => setFilterHasTool(e.target.value as 'all' | 'with-tool' | 'no-tool')}
            className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All Tools</option>
            <option value="with-tool">With Tool</option>
            <option value="no-tool">No Tool</option>
          </select>
        </div>

        {/* Skills Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th
                  className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16 cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('id')}
                >
                  <div className="flex items-center gap-1">
                    ID
                    {sortBy === 'id' ? (
                      sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                    ) : (
                      <ArrowUpDown size={12} className="text-gray-300" />
                    )}
                  </div>
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-1">
                    Name
                    {sortBy === 'name' ? (
                      sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                    ) : (
                      <ArrowUpDown size={12} className="text-gray-300" />
                    )}
                  </div>
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('trigger')}
                >
                  <div className="flex items-center gap-1">
                    Trigger
                    {sortBy === 'trigger' ? (
                      sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                    ) : (
                      <ArrowUpDown size={12} className="text-gray-300" />
                    )}
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Categories</th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('priority')}
                >
                  <div className="flex items-center gap-1">
                    Priority
                    {sortBy === 'priority' ? (
                      sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                    ) : (
                      <ArrowUpDown size={12} className="text-gray-300" />
                    )}
                  </div>
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('tokens')}
                >
                  <div className="flex items-center gap-1">
                    Tokens
                    {sortBy === 'tokens' ? (
                      sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                    ) : (
                      <ArrowUpDown size={12} className="text-gray-300" />
                    )}
                  </div>
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('status')}
                >
                  <div className="flex items-center gap-1">
                    Status
                    {sortBy === 'status' ? (
                      sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                    ) : (
                      <ArrowUpDown size={12} className="text-gray-300" />
                    )}
                  </div>
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredSkills.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                    No skills found. Create your first skill to get started.
                  </td>
                </tr>
              ) : (
                filteredSkills.map((skill) => (
                  <tr key={skill.id} className={`hover:bg-gray-50 ${!skill.is_active ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-4 text-sm text-gray-500 font-mono">{skill.id}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {skill.is_core && <span title="Core skill"><Lock size={14} className="text-amber-500" /></span>}
                        {skill.tool_name && (
                          <span title={`Forces tool: ${skill.tool_name} (${skill.force_mode})`}>
                            <Zap size={14} className="text-orange-500" />
                          </span>
                        )}
                        <div>
                          <div className="font-medium text-gray-900">{skill.name}</div>
                          {skill.description && (
                            <div className="text-sm text-gray-500 truncate max-w-xs">{skill.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        {getTriggerBadge(skill.trigger_type)}
                        {skill.trigger_value && (
                          <span className="text-xs text-gray-500 truncate max-w-[150px]" title={skill.trigger_value}>
                            {skill.trigger_value}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {skill.categories.length > 0 ? (
                          skill.categories.slice(0, 2).map((cat) => (
                            <span key={cat.id} className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-full">
                              {cat.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-400 text-sm">-</span>
                        )}
                        {skill.categories.length > 2 && (
                          <span className="text-xs text-gray-500">+{skill.categories.length - 2}</span>
                        )}
                        {skill.category_restricted && (
                          <span title="Category restricted" className="text-amber-500">
                            <Lock size={12} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4"><PriorityBadge priority={skill.priority} /></td>
                    <td className="px-6 py-4 text-sm text-gray-500">{skill.token_estimate || '~'}</td>
                    <td className="px-6 py-4">
                      {skill.is_active ? (
                        <span className="inline-flex items-center gap-1 text-green-600">
                          <Power size={14} /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-gray-400">
                          <PowerOff size={14} /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                        // Superusers can only modify skills they created (priority >= 100 and not core)
                        const isAdminSkill = skill.is_core || skill.priority < PRIORITY_SUPERUSER_MIN;
                        const canModify = !isSuperuser || !isAdminSkill;

                        return (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleToggleActive(skill)}
                              className={`p-1 ${canModify ? 'text-gray-400 hover:text-blue-600' : 'text-gray-200 cursor-not-allowed'}`}
                              title={!canModify ? 'Cannot modify admin skill' : (skill.is_active ? 'Deactivate' : 'Activate')}
                              disabled={!canModify}
                            >
                              {skill.is_active ? <PowerOff size={16} /> : <Power size={16} />}
                            </button>
                            <button
                              onClick={() => openEditModal(skill)}
                              className={`p-1 ${canModify ? 'text-gray-400 hover:text-blue-600' : 'text-gray-200 cursor-not-allowed'}`}
                              title={!canModify ? 'Cannot edit admin skill' : 'Edit'}
                              disabled={!canModify}
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => { setSelectedSkill(skill); setShowDeleteModal(true); }}
                              className={`p-1 ${canModify ? 'text-gray-400 hover:text-red-600' : 'text-gray-200 cursor-not-allowed'}`}
                              title={!canModify ? 'Cannot delete admin skill' : 'Delete'}
                              disabled={!canModify}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showCreateModal || showEditModal}
        onClose={() => { setShowCreateModal(false); setShowEditModal(false); setSelectedSkill(null); }}
        title={showEditModal ? 'Edit Skill' : 'Create Skill'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., Citation Style Guide"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Brief description of what this skill does"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Trigger Type *</label>
            <select
              value={formData.trigger_type}
              onChange={(e) => setFormData({ ...formData, trigger_type: e.target.value as 'always' | 'category' | 'keyword' })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {!isSuperuser && (
                <option value="always">Always (runs on every query)</option>
              )}
              <option value="category">Category (runs for specific categories)</option>
              <option value="keyword">Keyword (runs when keywords match)</option>
            </select>
            {isSuperuser && (
              <p className="text-xs text-amber-600 mt-1">
                Note: &quot;Always&quot; trigger type is reserved for admin-defined global skills.
              </p>
            )}
          </div>

          {formData.trigger_type === 'keyword' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Keywords *</label>
              <input
                type="text"
                value={formData.trigger_value}
                onChange={(e) => setFormData({ ...formData, trigger_value: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="citation, reference, quote (comma-separated)"
              />
              <p className="text-xs text-gray-500 mt-1">Comma-separated keywords that trigger this skill</p>
            </div>
          )}

          {(formData.trigger_type === 'category' || formData.trigger_type === 'keyword') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Categories {formData.trigger_type === 'category' ? '*' : '(optional)'}
              </label>
              <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                {categories.map((cat) => (
                  <label key={cat.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.category_ids.includes(cat.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({ ...formData, category_ids: [...formData.category_ids, cat.id] });
                        } else {
                          setFormData({ ...formData, category_ids: formData.category_ids.filter(id => id !== cat.id) });
                        }
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">{cat.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {formData.trigger_type === 'keyword' && formData.category_ids.length > 0 && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.category_restricted}
                onChange={(e) => setFormData({ ...formData, category_restricted: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm">Only activate if keyword matches AND category matches</span>
            </label>
          )}

          {formData.trigger_type === 'category' && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_index}
                onChange={(e) => setFormData({ ...formData, is_index: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm">Index skill (broader domain expertise, one per category)</span>
            </label>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
            <input
              type="number"
              value={formData.priority}
              min={isSuperuser ? PRIORITY_SUPERUSER_MIN : 1}
              onChange={(e) => {
                const value = parseInt(e.target.value) || 100;
                // Enforce minimum for superusers
                const minValue = isSuperuser ? PRIORITY_SUPERUSER_MIN : 1;
                setFormData({ ...formData, priority: Math.max(value, minValue) });
              }}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="text-xs mt-2 space-y-2">
              <p className="text-gray-500">Lower numbers = higher priority.</p>
              {/* Priority tier guide */}
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full" title="Priority 1-9: Core system skills (Admin only)">
                  1-9 Core
                </span>
                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full" title="Priority 10-99: High priority skills (Admin only)">
                  10-99 High
                </span>
                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full" title="Priority 100-499: Medium priority skills (Superuser)">
                  100-499 Medium
                </span>
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full" title="Priority 500+: Low priority skills (Superuser)">
                  500+ Low
                </span>
              </div>
              {isSuperuser ? (
                <p className="text-amber-600">
                  Priority 1-{PRIORITY_ADMIN_MAX} is reserved for admin skills.
                  Superusers must use priority {PRIORITY_SUPERUSER_MIN} or higher.
                </p>
              ) : (
                <p className="text-blue-600">
                  1-29 (Core/High) reserved for global skills. Superusers can only use 100+.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Prompt Content *</label>
            <textarea
              value={formData.prompt_content}
              onChange={(e) => setFormData({ ...formData, prompt_content: e.target.value })}
              rows={8}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
              placeholder="Enter the prompt instructions for this skill..."
            />
            <p className="text-xs text-gray-500 mt-1">
              Estimated tokens: ~{Math.ceil(formData.prompt_content.length / 4)}
            </p>
          </div>

          {/* Tool Routing Section - Only for keyword trigger type */}
          {formData.trigger_type === 'keyword' && (
            <div className="border-t pt-4 mt-4">
              <div className="flex items-center gap-2 mb-4">
                <Zap size={18} className="text-amber-500" />
                <h3 className="font-medium text-gray-900">Tool Action (Optional)</h3>
              </div>

              <div className="space-y-4 pl-6">
                {/* Match Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Match Type</label>
                  <select
                    value={formData.match_type}
                    onChange={(e) => setFormData({ ...formData, match_type: e.target.value as MatchType })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="keyword">Keyword (word boundary matching)</option>
                    <option value="regex">Regex (regular expression)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {formData.match_type === 'keyword'
                      ? 'Matches whole words only (e.g., "chart" matches "create a chart" but not "flowchart")'
                      : 'Use regular expressions for flexible pattern matching'}
                  </p>
                </div>

                {/* Tool Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Force Tool</label>
                  <select
                    value={formData.tool_name}
                    onChange={(e) => setFormData({ ...formData, tool_name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">No tool forcing (prompt only)</option>
                    {tools.filter(t => t.enabled).map((tool) => (
                      <option key={tool.name} value={tool.name}>
                        {tool.displayName || tool.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Select a tool to force when this skill is triggered
                  </p>
                </div>

                {/* Force Mode - Only show when tool is selected */}
                {formData.tool_name && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Force Mode</label>
                      <select
                        value={formData.force_mode}
                        onChange={(e) => setFormData({ ...formData, force_mode: e.target.value as ForceMode })}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="required">Required (always call this tool)</option>
                        <option value="preferred">Preferred (strongly encourage tool use)</option>
                        <option value="suggested">Suggested (hint to use tool)</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        {formData.force_mode === 'required' && 'The LLM must call this specific tool'}
                        {formData.force_mode === 'preferred' && 'The LLM is strongly encouraged to call a tool'}
                        {formData.force_mode === 'suggested' && 'The LLM may choose to call the tool or not'}
                      </p>
                    </div>

                    {/* Tool Configuration */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tool Configuration
                      </label>

                      {/* diagram_gen: Preferred Diagram Type */}
                      {formData.tool_name === 'diagram_gen' && (
                        <div className="mb-3">
                          <label className="block text-xs text-gray-600 mb-1">Preferred Diagram Type</label>
                          <select
                            value={getConfigValue('preferredType')}
                            onChange={(e) => setConfigValue('preferredType', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">Auto-detect (default)</option>
                            <option value="flowchart">Flowchart / Process</option>
                            <option value="sequence">Sequence Diagram</option>
                            <option value="mindmap">Mindmap</option>
                            <option value="c4-context">Architecture (C4 Context)</option>
                            <option value="c4-container">Architecture (C4 Container)</option>
                            <option value="gantt">Gantt Chart</option>
                            <option value="stateDiagram">State Diagram</option>
                            <option value="classDiagram">Class Diagram</option>
                            <option value="erDiagram">ER Diagram</option>
                          </select>
                        </div>
                      )}

                      {/* chart_gen: Default Chart Type */}
                      {formData.tool_name === 'chart_gen' && (
                        <div className="mb-3">
                          <label className="block text-xs text-gray-600 mb-1">Default Chart Type</label>
                          <select
                            value={getConfigValue('defaultChartType')}
                            onChange={(e) => setConfigValue('defaultChartType', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">Use tool default</option>
                            <option value="bar">Bar Chart</option>
                            <option value="line">Line Chart</option>
                            <option value="pie">Pie Chart</option>
                            <option value="area">Area Chart</option>
                            <option value="scatter">Scatter Plot</option>
                            <option value="radar">Radar Chart</option>
                            <option value="table">Table</option>
                          </select>
                        </div>
                      )}

                      {/* image_gen: Default Style */}
                      {formData.tool_name === 'image_gen' && (
                        <div className="mb-3">
                          <label className="block text-xs text-gray-600 mb-1">Default Style</label>
                          <select
                            value={getConfigValue('defaultStyle')}
                            onChange={(e) => setConfigValue('defaultStyle', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">Use tool default</option>
                            <option value="infographic">Infographic</option>
                            <option value="diagram">Diagram</option>
                            <option value="illustration">Illustration</option>
                            <option value="photo">Photo-realistic</option>
                            <option value="icon">Icon</option>
                            <option value="chart">Chart</option>
                            <option value="process-flow">Process Flow</option>
                          </select>
                        </div>
                      )}

                      {/* doc_gen: Default Format */}
                      {formData.tool_name === 'doc_gen' && (
                        <div className="mb-3">
                          <label className="block text-xs text-gray-600 mb-1">Default Format</label>
                          <select
                            value={getConfigValue('defaultFormat')}
                            onChange={(e) => setConfigValue('defaultFormat', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">Use tool default</option>
                            <option value="pdf">PDF</option>
                            <option value="docx">Word Document (DOCX)</option>
                            <option value="md">Markdown</option>
                          </select>
                        </div>
                      )}

                      {/* data_source: Data Source Selection */}
                      {formData.tool_name === 'data_source' && (dataSources.apis.length > 0 || dataSources.csvs.length > 0) && (
                        <div className="mb-3">
                          <label className="block text-xs text-gray-600 mb-1">Restrict to Data Sources (optional)</label>
                          <select
                            multiple
                            value={getConfigArrayValue('sourceIds')}
                            onChange={(e) => setConfigArrayValue('sourceIds',
                              Array.from(e.target.selectedOptions, opt => opt.value)
                            )}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-32"
                          >
                            {dataSources.csvs.length > 0 && (
                              <optgroup label="CSV Sources">
                                {dataSources.csvs.map(csv => (
                                  <option key={csv.id} value={csv.id}>{csv.name}</option>
                                ))}
                              </optgroup>
                            )}
                            {dataSources.apis.length > 0 && (
                              <optgroup label="API Sources">
                                {dataSources.apis.map(api => (
                                  <option key={api.id} value={api.id}>{api.name}</option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                          <p className="text-xs text-gray-500 mt-1">
                            Leave empty to allow all sources. Hold Ctrl/Cmd to select multiple.
                          </p>
                        </div>
                      )}

                      {/* function_api: Function API Selection */}
                      {formData.tool_name === 'function_api' && functionApis.length > 0 && (
                        <div className="mb-3">
                          <label className="block text-xs text-gray-600 mb-1">Restrict to Function API (optional)</label>
                          <select
                            value={getConfigValue('functionApiId')}
                            onChange={(e) => setConfigValue('functionApiId', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">All Function APIs</option>
                            {functionApis.map(api => (
                              <option key={api.id} value={api.id}>
                                {api.name} ({api.toolsSchema?.length || 0} functions)
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-gray-500 mt-1">
                            Select a specific API or leave empty to allow all.
                          </p>
                        </div>
                      )}

                      {/* web_search: Include Domains */}
                      {formData.tool_name === 'web_search' && (
                        <div className="mb-3">
                          <label className="block text-xs text-gray-600 mb-1">Include Domains (optional)</label>
                          <input
                            type="text"
                            value={domainsRawInput}
                            onChange={(e) => handleDomainsChange(e.target.value)}
                            placeholder="*.gov.tt, example.com"
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            Comma-separated. Use *.domain for wildcards (e.g., *.gov.tt matches all gov.tt subdomains).
                          </p>
                          {domainError && (
                            <p className="text-xs text-red-600 mt-1">{domainError}</p>
                          )}
                        </div>
                      )}

                      {/* podcast_gen: Style and Length */}
                      {formData.tool_name === 'podcast_gen' && (
                        <>
                          <div className="mb-3">
                            <label className="block text-xs text-gray-600 mb-1">Podcast Style</label>
                            <select
                              value={getConfigValue('style')}
                              onChange={(e) => setConfigValue('style', e.target.value)}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                              <option value="">Use tool default</option>
                              <option value="formal">Formal - Professional and authoritative</option>
                              <option value="conversational">Conversational - Friendly and approachable</option>
                              <option value="news">News - Clear and objective broadcast style</option>
                            </select>
                          </div>
                          <div className="mb-3">
                            <label className="block text-xs text-gray-600 mb-1">Podcast Length</label>
                            <select
                              value={getConfigValue('length')}
                              onChange={(e) => setConfigValue('length', e.target.value)}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                              <option value="">Use tool default</option>
                              <option value="short">Short (1-2 minutes)</option>
                              <option value="medium">Medium (3-5 minutes)</option>
                              <option value="long">Long (8-10 minutes)</option>
                            </select>
                          </div>
                        </>
                      )}

                      {/* Advanced JSON toggle for power users */}
                      <details className="mt-2">
                        <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-800">
                          Advanced: Edit raw JSON
                        </summary>
                        <div className="mt-2">
                          <textarea
                            value={formData.tool_config_override}
                            onChange={(e) => setFormData({ ...formData, tool_config_override: e.target.value })}
                            rows={3}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                            placeholder='{"key": "value"}'
                          />
                          {formData.tool_config_override && (() => {
                            try {
                              JSON.parse(formData.tool_config_override);
                              return <p className="text-xs text-green-600 mt-1">Valid JSON</p>;
                            } catch {
                              return <p className="text-xs text-red-600 mt-1">Invalid JSON format</p>;
                            }
                          })()}
                        </div>
                      </details>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Compliance Configuration Section */}
          <div className="border-t pt-4 mt-4">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={18} className="text-green-500" />
              <h3 className="font-medium text-gray-900">Compliance Validation</h3>
              <span className="text-xs text-gray-500">(Optional)</span>
            </div>

            <div className="space-y-4 pl-6">
              {/* Enable Toggle */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="compliance_enabled"
                  checked={formData.compliance_enabled || false}
                  onChange={(e) => setFormData({ ...formData, compliance_enabled: e.target.checked })}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <label htmlFor="compliance_enabled" className="text-sm text-gray-700">
                  Enable compliance checking for this skill
                </label>
              </div>
              <p className="text-xs text-gray-500 -mt-2 ml-6">
                When enabled, responses using this skill will be validated against compliance rules.
              </p>

              {/* Show additional fields only when enabled */}
              {formData.compliance_enabled && (
                <div className="space-y-4 border-l-2 border-green-200 pl-4 mt-4">
                  {/* Required Sections */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Required Sections
                    </label>
                    <input
                      type="text"
                      value={formData.compliance_sections || ''}
                      onChange={(e) => setFormData({ ...formData, compliance_sections: e.target.value })}
                      placeholder="## Summary, ## Analysis, ## Recommendations"
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Markdown headings that must be present in the response. Comma-separated.
                    </p>
                  </div>

                  {/* Threshold Overrides */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Pass Threshold
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={formData.compliance_passThreshold ?? ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          compliance_passThreshold: e.target.value ? parseInt(e.target.value) : undefined
                        })}
                        placeholder="80 (default)"
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Warning Threshold
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={formData.compliance_warnThreshold ?? ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          compliance_warnThreshold: e.target.value ? parseInt(e.target.value) : undefined
                        })}
                        placeholder="50 (default)"
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 -mt-2">
                    Leave empty to use global defaults. Pass threshold should be higher than warning threshold.
                  </p>

                  {/* Clarification Instructions */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Custom Clarification Instructions
                    </label>
                    <textarea
                      value={formData.compliance_clarificationInstructions || ''}
                      onChange={(e) => setFormData({ ...formData, compliance_clarificationInstructions: e.target.value })}
                      placeholder="For financial reports, prioritize asking about data recency. For legal documents, ask about jurisdiction."
                      rows={2}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Custom instructions injected into the LLM prompt when generating clarification questions.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="secondary" onClick={() => { setShowCreateModal(false); setShowEditModal(false); setSelectedSkill(null); }}>
              Cancel
            </Button>
            <Button onClick={showEditModal ? handleUpdate : handleCreate} disabled={saving}>
              {saving ? <Spinner size="sm" className="mr-2" /> : null}
              {showEditModal ? 'Update' : 'Create'} Skill
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setSelectedSkill(null); }}
        title="Delete Skill"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            Are you sure you want to delete <strong>{selectedSkill?.name}</strong>? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setShowDeleteModal(false); setSelectedSkill(null); }}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={saving}>
              {saving ? <Spinner size="sm" className="mr-2" /> : null}
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      {/* Preview Modal */}
      <Modal
        isOpen={showPreviewModal}
        onClose={() => { setShowPreviewModal(false); setPreviewResult(null); }}
        title="Preview Skill Activation"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Test Message</label>
            <input
              type="text"
              value={previewMessage}
              onChange={(e) => setPreviewMessage(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter a test message to see which skills would activate"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Categories (optional)</label>
            <div className="border rounded-lg p-3 max-h-32 overflow-y-auto space-y-2">
              {categories.map((cat) => (
                <label key={cat.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={previewCategoryIds.includes(cat.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setPreviewCategoryIds([...previewCategoryIds, cat.id]);
                      } else {
                        setPreviewCategoryIds(previewCategoryIds.filter(id => id !== cat.id));
                      }
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm">{cat.name}</span>
                </label>
              ))}
            </div>
          </div>

          <Button onClick={handlePreview} disabled={previewLoading || !previewMessage.trim()}>
            {previewLoading ? <Spinner size="sm" className="mr-2" /> : <Play size={16} className="mr-2" />}
            Run Preview
          </Button>

          {previewResult && (
            <div className="border-t pt-4 mt-4">
              <h4 className="font-medium text-gray-900 mb-2">Results</h4>
              {previewResult.wouldActivate.length === 0 ? (
                <p className="text-gray-500">No skills would activate for this query.</p>
              ) : (
                <div className="space-y-2">
                  {previewResult.wouldActivate.map((skill, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <div className="flex items-center gap-2">
                        <Zap size={14} className="text-amber-500" />
                        <span className="font-medium">{skill.name}</span>
                        {getTriggerBadge(skill.trigger)}
                      </div>
                      <span className="text-sm text-gray-500">~{skill.tokens} tokens</span>
                    </div>
                  ))}
                  <div className={`flex items-center justify-between p-2 rounded ${previewResult.exceedsLimit ? 'bg-red-50' : 'bg-green-50'}`}>
                    <span className="font-medium">Total</span>
                    <span className={previewResult.exceedsLimit ? 'text-red-600' : 'text-green-600'}>
                      {previewResult.totalTokens} / {settings.maxTotalTokens} tokens
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Restore Defaults Confirmation Modal */}
      <Modal
        isOpen={showRestoreModal}
        onClose={() => setShowRestoreModal(false)}
        title="Restore Core Skills to Defaults"
      >
        <div className="space-y-4">
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-amber-800">
              This will delete all core skills and reload them from the config files
              (<code className="text-xs bg-amber-100 px-1 rounded">config/skills.json</code> and
              <code className="text-xs bg-amber-100 px-1 rounded">config/skills/*.md</code>).
            </p>
          </div>
          <p className="text-gray-600">
            Custom skills (non-core) will <strong>not</strong> be affected.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowRestoreModal(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRestoreDefaults} disabled={saving}>
              {saving ? <Spinner size="sm" className="mr-2" /> : <RotateCcw size={16} className="mr-2" />}
              Restore Defaults
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

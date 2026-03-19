'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Zap,
  Plus,
  Settings,
  Trash2,
  TestTube,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle,
  X,
  Save,
  RefreshCw,
  Code,
  Link2,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import type { FunctionAPIConfig, FunctionAPIAuthType, EndpointMapping } from '@/types/function-api';
import type OpenAI from 'openai';

// ===== Types =====

interface Category {
  id: number;
  name: string;
  slug: string;
}

// ===== Helper Functions =====

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-green-100 text-green-700';
    case 'error':
      return 'bg-red-100 text-red-700';
    case 'inactive':
      return 'bg-gray-100 text-gray-600';
    default:
      return 'bg-yellow-100 text-yellow-700';
  }
}

// ===== Function API Card =====

function FunctionAPICard({
  config,
  categories,
  onEdit,
  onDelete,
  onTest,
  testResult,
}: {
  config: FunctionAPIConfig;
  categories: Category[];
  onEdit: (config: FunctionAPIConfig) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  testResult?: { success: boolean; message: string } | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const linkedCategories = categories.filter(c => config.categoryIds.includes(c.id));
  const functionCount = config.toolsSchema.length;
  const functionNames = config.toolsSchema.map(t => t.function.name);

  return (
    <div className="bg-white rounded-lg border shadow-sm">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`p-2 rounded-lg ${config.status === 'active' ? 'bg-purple-100' : 'bg-gray-100'}`}>
            <Zap size={20} className={config.status === 'active' ? 'text-purple-600' : 'text-gray-400'} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-gray-900 truncate">{config.name}</h4>
              <span className={`px-2 py-0.5 text-xs rounded-full ${getStatusColor(config.status)}`}>
                {config.status}
              </span>
              <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full">
                {functionCount} function{functionCount !== 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-sm text-gray-500 truncate">{config.baseUrl}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <Button variant="secondary" size="sm" onClick={() => onTest(config.id)} title="Test connection">
            <TestTube size={14} />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onEdit(config)} title="Edit">
            <Settings size={14} />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onDelete(config.id)} title="Delete">
            <Trash2 size={14} />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
        </div>
      </div>

      {testResult && (
        <div className={`mx-4 mb-2 px-3 py-2 rounded text-sm ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {testResult.success ? <CheckCircle size={14} className="inline mr-2" /> : <AlertCircle size={14} className="inline mr-2" />}
          {testResult.message}
        </div>
      )}

      {expanded && (
        <div className="px-4 py-3 border-t bg-gray-50 text-sm">
          {config.description && (
            <p className="text-gray-600 mb-2">{config.description}</p>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs mb-2">
            <div>
              <span className="text-gray-500">Auth Type:</span>
              <span className="ml-1 capitalize">{config.authType.replace('_', ' ')}</span>
            </div>
            <div>
              <span className="text-gray-500">Timeout:</span>
              <span className="ml-1">{config.timeoutSeconds}s</span>
            </div>
            <div>
              <span className="text-gray-500">Cache TTL:</span>
              <span className="ml-1">{config.cacheTTLSeconds}s</span>
            </div>
            <div>
              <span className="text-gray-500">Enabled:</span>
              <span className="ml-1">{config.isEnabled ? 'Yes' : 'No'}</span>
            </div>
          </div>
          <div className="mt-2">
            <span className="text-gray-500 text-xs">Functions:</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {functionNames.map(name => (
                <span key={name} className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded font-mono">
                  {name}
                </span>
              ))}
            </div>
          </div>
          {linkedCategories.length > 0 && (
            <div className="mt-2">
              <span className="text-gray-500 text-xs">Categories:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {linkedCategories.map(c => (
                  <span key={c.id} className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {config.lastError && (
            <div className="mt-2 text-xs text-red-600">
              <AlertCircle size={12} className="inline mr-1" />
              {config.lastError}
            </div>
          )}
          <div className="mt-2 text-xs text-gray-400">
            Created: {formatDate(config.createdAt)}
            {config.lastTested && ` • Tested: ${formatDate(config.lastTested)}`}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Create/Edit Modal =====

interface FunctionAPIFormData {
  name: string;
  description: string;
  baseUrl: string;
  authType: FunctionAPIAuthType;
  authHeader: string;
  authCredentials: string;
  toolsSchemaJson: string;
  endpointMappingsJson: string;
  timeoutSeconds: number;
  cacheTTLSeconds: number;
  isEnabled: boolean;
  categoryIds: number[];
}

function FunctionAPIFormModal({
  isOpen,
  onClose,
  onSave,
  editingConfig,
  categories,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: FunctionAPIFormData) => Promise<void>;
  editingConfig?: FunctionAPIConfig | null;
  categories: Category[];
}) {
  const [formData, setFormData] = useState<FunctionAPIFormData>({
    name: '',
    description: '',
    baseUrl: '',
    authType: 'api_key',
    authHeader: 'X-API-Key',
    authCredentials: '',
    toolsSchemaJson: '[\n  {\n    "type": "function",\n    "function": {\n      "name": "example_function",\n      "description": "Description here",\n      "parameters": {\n        "type": "object",\n        "properties": {}\n      }\n    }\n  }\n]',
    endpointMappingsJson: '{\n  "example_function": {\n    "method": "GET",\n    "path": "/example"\n  }\n}',
    timeoutSeconds: 30,
    cacheTTLSeconds: 3600,
    isEnabled: true,
    categoryIds: [],
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [mappingsError, setMappingsError] = useState<string | null>(null);

  // Populate form when editing
  useEffect(() => {
    if (editingConfig) {
      setFormData({
        name: editingConfig.name,
        description: editingConfig.description,
        baseUrl: editingConfig.baseUrl,
        authType: editingConfig.authType,
        authHeader: editingConfig.authHeader || 'X-API-Key',
        authCredentials: '', // Don't show masked credentials
        toolsSchemaJson: JSON.stringify(editingConfig.toolsSchema, null, 2),
        endpointMappingsJson: JSON.stringify(editingConfig.endpointMappings, null, 2),
        timeoutSeconds: editingConfig.timeoutSeconds,
        cacheTTLSeconds: editingConfig.cacheTTLSeconds,
        isEnabled: editingConfig.isEnabled,
        categoryIds: editingConfig.categoryIds,
      });
    } else {
      setFormData({
        name: '',
        description: '',
        baseUrl: '',
        authType: 'api_key',
        authHeader: 'X-API-Key',
        authCredentials: '',
        toolsSchemaJson: '[\n  {\n    "type": "function",\n    "function": {\n      "name": "example_function",\n      "description": "Description here",\n      "parameters": {\n        "type": "object",\n        "properties": {}\n      }\n    }\n  }\n]',
        endpointMappingsJson: '{\n  "example_function": {\n    "method": "GET",\n    "path": "/example"\n  }\n}',
        timeoutSeconds: 30,
        cacheTTLSeconds: 3600,
        isEnabled: true,
        categoryIds: [],
      });
    }
    setErrors([]);
    setSchemaError(null);
    setMappingsError(null);
  }, [editingConfig, isOpen]);

  const validateSchema = (json: string): boolean => {
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) {
        setSchemaError('Schema must be an array of tool definitions');
        return false;
      }
      for (const tool of parsed) {
        if (tool.type !== 'function' || !tool.function?.name) {
          setSchemaError('Each tool must have type="function" and a function.name');
          return false;
        }
      }
      setSchemaError(null);
      return true;
    } catch {
      setSchemaError('Invalid JSON format');
      return false;
    }
  };

  const validateMappings = (json: string): boolean => {
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        setMappingsError('Mappings must be an object');
        return false;
      }
      for (const [, mapping] of Object.entries(parsed)) {
        const m = mapping as EndpointMapping;
        if (!['GET', 'POST', 'PUT', 'DELETE'].includes(m.method)) {
          setMappingsError('Method must be GET, POST, PUT, or DELETE');
          return false;
        }
        if (!m.path?.startsWith('/')) {
          setMappingsError('Path must start with /');
          return false;
        }
      }
      setMappingsError(null);
      return true;
    } catch {
      setMappingsError('Invalid JSON format');
      return false;
    }
  };

  const handleSubmit = async () => {
    setErrors([]);

    // Validate
    const newErrors: string[] = [];
    if (!formData.name.trim()) newErrors.push('Name is required');
    if (!formData.baseUrl.trim()) newErrors.push('Base URL is required');
    if (!validateSchema(formData.toolsSchemaJson)) newErrors.push('Fix schema errors');
    if (!validateMappings(formData.endpointMappingsJson)) newErrors.push('Fix mappings errors');

    if (newErrors.length > 0) {
      setErrors(newErrors);
      return;
    }

    if (formData.categoryIds.length === 0) {
      const confirmed = window.confirm(
        'No categories selected. This API will not be accessible in any chat until at least one category is assigned. Save anyway?'
      );
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      await onSave(formData);
      onClose();
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Failed to save']);
    } finally {
      setSaving(false);
    }
  };

  const handleCategoryToggle = (categoryId: number) => {
    setFormData(prev => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(categoryId)
        ? prev.categoryIds.filter(id => id !== categoryId)
        : [...prev.categoryIds, categoryId],
    }));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingConfig ? 'Edit Function API' : 'Create Function API'}
      allowOverflow
    >
      <div className="space-y-4 max-h-[70vh] overflow-y-auto">
        {errors.length > 0 && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            <ul className="list-disc list-inside">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        {/* Basic Info */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              placeholder="GEA Analytics API"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Base URL *</label>
            <input
              type="text"
              value={formData.baseUrl}
              onChange={e => setFormData(p => ({ ...p, baseUrl: e.target.value }))}
              className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
              placeholder="https://api.example.com"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={formData.description}
            onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
            className="w-full px-3 py-2 border rounded-lg text-sm"
            rows={2}
            placeholder="API for government experience analytics..."
          />
        </div>

        {/* Authentication */}
        <div className="p-4 bg-gray-50 rounded-lg space-y-3">
          <h4 className="font-medium text-gray-900 flex items-center gap-2">
            <Link2 size={16} /> Authentication
          </h4>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Auth Type</label>
              <select
                value={formData.authType}
                onChange={e => setFormData(p => ({ ...p, authType: e.target.value as FunctionAPIAuthType }))}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="api_key">API Key</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic Auth</option>
                <option value="none">None</option>
              </select>
            </div>
            {formData.authType === 'api_key' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Header Name</label>
                <input
                  type="text"
                  value={formData.authHeader}
                  onChange={e => setFormData(p => ({ ...p, authHeader: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                  placeholder="X-API-Key"
                />
              </div>
            )}
            {formData.authType !== 'none' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {formData.authType === 'basic' ? 'Credentials (user:pass)' : 'API Key / Token'}
                </label>
                <input
                  type="password"
                  value={formData.authCredentials}
                  onChange={e => setFormData(p => ({ ...p, authCredentials: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                  placeholder={editingConfig ? '(unchanged)' : 'Enter credentials'}
                />
              </div>
            )}
          </div>
        </div>

        {/* Tools Schema */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
            <Code size={16} /> Tools Schema (OpenAI format) *
          </label>
          <textarea
            value={formData.toolsSchemaJson}
            onChange={e => {
              setFormData(p => ({ ...p, toolsSchemaJson: e.target.value }));
              validateSchema(e.target.value);
            }}
            className={`w-full px-3 py-2 border rounded-lg text-sm font-mono ${schemaError ? 'border-red-500' : ''}`}
            rows={12}
            placeholder='[{"type": "function", "function": {...}}]'
          />
          {schemaError && <p className="mt-1 text-xs text-red-600">{schemaError}</p>}
          <p className="mt-1 text-xs text-gray-500">
            Paste your OpenAI-format tools array. Each tool must have type=&quot;function&quot; and a function object with name, description, and parameters.
          </p>
        </div>

        {/* Endpoint Mappings */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
            <Link2 size={16} /> Endpoint Mappings *
          </label>
          <textarea
            value={formData.endpointMappingsJson}
            onChange={e => {
              setFormData(p => ({ ...p, endpointMappingsJson: e.target.value }));
              validateMappings(e.target.value);
            }}
            className={`w-full px-3 py-2 border rounded-lg text-sm font-mono ${mappingsError ? 'border-red-500' : ''}`}
            rows={6}
            placeholder='{"function_name": {"method": "GET", "path": "/endpoint"}}'
          />
          {mappingsError && <p className="mt-1 text-xs text-red-600">{mappingsError}</p>}
          <p className="mt-1 text-xs text-gray-500">
            Map each function name to its HTTP endpoint. Method can be GET, POST, PUT, or DELETE.
          </p>
        </div>

        {/* Settings */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timeout (seconds)</label>
            <input
              type="number"
              value={formData.timeoutSeconds}
              onChange={e => setFormData(p => ({ ...p, timeoutSeconds: parseInt(e.target.value) || 30 }))}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              min={1}
              max={300}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cache TTL (seconds)</label>
            <input
              type="number"
              value={formData.cacheTTLSeconds}
              onChange={e => setFormData(p => ({ ...p, cacheTTLSeconds: parseInt(e.target.value) || 3600 }))}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              min={0}
              max={86400}
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.isEnabled}
                onChange={e => setFormData(p => ({ ...p, isEnabled: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm font-medium text-gray-700">Enabled</span>
            </label>
          </div>
        </div>

        {/* Categories */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Category Access</label>
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => handleCategoryToggle(cat.id)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  formData.categoryIds.includes(cat.id)
                    ? 'bg-purple-100 border-purple-300 text-purple-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
          {categories.length === 0 && (
            <p className="text-sm text-gray-500">No categories available. Create categories first.</p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? <><Spinner size="sm" /> Saving...</> : <><Save size={16} /> Save</>}
        </Button>
      </div>
    </Modal>
  );
}

// ===== Main Component =====

interface FunctionAPITabProps {
  apiBasePath?: string;
  categoriesPath?: string;
}

export default function FunctionAPITab({
  apiBasePath = '/api/admin/function-apis',
  categoriesPath = '/api/admin/categories',
}: FunctionAPITabProps) {
  // Data state
  const [functionApis, setFunctionApis] = useState<FunctionAPIConfig[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modal state
  const [showForm, setShowForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<FunctionAPIConfig | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [apisRes, categoriesRes] = await Promise.all([
        fetch(apiBasePath),
        fetch(categoriesPath),
      ]);

      if (!apisRes.ok) throw new Error('Failed to fetch function APIs');

      const apisData = await apisRes.json();
      setFunctionApis(apisData.functionApis || []);

      if (categoriesRes.ok) {
        const catData = await categoriesRes.json();
        setCategories(catData.categories || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [apiBasePath, categoriesPath]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Test connection
  const handleTest = async (id: string) => {
    setTestResults(prev => ({ ...prev, [id]: { success: false, message: 'Testing...' } }));
    try {
      const response = await fetch(`${apiBasePath}/${id}/test`, { method: 'POST' });
      const data = await response.json();
      setTestResults(prev => ({
        ...prev,
        [id]: { success: data.success, message: data.message },
      }));
      if (data.success) {
        fetchData(); // Refresh to update status
      }
    } catch (err) {
      setTestResults(prev => ({
        ...prev,
        [id]: { success: false, message: err instanceof Error ? err.message : 'Test failed' },
      }));
    }
  };

  // Delete
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this Function API?')) return;

    try {
      const response = await fetch(`${apiBasePath}/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete');
      }
      setSuccess('Function API deleted successfully');
      setTimeout(() => setSuccess(null), 3000);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  // Save (create or update)
  const handleSave = async (formData: FunctionAPIFormData) => {
    const toolsSchema = JSON.parse(formData.toolsSchemaJson) as OpenAI.Chat.ChatCompletionFunctionTool[];
    const endpointMappings = JSON.parse(formData.endpointMappingsJson) as Record<string, EndpointMapping>;

    const body = {
      name: formData.name,
      description: formData.description,
      baseUrl: formData.baseUrl,
      authType: formData.authType,
      authHeader: formData.authHeader,
      authCredentials: formData.authCredentials || undefined,
      toolsSchema,
      endpointMappings,
      timeoutSeconds: formData.timeoutSeconds,
      cacheTTLSeconds: formData.cacheTTLSeconds,
      isEnabled: formData.isEnabled,
      categoryIds: formData.categoryIds,
    };

    const url = editingConfig ? `${apiBasePath}/${editingConfig.id}` : apiBasePath;
    const method = editingConfig ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.details?.join(', ') || 'Failed to save');
    }

    setSuccess(editingConfig ? 'Function API updated successfully' : 'Function API created successfully');
    setTimeout(() => setSuccess(null), 3000);
    setShowForm(false);
    setEditingConfig(null);
    await fetchData();
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
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X size={18} />
          </button>
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-50 text-green-600 rounded-lg flex items-center gap-3">
          <CheckCircle size={20} />
          <span>{success}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Function Calling APIs</h3>
          <p className="text-sm text-gray-500">
            Configure OpenAI-format function schemas for structured API access
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={fetchData}>
            <RefreshCw size={16} />
          </Button>
          <Button onClick={() => { setEditingConfig(null); setShowForm(true); }}>
            <Plus size={16} /> Add Function API
          </Button>
        </div>
      </div>

      {/* List */}
      {functionApis.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Zap size={48} className="mx-auto text-gray-300 mb-4" />
          <h4 className="text-lg font-medium text-gray-900 mb-2">No Function APIs configured</h4>
          <p className="text-gray-500 mb-4">
            Add your first Function API to enable structured function calling
          </p>
          <Button onClick={() => { setEditingConfig(null); setShowForm(true); }}>
            <Plus size={16} /> Add Function API
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {functionApis.map(config => (
            <FunctionAPICard
              key={config.id}
              config={config}
              categories={categories}
              onEdit={config => { setEditingConfig(config); setShowForm(true); }}
              onDelete={handleDelete}
              onTest={handleTest}
              testResult={testResults[config.id]}
            />
          ))}
        </div>
      )}

      {/* Form Modal */}
      <FunctionAPIFormModal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditingConfig(null); }}
        onSave={handleSave}
        editingConfig={editingConfig}
        categories={categories}
      />
    </div>
  );
}

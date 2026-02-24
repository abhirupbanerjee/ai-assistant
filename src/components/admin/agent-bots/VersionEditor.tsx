'use client';

/**
 * Version Editor
 *
 * Form for creating and editing agent bot versions with:
 * - Input schema builder
 * - Output configuration
 * - Category/skill selection
 * - Tool configuration
 * - LLM settings
 */

import { useState, useEffect, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import {
  ALLOWED_FILE_TYPES,
  BASE_OUTPUT_TYPES,
  TOOL_OUTPUT_TYPES,
  PARAMETER_TYPES,
  ALL_OUTPUT_TYPES,
} from '@/lib/constants/agent-bot-config';

interface Version {
  id: string;
  agent_bot_id: string;
  version_number: number;
  version_label: string | null;
  is_default: boolean;
  is_active: boolean;
  input_schema: InputSchema;
  output_config: OutputConfig;
  system_prompt: string | null;
  llm_model: string | null;
  temperature: number | null;
  max_tokens: number | null;
  created_by: string;
  created_at: string;
  categories?: Array<{ id: number; name: string }>;
  skills?: Array<{ id: number; name: string }>;
  tools?: Array<{ tool_name: string; is_enabled: boolean; config_override?: Record<string, unknown> }>;
}

interface InputParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  maxLength?: number;
  minLength?: number;
}

interface InputSchema {
  parameters: InputParameter[];
  files?: {
    enabled: boolean;
    maxFiles?: number;
    maxSizePerFileMB?: number;
    allowedTypes?: string[];
    required?: boolean;
  };
}

interface OutputConfig {
  enabledTypes: string[];
  defaultType: string;
  jsonSchema?: Record<string, unknown>;
  fallback?: {
    enabled: boolean;
    type: string;
  };
}

interface Category {
  id: number;
  name: string;
  slug: string;
}

interface Skill {
  id: number;
  name: string;
  description: string | null;
}

interface EnabledModel {
  id: string;
  providerId: string;
  displayName: string;
  toolCapable: boolean;
  enabled: boolean;
  providerEnabled?: boolean;
  isDefault: boolean;
}

interface ToolInfo {
  name: string;
  displayName: string;
  description: string;
  category: 'autonomous' | 'processor';
  enabled: boolean;
}

interface VersionEditorProps {
  agentBotId: string;
  version?: Version;
  onSave: () => void;
  onCancel: () => void;
}


export default function VersionEditor({
  agentBotId,
  version,
  onSave,
  onCancel,
}: VersionEditorProps) {
  const isEditing = !!version;

  // Form state
  const [versionLabel, setVersionLabel] = useState(version?.version_label || '');
  const [isDefault, setIsDefault] = useState(version?.is_default || false);
  const [isActive, setIsActive] = useState(version?.is_active ?? true);
  const [systemPrompt, setSystemPrompt] = useState(version?.system_prompt || '');
  const [llmModel, setLlmModel] = useState(version?.llm_model || '');
  const [temperature, setTemperature] = useState<number | ''>(version?.temperature ?? '');
  const [maxTokens, setMaxTokens] = useState<number | ''>(version?.max_tokens ?? '');

  // Input schema state
  const [parameters, setParameters] = useState<InputParameter[]>(
    version?.input_schema?.parameters || [
      { name: 'query', type: 'string', description: 'The main query or request', required: true },
    ]
  );
  const [filesEnabled, setFilesEnabled] = useState(version?.input_schema?.files?.enabled || false);
  const [maxFiles, setMaxFiles] = useState(version?.input_schema?.files?.maxFiles || 5);
  const [maxFileSizeMB, setMaxFileSizeMB] = useState(version?.input_schema?.files?.maxSizePerFileMB || 10);
  const [allowedFileTypes, setAllowedFileTypes] = useState<string[]>(
    version?.input_schema?.files?.allowedTypes || []
  );
  const [filesRequired, setFilesRequired] = useState(version?.input_schema?.files?.required || false);

  // Output config state
  const [enabledOutputTypes, setEnabledOutputTypes] = useState<string[]>(
    version?.output_config?.enabledTypes || ['text', 'json']
  );
  const [defaultOutputType, setDefaultOutputType] = useState(
    version?.output_config?.defaultType || 'text'
  );
  const [fallbackEnabled, setFallbackEnabled] = useState(
    version?.output_config?.fallback?.enabled ?? true
  );
  const [fallbackType, setFallbackType] = useState(
    version?.output_config?.fallback?.type || 'text'
  );

  // Categories, skills, tools
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>(
    version?.categories?.map((c) => c.id) || []
  );
  const [selectedSkillIds, setSelectedSkillIds] = useState<number[]>(
    version?.skills?.map((s) => s.id) || []
  );
  const [enabledTools, setEnabledTools] = useState<string[]>(
    version?.tools?.filter((t) => t.is_enabled).map((t) => t.tool_name) || []
  );

  // Available options
  const [categories, setCategories] = useState<Category[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [availableModels, setAvailableModels] = useState<EnabledModel[]>([]);

  // Compute available output types based on enabled tools
  // Base types (text, json, md) are always available
  // Tool-dependent types (pdf, xlsx, etc.) only available if the tool is enabled
  const availableOutputTypes = useMemo(() => {
    const enabledToolNames = enabledTools;
    const toolTypes = TOOL_OUTPUT_TYPES.filter(
      (type) => type.toolRequired && enabledToolNames.includes(type.toolRequired)
    );
    return [
      ...BASE_OUTPUT_TYPES.map((t) => ({ ...t, toolRequired: null as string | null })),
      ...toolTypes.map((t) => ({ ...t, toolRequired: t.toolRequired as string | null })),
    ];
  }, [enabledTools]);

  // UI state
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['input', 'output'])
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load categories, skills, tools, and models
  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [categoriesRes, skillsRes, toolsRes, modelsRes] = await Promise.all([
          fetch('/api/admin/categories'),
          fetch('/api/admin/skills'),
          fetch('/api/admin/tools'),
          fetch('/api/admin/llm/models'),
        ]);

        if (categoriesRes.ok) {
          const data = await categoriesRes.json();
          setCategories(data.categories || []);
        }

        if (skillsRes.ok) {
          const data = await skillsRes.json();
          setSkills(data.skills || []);
        }

        if (toolsRes.ok) {
          const data = await toolsRes.json();
          // Filter to only include enabled tools and tools suitable for agent bots
          const tools: ToolInfo[] = (data.tools || []).filter(
            (t: ToolInfo) => t.enabled
          );
          setAvailableTools(tools);
        }

        if (modelsRes.ok) {
          const data = await modelsRes.json();
          // Filter to only include enabled models whose provider is also enabled
          const models: EnabledModel[] = (data.models || []).filter(
            (m: EnabledModel) => m.enabled && m.providerEnabled !== false
          );
          setAvailableModels(models);
        }
      } catch (err) {
        console.error('Failed to load options:', err);
      }
    };

    loadOptions();
  }, []);

  // Toggle section expansion
  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Add parameter
  const addParameter = () => {
    setParameters([
      ...parameters,
      { name: '', type: 'string', description: '', required: false },
    ]);
  };

  // Update parameter
  const updateParameter = (index: number, updates: Partial<InputParameter>) => {
    const newParams = [...parameters];
    newParams[index] = { ...newParams[index], ...updates };
    setParameters(newParams);
  };

  // Remove parameter
  const removeParameter = (index: number) => {
    setParameters(parameters.filter((_, i) => i !== index));
  };

  // Toggle output type
  const toggleOutputType = (type: string) => {
    if (enabledOutputTypes.includes(type)) {
      const newTypes = enabledOutputTypes.filter((t) => t !== type);
      setEnabledOutputTypes(newTypes);
      if (defaultOutputType === type && newTypes.length > 0) {
        setDefaultOutputType(newTypes[0]);
      }
    } else {
      setEnabledOutputTypes([...enabledOutputTypes, type]);
    }
  };

  // Toggle file type
  const toggleFileType = (type: string) => {
    if (allowedFileTypes.includes(type)) {
      setAllowedFileTypes(allowedFileTypes.filter((t) => t !== type));
    } else {
      setAllowedFileTypes([...allowedFileTypes, type]);
    }
  };

  // Toggle tool
  const toggleTool = (tool: string) => {
    if (enabledTools.includes(tool)) {
      setEnabledTools(enabledTools.filter((t) => t !== tool));
    } else {
      setEnabledTools([...enabledTools, tool]);
    }
  };

  // Handle save
  const handleSave = async () => {
    // Validate
    if (parameters.length === 0) {
      setError('At least one input parameter is required');
      return;
    }

    if (parameters.some((p) => !p.name.trim())) {
      setError('All parameters must have a name');
      return;
    }

    if (enabledOutputTypes.length === 0) {
      setError('At least one output type must be enabled');
      return;
    }

    if (!enabledOutputTypes.includes(defaultOutputType)) {
      setError('Default output type must be in enabled types');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const inputSchema: InputSchema = {
        parameters: parameters.map((p) => ({
          name: p.name.trim(),
          type: p.type,
          description: p.description?.trim() || undefined,
          required: p.required,
          default: p.default,
          enum: p.enum,
          maxLength: p.maxLength,
          minLength: p.minLength,
        })),
      };

      if (filesEnabled) {
        inputSchema.files = {
          enabled: true,
          maxFiles,
          maxSizePerFileMB: maxFileSizeMB,
          allowedTypes: allowedFileTypes.length > 0 ? allowedFileTypes : undefined,
          required: filesRequired,
        };
      }

      const outputConfig: OutputConfig = {
        enabledTypes: enabledOutputTypes,
        defaultType: defaultOutputType,
        fallback: {
          enabled: fallbackEnabled,
          type: fallbackType,
        },
      };

      const body = {
        version_label: versionLabel.trim() || undefined,
        is_default: isDefault,
        is_active: isActive,
        input_schema: inputSchema,
        output_config: outputConfig,
        system_prompt: systemPrompt.trim() || undefined,
        llm_model: llmModel.trim() || undefined,
        temperature: temperature !== '' ? temperature : undefined,
        max_tokens: maxTokens !== '' ? maxTokens : undefined,
        category_ids: selectedCategoryIds,
        skill_ids: selectedSkillIds,
        tools: availableTools.map((tool) => ({
          tool_name: tool.name,
          is_enabled: enabledTools.includes(tool.name),
        })),
      };

      const url = isEditing
        ? `/api/admin/agent-bots/${agentBotId}/versions/${version.id}`
        : `/api/admin/agent-bots/${agentBotId}/versions`;

      const response = await fetch(url, {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save version');
      }

      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save version');
    } finally {
      setIsSaving(false);
    }
  };

  const SectionHeader = ({
    id,
    title,
    children,
  }: {
    id: string;
    title: string;
    children?: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={() => toggleSection(id)}
      className="flex items-center justify-between w-full p-4 text-left bg-gray-50 dark:bg-gray-800/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
    >
      <div className="flex items-center gap-2">
        {expandedSections.has(id) ? (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-500" />
        )}
        <span className="font-medium text-gray-900 dark:text-white">{title}</span>
      </div>
      {children}
    </button>
  );

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto">
      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Basic Info */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Version Label
          </label>
          <input
            type="text"
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
            placeholder="e.g., Production v1"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
        </div>
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Set as default
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
          </label>
        </div>
      </div>

      {/* Input Schema Section */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <SectionHeader id="input" title="Input Schema" />
        {expandedSections.has('input') && (
          <div className="p-4 space-y-4">
            {/* Parameters */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Parameters
                </label>
                <button
                  type="button"
                  onClick={addParameter}
                  className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Add Parameter
                </button>
              </div>
              <div className="space-y-3">
                {parameters.map((param, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg"
                  >
                    <div className="flex-1 grid grid-cols-4 gap-2">
                      <input
                        type="text"
                        value={param.name}
                        onChange={(e) => updateParameter(index, { name: e.target.value })}
                        placeholder="Name"
                        className="px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
                      />
                      <select
                        value={param.type}
                        onChange={(e) =>
                          updateParameter(index, {
                            type: e.target.value as InputParameter['type'],
                          })
                        }
                        className="px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
                      >
                        {PARAMETER_TYPES.map((pt) => (
                          <option key={pt.value} value={pt.value}>
                            {pt.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={param.description || ''}
                        onChange={(e) =>
                          updateParameter(index, { description: e.target.value })
                        }
                        placeholder="Description"
                        className="col-span-2 px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
                      />
                    </div>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={param.required}
                        onChange={(e) =>
                          updateParameter(index, { required: e.target.checked })
                        }
                        className="rounded"
                      />
                      Required
                    </label>
                    <button
                      type="button"
                      onClick={() => removeParameter(index)}
                      className="p-1 text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* File Uploads */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <label className="flex items-center gap-2 mb-3">
                <input
                  type="checkbox"
                  checked={filesEnabled}
                  onChange={(e) => setFilesEnabled(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Enable File Uploads
                </span>
              </label>
              {filesEnabled && (
                <div className="grid grid-cols-3 gap-4 pl-6">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Max Files</label>
                    <input
                      type="number"
                      value={maxFiles}
                      onChange={(e) => setMaxFiles(parseInt(e.target.value) || 1)}
                      min={1}
                      max={10}
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Max Size (MB)
                    </label>
                    <input
                      type="number"
                      value={maxFileSizeMB}
                      onChange={(e) => setMaxFileSizeMB(parseInt(e.target.value) || 1)}
                      min={1}
                      max={100}
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
                    />
                  </div>
                  <label className="flex items-center gap-2 self-end pb-1.5">
                    <input
                      type="checkbox"
                      checked={filesRequired}
                      onChange={(e) => setFilesRequired(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-xs text-gray-500">Required</span>
                  </label>
                  <div className="col-span-3">
                    <label className="block text-xs text-gray-500 mb-2">
                      Allowed File Types
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {ALLOWED_FILE_TYPES.map((type) => (
                        <label
                          key={type.value}
                          className="flex items-center gap-1 text-xs"
                          title={type.extension}
                        >
                          <input
                            type="checkbox"
                            checked={allowedFileTypes.includes(type.value)}
                            onChange={() => toggleFileType(type.value)}
                            className="rounded"
                          />
                          {type.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Output Config Section */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <SectionHeader id="output" title="Output Configuration" />
        {expandedSections.has('output') && (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Enabled Output Types
              </label>
              {availableOutputTypes.length === 0 ? (
                <p className="text-sm text-gray-500">
                  Enable tools (like Document Generator, Excel Generator) to unlock additional output types.
                </p>
              ) : null}
              <div className="grid grid-cols-3 gap-2">
                {availableOutputTypes.map((type) => (
                  <label
                    key={type.id}
                    className={`flex items-start gap-2 p-2 rounded border cursor-pointer ${
                      enabledOutputTypes.includes(type.id)
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={enabledOutputTypes.includes(type.id)}
                      onChange={() => toggleOutputType(type.id)}
                      className="rounded mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {type.label}
                      </span>
                      <p className="text-xs text-gray-500">{type.description}</p>
                      {type.toolRequired && (
                        <p className="text-xs text-blue-500">Requires: {type.toolRequired}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Default Output Type
              </label>
              <select
                value={defaultOutputType}
                onChange={(e) => setDefaultOutputType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
              >
                {enabledOutputTypes.map((type) => (
                  <option key={type} value={type}>
                    {ALL_OUTPUT_TYPES.find((t) => t.id === type)?.label || type}
                  </option>
                ))}
              </select>
            </div>

            {/* Fallback Configuration */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="flex items-start justify-between">
                <div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={fallbackEnabled}
                      onChange={(e) => setFallbackEnabled(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Enable Fallback Output
                    </span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1 ml-6">
                    If the primary output type fails (e.g., PDF generation error), return this fallback type instead of an error.
                  </p>
                </div>
              </div>
              {fallbackEnabled && (
                <div className="mt-3 ml-6">
                  <label className="block text-xs text-gray-500 mb-1">
                    Fallback Type
                  </label>
                  <select
                    value={fallbackType}
                    onChange={(e) => setFallbackType(e.target.value)}
                    className="w-48 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                  >
                    {BASE_OUTPUT_TYPES.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Only base types (Text, JSON, Markdown) can be used as fallback since they don&apos;t require tools.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Categories & Skills Section */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <SectionHeader id="context" title="Categories & Skills" />
        {expandedSections.has('context') && (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Categories (for RAG context)
              </label>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <label
                    key={cat.id}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm cursor-pointer ${
                      selectedCategoryIds.includes(cat.id)
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCategoryIds.includes(cat.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedCategoryIds([...selectedCategoryIds, cat.id]);
                        } else {
                          setSelectedCategoryIds(
                            selectedCategoryIds.filter((id) => id !== cat.id)
                          );
                        }
                      }}
                      className="hidden"
                    />
                    {cat.name}
                  </label>
                ))}
                {categories.length === 0 && (
                  <p className="text-sm text-gray-500">No categories available</p>
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Skills
              </label>
              <div className="flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <label
                    key={skill.id}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm cursor-pointer ${
                      selectedSkillIds.includes(skill.id)
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSkillIds.includes(skill.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedSkillIds([...selectedSkillIds, skill.id]);
                        } else {
                          setSelectedSkillIds(
                            selectedSkillIds.filter((id) => id !== skill.id)
                          );
                        }
                      }}
                      className="hidden"
                    />
                    {skill.name}
                  </label>
                ))}
                {skills.length === 0 && (
                  <p className="text-sm text-gray-500">No skills available</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tools Section */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <SectionHeader id="tools" title="Tools" />
        {expandedSections.has('tools') && (
          <div className="p-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Enable Tools
            </label>
            {availableTools.length === 0 ? (
              <p className="text-sm text-gray-500">No tools available. Enable tools in Admin Settings first.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {availableTools.map((tool) => (
                  <label
                    key={tool.name}
                    className={`flex items-start gap-2 p-2 rounded border cursor-pointer ${
                      enabledTools.includes(tool.name)
                        ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={enabledTools.includes(tool.name)}
                      onChange={() => toggleTool(tool.name)}
                      className="rounded mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {tool.displayName}
                      </span>
                      <p className="text-xs text-gray-500">{tool.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* LLM Settings Section */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <SectionHeader id="llm" title="LLM Settings" />
        {expandedSections.has('llm') && (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Model
              </label>
              <select
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
              >
                <option value="">Use system default</option>
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}
                    {model.isDefault ? ' (Default)' : ''}
                    {model.toolCapable ? ' ⚡' : ''}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                ⚡ = Tool-capable model (recommended for agent bots with tools enabled)
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Temperature
                </label>
                <input
                  type="number"
                  value={temperature}
                  onChange={(e) =>
                    setTemperature(e.target.value ? parseFloat(e.target.value) : '')
                  }
                  placeholder="0.7"
                  min={0}
                  max={2}
                  step={0.1}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Max Tokens
                </label>
                <input
                  type="number"
                  value={maxTokens}
                  onChange={(e) =>
                    setMaxTokens(e.target.value ? parseInt(e.target.value) : '')
                  }
                  placeholder="4096"
                  min={1}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                System Prompt
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Custom system prompt for this version..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 resize-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700 sticky bottom-0 bg-white dark:bg-gray-900 py-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Spinner size="sm" className="mr-2" /> : null}
          {isEditing ? 'Save Changes' : 'Create Version'}
        </Button>
      </div>
    </div>
  );
}

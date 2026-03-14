'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Download, UploadCloud, AlertTriangle, CheckCircle, FileText, Users, FolderOpen, Settings, MessageSquare, FileCode, RefreshCw, AlertCircle, Wrench, Sparkles, MessageCircle, Database, LayoutGrid, Zap, Brain, GitBranch, Share2, CheckSquare, Square, Bot, Filter, ChevronDown, ChevronRight, Clock, Trash2, HardDrive, Play } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface Category {
  id: number;
  name: string;
  slug: string;
}

interface Skill {
  id: number;
  name: string;
  description?: string;
  category_restricted: boolean;
  is_active: boolean;
  tool_routing_tools?: string[];
  categories: { id: number; name: string }[];
}

interface Tool {
  name: string;
  displayName: string;
  description: string;
  enabled: boolean;
}

interface BackupManifest {
  version: string;
  createdAt: string;
  createdBy: string;
  application: {
    name: string;
    version: string;
  };
  contents: {
    documents: boolean;
    documentFiles: boolean;
    categories: boolean;
    settings: boolean;
    users: boolean;
    threads: boolean;
    tools: boolean;
    skills: boolean;
    categoryPrompts: boolean;
    dataSources: boolean;
    documentCount: number;
    categoryCount: number;
    userCount: number;
    threadCount: number;
    toolCount: number;
    skillCount: number;
    categoryPromptCount: number;
    dataSourceCount: number;
    totalFileSize: number;
    workspaces?: boolean;
    functionApis?: boolean;
    userMemories?: boolean;
    toolRouting?: boolean;
    threadShares?: boolean;
    taskPlans?: boolean;
    agentBots?: boolean;
    workspaceCount?: number;
    functionApiCount?: number;
    userMemoryCount?: number;
    toolRoutingRuleCount?: number;
    threadShareCount?: number;
    taskPlanCount?: number;
    agentBotCount?: number;
    categoryFilter?: {
      mode: 'all' | 'selected';
      categoryIds?: number[];
      categoryNames?: string[];
    };
  };
  warnings: string[];
}

interface RestoreResult {
  success: boolean;
  message: string;
  details: {
    documentsRestored: number;
    categoriesRestored: number;
    usersRestored: number;
    threadsRestored: number;
    filesRestored: number;
    settingsRestored: number;
    toolsRestored: number;
    skillsRestored: number;
    categoryPromptsRestored: number;
    dataSourcesRestored: number;
    workspacesRestored?: number;
    functionApisRestored?: number;
    userMemoriesRestored?: number;
    toolRoutingRulesRestored?: number;
    threadSharesRestored?: number;
    taskPlansRestored?: number;
    agentBotsRestored?: number;
  };
  warnings: string[];
}

// Expandable group checkbox component
function GroupCheckbox({
  label,
  icon: Icon,
  checked,
  onChange,
  hint,
  disabled,
  children,
  defaultExpanded = false,
}: {
  label: string;
  icon: React.ElementType;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = !!children;

  return (
    <div className="border rounded-lg overflow-hidden">
      <div
        className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 transition-colors ${disabled ? 'opacity-50' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            e.stopPropagation();
            onChange(e.target.checked);
          }}
          disabled={disabled}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <Icon size={18} className="text-gray-500" />
        <div className="flex-1">
          <span className="text-sm font-medium">{label}</span>
          {hint && <p className="text-xs text-gray-500">{hint}</p>}
        </div>
        {hasChildren && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="p-1 hover:bg-gray-200 rounded"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
      </div>
      {hasChildren && expanded && (
        <div className="border-t bg-gray-50 p-3 pl-10 space-y-2">
          {children}
        </div>
      )}
    </div>
  );
}

// Sub-option checkbox
function SubCheckbox({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      <span className="text-sm">{label}</span>
      {hint && <span className="text-xs text-gray-500">({hint})</span>}
    </label>
  );
}

export default function BackupTab() {
  // Categories for filter (Level 1)
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categoryFilterMode, setCategoryFilterMode] = useState<'all' | 'selected'>('all');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);

  // Skills for filter (Level 2) - appears when categories are filtered
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [skillFilterMode, setSkillFilterMode] = useState<'all' | 'selected'>('all');
  const [selectedSkillIds, setSelectedSkillIds] = useState<number[]>([]);

  // Tools for filter (Level 3) - appears when skills are filtered
  const [availableTools, setAvailableTools] = useState<Tool[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [toolFilterMode, setToolFilterMode] = useState<'all' | 'selected'>('all');
  const [selectedToolNames, setSelectedToolNames] = useState<string[]>([]);

  // Backup state
  const [backupInProgress, setBackupInProgress] = useState(false);
  const [backupOptions, setBackupOptions] = useState({
    // Main group options
    includeCategories: true,
    includeDocuments: true,
    includeDocumentFiles: true,
    includeUsers: true,
    includeUserMemories: true,
    includeCategoryPrompts: true,
    includeAgentBots: true,
    includeSkills: true,
    includeTools: true,
    includeDataSources: true,
    includeFunctionApis: true,
    includeToolRouting: true,
    includeWorkspaces: true,
    includeSettings: true,
    includeThreads: false,
    includeThreadShares: false,
  });

  // Restore state
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreManifest, setRestoreManifest] = useState<BackupManifest | null>(null);
  const [restoreInProgress, setRestoreInProgress] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [restoreOptions, setRestoreOptions] = useState({
    clearExisting: false,
    restoreCategories: true,
    restoreDocuments: true,
    restoreDocumentFiles: true,
    restoreUsers: true,
    restoreUserMemories: true,
    restoreCategoryPrompts: true,
    restoreAgentBots: true,
    restoreSkills: true,
    restoreTools: true,
    restoreDataSources: true,
    restoreFunctionApis: true,
    restoreToolRouting: true,
    restoreWorkspaces: true,
    restoreSettings: true,
    restoreThreads: false,
    restoreThreadShares: false,
    refreshVectorDb: true,
  });

  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Saved backups state
  const [savedBackups, setSavedBackups] = useState<{ filename: string; size: number; createdAt: string }[]>([]);
  const [scheduleConfig, setScheduleConfig] = useState({ enabled: true, hour: 2, retentionDays: 7 });
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [triggeringBackup, setTriggeringBackup] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

  // Fetch saved backups
  const fetchSavedBackups = useCallback(async () => {
    setLoadingSaved(true);
    try {
      const res = await fetch('/api/admin/backup/files');
      if (res.ok) {
        const data = await res.json();
        setSavedBackups(data.files || []);
        if (data.schedule) setScheduleConfig(data.schedule);
      }
    } catch (err) {
      console.error('Failed to fetch saved backups:', err);
    } finally {
      setLoadingSaved(false);
    }
  }, []);

  // Trigger immediate backup
  const handleTriggerBackup = async () => {
    setTriggeringBackup(true);
    try {
      const res = await fetch('/api/admin/backup/files/trigger', { method: 'POST' });
      if (res.ok) {
        await fetchSavedBackups();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to trigger backup');
      }
    } catch (err) {
      setError('Failed to trigger backup');
    } finally {
      setTriggeringBackup(false);
    }
  };

  // Save schedule config
  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    try {
      const res = await fetch('/api/admin/backup/files/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scheduleConfig),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to save schedule');
      }
    } catch {
      setError('Failed to save schedule');
    } finally {
      setSavingSchedule(false);
    }
  };

  // Delete a saved backup
  const handleDeleteBackup = async (filename: string) => {
    if (!confirm(`Delete backup "${filename}"?`)) return;
    setDeletingFile(filename);
    try {
      const res = await fetch(`/api/admin/backup/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (res.ok) {
        setSavedBackups(prev => prev.filter(f => f.filename !== filename));
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to delete backup');
      }
    } catch {
      setError('Failed to delete backup');
    } finally {
      setDeletingFile(null);
    }
  };

  // Fetch categories on mount
  useEffect(() => {
    const fetchCategories = async () => {
      setLoadingCategories(true);
      try {
        const response = await fetch('/api/admin/categories');
        if (response.ok) {
          const data = await response.json();
          setCategories(data.categories || []);
        }
      } catch (err) {
        console.error('Failed to fetch categories:', err);
      } finally {
        setLoadingCategories(false);
      }
    };
    fetchCategories();
    fetchSavedBackups();
  }, [fetchSavedBackups]);

  // Fetch skills when categories are selected (Level 2)
  useEffect(() => {
    if (categoryFilterMode !== 'selected' || selectedCategoryIds.length === 0) {
      setAvailableSkills([]);
      setSelectedSkillIds([]);
      setSkillFilterMode('all');
      return;
    }

    const fetchSkills = async () => {
      setLoadingSkills(true);
      try {
        const response = await fetch(`/api/admin/skills?categoryIds=${selectedCategoryIds.join(',')}`);
        if (response.ok) {
          const data = await response.json();
          setAvailableSkills(data.skills || []);
        }
      } catch (err) {
        console.error('Failed to fetch skills:', err);
      } finally {
        setLoadingSkills(false);
      }
    };
    fetchSkills();
  }, [categoryFilterMode, selectedCategoryIds]);

  // Fetch tools on mount (Level 3)
  useEffect(() => {
    const fetchTools = async () => {
      setLoadingTools(true);
      try {
        const response = await fetch('/api/admin/tools');
        if (response.ok) {
          const data = await response.json();
          setAvailableTools(data.tools || []);
        }
      } catch (err) {
        console.error('Failed to fetch tools:', err);
      } finally {
        setLoadingTools(false);
      }
    };
    fetchTools();
  }, []);

  // Auto-select tools when skills are selected
  useEffect(() => {
    if (skillFilterMode !== 'selected' || selectedSkillIds.length === 0) {
      return;
    }

    // Get tool names from selected skills' tool_routing_tools
    const selectedSkillsData = availableSkills.filter(s => selectedSkillIds.includes(s.id));
    const toolNamesFromSkills = new Set<string>();
    selectedSkillsData.forEach(skill => {
      if (skill.tool_routing_tools) {
        skill.tool_routing_tools.forEach(toolName => toolNamesFromSkills.add(toolName));
      }
    });

    // Auto-add these tools to selection (preserving existing selections)
    setSelectedToolNames(prev => {
      const combined = new Set([...prev, ...toolNamesFromSkills]);
      return Array.from(combined);
    });
  }, [selectedSkillIds, availableSkills, skillFilterMode]);

  // Handle category filter mode change
  const handleCategoryFilterModeChange = useCallback((mode: 'all' | 'selected') => {
    setCategoryFilterMode(mode);
    // Reset skill and tool filters when changing category mode
    setSkillFilterMode('all');
    setSelectedSkillIds([]);
    setToolFilterMode('all');
    setSelectedToolNames([]);
    // Auto-deselect user memories when switching to filtered backup
    if (mode === 'selected') {
      setBackupOptions(prev => ({ ...prev, includeUserMemories: false }));
    }
  }, []);

  // Handle skill filter mode change
  const handleSkillFilterModeChange = useCallback((mode: 'all' | 'selected') => {
    setSkillFilterMode(mode);
    // Reset tool filter when changing skill mode
    if (mode === 'all') {
      setToolFilterMode('all');
      setSelectedToolNames([]);
    }
  }, []);

  // Handle tool filter mode change
  const handleToolFilterModeChange = useCallback((mode: 'all' | 'selected') => {
    setToolFilterMode(mode);
  }, []);

  // Select all / clear all handlers for backup options
  const handleSelectAllBackup = useCallback(() => {
    const isFiltered = categoryFilterMode === 'selected';
    setBackupOptions({
      includeCategories: true,
      includeDocuments: true,
      includeDocumentFiles: true,
      includeUsers: true,
      includeUserMemories: !isFiltered, // Don't select if filtered
      includeCategoryPrompts: true,
      includeAgentBots: true,
      includeSkills: true,
      includeTools: true,
      includeDataSources: true,
      includeFunctionApis: true,
      includeToolRouting: true,
      includeWorkspaces: true,
      includeSettings: true,
      includeThreads: true,
      includeThreadShares: true,
    });
  }, [categoryFilterMode]);

  const handleClearAllBackup = useCallback(() => {
    setBackupOptions({
      includeCategories: false,
      includeDocuments: false,
      includeDocumentFiles: false,
      includeUsers: false,
      includeUserMemories: false,
      includeCategoryPrompts: false,
      includeAgentBots: false,
      includeSkills: false,
      includeTools: false,
      includeDataSources: false,
      includeFunctionApis: false,
      includeToolRouting: false,
      includeWorkspaces: false,
      includeSettings: false,
      includeThreads: false,
      includeThreadShares: false,
    });
  }, []);

  // Select all / clear all handlers for restore options
  const handleSelectAllRestore = useCallback(() => {
    if (!restoreManifest?.contents) return;
    setRestoreOptions(prev => ({
      ...prev,
      restoreCategories: restoreManifest.contents.categories,
      restoreDocuments: restoreManifest.contents.documents,
      restoreDocumentFiles: restoreManifest.contents.documentFiles,
      restoreUsers: restoreManifest.contents.users,
      restoreUserMemories: restoreManifest.contents.userMemories ?? false,
      restoreCategoryPrompts: restoreManifest.contents.categoryPrompts ?? false,
      restoreAgentBots: restoreManifest.contents.agentBots ?? false,
      restoreSkills: restoreManifest.contents.skills ?? false,
      restoreTools: restoreManifest.contents.tools ?? false,
      restoreDataSources: restoreManifest.contents.dataSources ?? false,
      restoreFunctionApis: restoreManifest.contents.functionApis ?? false,
      restoreToolRouting: restoreManifest.contents.toolRouting ?? false,
      restoreWorkspaces: restoreManifest.contents.workspaces ?? false,
      restoreSettings: restoreManifest.contents.settings,
      restoreThreads: restoreManifest.contents.threads,
      restoreThreadShares: restoreManifest.contents.threadShares ?? false,
    }));
  }, [restoreManifest]);

  const handleClearAllRestore = useCallback(() => {
    setRestoreOptions(prev => ({
      ...prev,
      restoreCategories: false,
      restoreDocuments: false,
      restoreDocumentFiles: false,
      restoreUsers: false,
      restoreUserMemories: false,
      restoreCategoryPrompts: false,
      restoreAgentBots: false,
      restoreSkills: false,
      restoreTools: false,
      restoreDataSources: false,
      restoreFunctionApis: false,
      restoreToolRouting: false,
      restoreWorkspaces: false,
      restoreSettings: false,
      restoreThreads: false,
      restoreThreadShares: false,
    }));
  }, []);

  // Handle backup creation
  const handleCreateBackup = async () => {
    // Validate category filter
    if (categoryFilterMode === 'selected' && selectedCategoryIds.length === 0) {
      setError('Please select at least one category for filtered backup');
      return;
    }

    // Validate skill filter if enabled
    if (skillFilterMode === 'selected' && selectedSkillIds.length === 0) {
      setError('Please select at least one skill for filtered backup');
      return;
    }

    // Validate tool filter if enabled
    if (toolFilterMode === 'selected' && selectedToolNames.length === 0) {
      setError('Please select at least one tool for filtered backup');
      return;
    }

    setBackupInProgress(true);
    setError(null);

    try {
      const requestBody = {
        ...backupOptions,
        categoryFilter: categoryFilterMode === 'selected' ? {
          mode: 'selected',
          categoryIds: selectedCategoryIds,
        } : undefined,
        skillFilter: skillFilterMode === 'selected' ? {
          mode: 'selected',
          skillIds: selectedSkillIds,
        } : undefined,
        toolFilter: toolFilterMode === 'selected' ? {
          mode: 'selected',
          toolNames: selectedToolNames,
        } : undefined,
      };

      const response = await fetch('/api/admin/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Backup failed');
      }

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : 'backup.zip';

      // Create blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create backup');
    } finally {
      setBackupInProgress(false);
    }
  };

  // Handle file selection for restore
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRestoreFile(file);
    setRestoreResult(null);
    setError(null);

    // Validate and get manifest
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/admin/backup/restore', {
        method: 'PUT',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Invalid backup file');
      }

      const data = await response.json();
      setRestoreManifest(data.manifest);

      // Update restore options based on what's in the backup
      if (data.manifest?.contents) {
        setRestoreOptions(prev => ({
          ...prev,
          restoreCategories: data.manifest.contents.categories,
          restoreDocuments: data.manifest.contents.documents,
          restoreDocumentFiles: data.manifest.contents.documentFiles,
          restoreUsers: data.manifest.contents.users,
          restoreUserMemories: data.manifest.contents.userMemories ?? false,
          restoreCategoryPrompts: data.manifest.contents.categoryPrompts ?? false,
          restoreAgentBots: data.manifest.contents.agentBots ?? false,
          restoreSkills: data.manifest.contents.skills ?? false,
          restoreTools: data.manifest.contents.tools ?? false,
          restoreDataSources: data.manifest.contents.dataSources ?? false,
          restoreFunctionApis: data.manifest.contents.functionApis ?? false,
          restoreToolRouting: data.manifest.contents.toolRouting ?? false,
          restoreWorkspaces: data.manifest.contents.workspaces ?? false,
          restoreSettings: data.manifest.contents.settings,
          restoreThreads: data.manifest.contents.threads,
          restoreThreadShares: data.manifest.contents.threadShares ?? false,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read backup file');
      setRestoreFile(null);
      setRestoreManifest(null);
    }
  };

  // Handle restore
  const handleRestore = async () => {
    if (!restoreFile) return;

    setRestoreInProgress(true);
    setError(null);
    setRestoreResult(null);

    try {
      const formData = new FormData();
      formData.append('file', restoreFile);
      Object.entries(restoreOptions).forEach(([key, value]) => {
        formData.append(key, String(value));
      });

      const response = await fetch('/api/admin/backup/restore', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Restore failed');
      }

      setRestoreResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore backup');
    } finally {
      setRestoreInProgress(false);
    }
  };

  // Reset restore state
  const handleClearRestore = () => {
    setRestoreFile(null);
    setRestoreManifest(null);
    setRestoreResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isFiltered = categoryFilterMode === 'selected';

  return (
    <div className="space-y-6">
      {/* Error Display */}
      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-lg flex items-center gap-3">
          <AlertCircle size={20} />
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-600"
          >
            &times;
          </button>
        </div>
      )}

      {/* Create Backup Section */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b flex items-center gap-3">
          <Download className="text-blue-600" size={20} />
          <div>
            <h2 className="font-semibold text-gray-900">Create Backup</h2>
            <p className="text-sm text-gray-500">Export your data as a downloadable ZIP file</p>
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            {/* Select All / Clear All buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleSelectAllBackup}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
              >
                <CheckSquare size={16} />
                Select All
              </button>
              <button
                onClick={handleClearAllBackup}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
              >
                <Square size={16} />
                Clear All
              </button>
            </div>

            {/* Grouped Backup Options */}
            <div className="space-y-3">
              {/* 1. Categories */}
              <GroupCheckbox
                label="Categories"
                icon={FolderOpen}
                checked={backupOptions.includeCategories}
                onChange={(checked) => setBackupOptions(prev => ({ ...prev, includeCategories: checked }))}
                hint="Category definitions"
              />

              {/* 2. Documents with Include Files sub-option */}
              <GroupCheckbox
                label="Documents"
                icon={FileText}
                checked={backupOptions.includeDocuments}
                onChange={(checked) => setBackupOptions(prev => ({
                  ...prev,
                  includeDocuments: checked,
                  includeDocumentFiles: checked ? prev.includeDocumentFiles : false
                }))}
                hint="Document metadata records"
                defaultExpanded
              >
                <SubCheckbox
                  label="Include Files"
                  checked={backupOptions.includeDocumentFiles}
                  onChange={(checked) => setBackupOptions(prev => ({ ...prev, includeDocumentFiles: checked }))}
                  hint="PDF/DOCX binaries - increases size"
                  disabled={!backupOptions.includeDocuments}
                />
              </GroupCheckbox>

              {/* 3. Users with User Memories sub-option */}
              <GroupCheckbox
                label="Users"
                icon={Users}
                checked={backupOptions.includeUsers}
                onChange={(checked) => setBackupOptions(prev => ({
                  ...prev,
                  includeUsers: checked,
                  includeUserMemories: checked && !isFiltered ? prev.includeUserMemories : false
                }))}
                hint="User accounts and subscriptions"
                defaultExpanded
              >
                <SubCheckbox
                  label="User Memories"
                  checked={backupOptions.includeUserMemories}
                  onChange={(checked) => setBackupOptions(prev => ({ ...prev, includeUserMemories: checked }))}
                  hint={isFiltered ? "Excluded from filtered backup" : "AI memory storage"}
                  disabled={!backupOptions.includeUsers || isFiltered}
                />
              </GroupCheckbox>

              {/* 4. Prompts */}
              <GroupCheckbox
                label="Prompts"
                icon={MessageCircle}
                checked={backupOptions.includeCategoryPrompts}
                onChange={(checked) => setBackupOptions(prev => ({ ...prev, includeCategoryPrompts: checked }))}
                hint="Category prompts and starters"
              />

              {/* 5. Agents */}
              <GroupCheckbox
                label="Agents"
                icon={Bot}
                checked={backupOptions.includeAgentBots}
                onChange={(checked) => setBackupOptions(prev => ({ ...prev, includeAgentBots: checked }))}
                hint="Autonomous bots and API bots"
              />

              {/* 6. Skills with Tools sub-options */}
              <GroupCheckbox
                label="Skills"
                icon={Sparkles}
                checked={backupOptions.includeSkills}
                onChange={(checked) => setBackupOptions(prev => ({
                  ...prev,
                  includeSkills: checked,
                  includeTools: checked ? prev.includeTools : false,
                  includeDataSources: checked ? prev.includeDataSources : false,
                  includeFunctionApis: checked ? prev.includeFunctionApis : false,
                  includeToolRouting: checked ? prev.includeToolRouting : false,
                }))}
                hint="AI behaviors and capabilities"
                defaultExpanded
              >
                <SubCheckbox
                  label="Tools"
                  checked={backupOptions.includeTools}
                  onChange={(checked) => setBackupOptions(prev => ({ ...prev, includeTools: checked }))}
                  hint="Global tool configs"
                  disabled={!backupOptions.includeSkills}
                />
                <SubCheckbox
                  label="Data Sources"
                  checked={backupOptions.includeDataSources}
                  onChange={(checked) => setBackupOptions(prev => ({ ...prev, includeDataSources: checked }))}
                  hint="APIs & CSVs"
                  disabled={!backupOptions.includeSkills}
                />
                <SubCheckbox
                  label="Function APIs"
                  checked={backupOptions.includeFunctionApis}
                  onChange={(checked) => setBackupOptions(prev => ({ ...prev, includeFunctionApis: checked }))}
                  hint="Function calling endpoints"
                  disabled={!backupOptions.includeSkills}
                />
                <SubCheckbox
                  label="Tool Routing"
                  checked={backupOptions.includeToolRouting}
                  onChange={(checked) => setBackupOptions(prev => ({ ...prev, includeToolRouting: checked }))}
                  hint="Routing rules"
                  disabled={!backupOptions.includeSkills}
                />
              </GroupCheckbox>

              {/* 7. Workspaces */}
              <GroupCheckbox
                label="Workspaces"
                icon={LayoutGrid}
                checked={backupOptions.includeWorkspaces}
                onChange={(checked) => setBackupOptions(prev => ({ ...prev, includeWorkspaces: checked }))}
                hint="Workspace configurations"
              />

              {/* 8. Settings */}
              <GroupCheckbox
                label="Settings"
                icon={Settings}
                checked={backupOptions.includeSettings}
                onChange={(checked) => setBackupOptions(prev => ({ ...prev, includeSettings: checked }))}
                hint="Global configuration and tokens"
              />

              {/* 9. Threads with Thread Shares sub-option */}
              <GroupCheckbox
                label="Threads"
                icon={MessageSquare}
                checked={backupOptions.includeThreads}
                onChange={(checked) => setBackupOptions(prev => ({
                  ...prev,
                  includeThreads: checked,
                  includeThreadShares: checked ? prev.includeThreadShares : false
                }))}
                hint="Conversation history (can be large)"
                defaultExpanded={backupOptions.includeThreads}
              >
                <SubCheckbox
                  label="Thread Shares"
                  checked={backupOptions.includeThreadShares}
                  onChange={(checked) => setBackupOptions(prev => ({ ...prev, includeThreadShares: checked }))}
                  hint="Share links"
                  disabled={!backupOptions.includeThreads}
                />
              </GroupCheckbox>
            </div>

            {/* Category Filter Section */}
            <div className="mt-4 p-4 border rounded-lg bg-gray-50">
              <div className="flex items-center gap-2 mb-3">
                <Filter size={18} className="text-gray-500" />
                <span className="font-medium text-gray-700">Category Filter</span>
              </div>
              <div className="space-y-3">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="categoryFilter"
                      checked={categoryFilterMode === 'all'}
                      onChange={() => handleCategoryFilterModeChange('all')}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">All Categories</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="categoryFilter"
                      checked={categoryFilterMode === 'selected'}
                      onChange={() => handleCategoryFilterModeChange('selected')}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Select Categories</span>
                  </label>
                </div>

                {categoryFilterMode === 'selected' && (
                  <div className="space-y-2">
                    {loadingCategories ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Spinner size="sm" />
                        Loading categories...
                      </div>
                    ) : categories.length === 0 ? (
                      <div className="text-sm text-gray-500">No categories available</div>
                    ) : (
                      <>
                        <div className="flex gap-2 mb-2">
                          <button
                            type="button"
                            onClick={() => setSelectedCategoryIds(categories.map(c => c.id))}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            Select all
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            type="button"
                            onClick={() => setSelectedCategoryIds([])}
                            className="text-xs text-gray-600 hover:text-gray-800"
                          >
                            Clear all
                          </button>
                        </div>
                        <div className="max-h-48 overflow-y-auto border rounded bg-white p-2 space-y-1">
                          {categories.map(cat => (
                            <label
                              key={cat.id}
                              className="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedCategoryIds.includes(cat.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedCategoryIds(prev => [...prev, cat.id]);
                                  } else {
                                    setSelectedCategoryIds(prev => prev.filter(id => id !== cat.id));
                                  }
                                }}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-sm">{cat.name}</span>
                            </label>
                          ))}
                        </div>
                        <div className="text-xs text-gray-500">
                          {selectedCategoryIds.length} of {categories.length} selected
                        </div>
                      </>
                    )}
                    <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                      <AlertTriangle size={12} className="inline mr-1" />
                      Filtered backup excludes user memories. Threads with categories outside selection are excluded using strict filtering.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Skill Filter Section (Level 2) - appears when categories are filtered */}
            {categoryFilterMode === 'selected' && selectedCategoryIds.length > 0 && (
              <div className="mt-4 p-4 border rounded-lg bg-purple-50 border-purple-200">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={18} className="text-purple-500" />
                  <span className="font-medium text-purple-700">Skill Filter (Level 2)</span>
                </div>
                <div className="space-y-3">
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="skillFilter"
                        checked={skillFilterMode === 'all'}
                        onChange={() => handleSkillFilterModeChange('all')}
                        className="text-purple-600 focus:ring-purple-500"
                      />
                      <span className="text-sm">All Skills</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="skillFilter"
                        checked={skillFilterMode === 'selected'}
                        onChange={() => handleSkillFilterModeChange('selected')}
                        className="text-purple-600 focus:ring-purple-500"
                      />
                      <span className="text-sm">Select Skills</span>
                    </label>
                  </div>

                  {skillFilterMode === 'selected' && (
                    <div className="space-y-2">
                      {loadingSkills ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Spinner size="sm" />
                          Loading skills...
                        </div>
                      ) : availableSkills.length === 0 ? (
                        <div className="text-sm text-gray-500">No skills available for selected categories</div>
                      ) : (
                        <>
                          <div className="flex gap-2 mb-2">
                            <button
                              type="button"
                              onClick={() => setSelectedSkillIds(availableSkills.map(s => s.id))}
                              className="text-xs text-purple-600 hover:text-purple-800"
                            >
                              Select all
                            </button>
                            <span className="text-gray-300">|</span>
                            <button
                              type="button"
                              onClick={() => setSelectedSkillIds([])}
                              className="text-xs text-gray-600 hover:text-gray-800"
                            >
                              Clear all
                            </button>
                          </div>
                          <div className="max-h-48 overflow-y-auto border rounded bg-white p-2 space-y-1">
                            {availableSkills.map(skill => (
                              <label
                                key={skill.id}
                                className="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedSkillIds.includes(skill.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedSkillIds(prev => [...prev, skill.id]);
                                    } else {
                                      setSelectedSkillIds(prev => prev.filter(id => id !== skill.id));
                                    }
                                  }}
                                  className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                />
                                <span className="text-sm flex-1">{skill.name}</span>
                                {!skill.category_restricted && (
                                  <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded">global</span>
                                )}
                                {skill.tool_routing_tools && skill.tool_routing_tools.length > 0 && (
                                  <span className="text-xs text-gray-400">
                                    {skill.tool_routing_tools.length} tool{skill.tool_routing_tools.length > 1 ? 's' : ''}
                                  </span>
                                )}
                              </label>
                            ))}
                          </div>
                          <div className="text-xs text-gray-500">
                            {selectedSkillIds.length} of {availableSkills.length} selected
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tool Filter Section (Level 3) - appears when skills are filtered */}
            {skillFilterMode === 'selected' && selectedSkillIds.length > 0 && (
              <div className="mt-4 p-4 border rounded-lg bg-orange-50 border-orange-200">
                <div className="flex items-center gap-2 mb-3">
                  <Wrench size={18} className="text-orange-500" />
                  <span className="font-medium text-orange-700">Tool Filter (Level 3)</span>
                </div>
                <div className="space-y-3">
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="toolFilter"
                        checked={toolFilterMode === 'all'}
                        onChange={() => handleToolFilterModeChange('all')}
                        className="text-orange-600 focus:ring-orange-500"
                      />
                      <span className="text-sm">All Tools</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="toolFilter"
                        checked={toolFilterMode === 'selected'}
                        onChange={() => handleToolFilterModeChange('selected')}
                        className="text-orange-600 focus:ring-orange-500"
                      />
                      <span className="text-sm">Select Tools</span>
                    </label>
                  </div>

                  {toolFilterMode === 'selected' && (
                    <div className="space-y-2">
                      {loadingTools ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Spinner size="sm" />
                          Loading tools...
                        </div>
                      ) : availableTools.length === 0 ? (
                        <div className="text-sm text-gray-500">No tools available</div>
                      ) : (
                        <>
                          <div className="flex gap-2 mb-2">
                            <button
                              type="button"
                              onClick={() => setSelectedToolNames(availableTools.map(t => t.name))}
                              className="text-xs text-orange-600 hover:text-orange-800"
                            >
                              Select all
                            </button>
                            <span className="text-gray-300">|</span>
                            <button
                              type="button"
                              onClick={() => setSelectedToolNames([])}
                              className="text-xs text-gray-600 hover:text-gray-800"
                            >
                              Clear all
                            </button>
                          </div>
                          <div className="max-h-48 overflow-y-auto border rounded bg-white p-2 space-y-1">
                            {availableTools.map(tool => {
                              // Check if this tool is referenced by any selected skill
                              const isFromSkill = availableSkills
                                .filter(s => selectedSkillIds.includes(s.id))
                                .some(s => s.tool_routing_tools?.includes(tool.name));
                              return (
                                <label
                                  key={tool.name}
                                  className="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedToolNames.includes(tool.name)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedToolNames(prev => [...prev, tool.name]);
                                      } else {
                                        setSelectedToolNames(prev => prev.filter(name => name !== tool.name));
                                      }
                                    }}
                                    className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                                  />
                                  <span className="text-sm flex-1">{tool.displayName || tool.name}</span>
                                  {isFromSkill && (
                                    <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">from skill</span>
                                  )}
                                  {!tool.enabled && (
                                    <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">disabled</span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                          <div className="text-xs text-gray-500">
                            {selectedToolNames.length} of {availableTools.length} selected
                          </div>
                          <div className="mt-2 p-2 bg-purple-50 border border-purple-200 rounded text-xs text-purple-700">
                            <Sparkles size={12} className="inline mr-1" />
                            Tools marked &quot;from skill&quot; are automatically selected based on your skill selections.
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-4 border-t mt-4">
              <Button
                onClick={handleCreateBackup}
                disabled={backupInProgress}
              >
                {backupInProgress ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    Creating Backup...
                  </>
                ) : (
                  <>
                    <Download size={16} className="mr-2" />
                    Create Backup
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Saved Backups Section */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HardDrive className="text-purple-600" size={20} />
            <div>
              <h2 className="font-semibold text-gray-900">Saved Backups</h2>
              <p className="text-sm text-gray-500">Automated daily backups stored on the server</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={fetchSavedBackups}
              disabled={loadingSaved}
            >
              <RefreshCw size={14} className={loadingSaved ? 'animate-spin' : ''} />
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleTriggerBackup}
              disabled={triggeringBackup}
            >
              {triggeringBackup ? (
                <><Spinner size="sm" className="mr-1" /> Backing up...</>
              ) : (
                <><Play size={14} className="mr-1" /> Backup Now</>
              )}
            </Button>
          </div>
        </div>
        <div className="p-6 space-y-6">
          {/* Schedule Settings */}
          <div className="p-4 bg-gray-50 rounded-lg space-y-4">
            <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Clock size={16} />
              Backup Schedule
            </h3>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={scheduleConfig.enabled}
                  onChange={(e) => setScheduleConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm">Enable daily backups</span>
              </label>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Run at:</label>
                <select
                  value={scheduleConfig.hour}
                  onChange={(e) => setScheduleConfig(prev => ({ ...prev, hour: parseInt(e.target.value) }))}
                  className="text-sm border rounded px-2 py-1"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}:00 UTC</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Keep:</label>
                <select
                  value={scheduleConfig.retentionDays}
                  onChange={(e) => setScheduleConfig(prev => ({ ...prev, retentionDays: parseInt(e.target.value) }))}
                  className="text-sm border rounded px-2 py-1"
                >
                  {[3, 5, 7, 14, 30].map(d => (
                    <option key={d} value={d}>{d} days</option>
                  ))}
                </select>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSaveSchedule}
                disabled={savingSchedule}
              >
                {savingSchedule ? 'Saving...' : 'Save Schedule'}
              </Button>
            </div>
          </div>

          {/* Backup Files List */}
          {loadingSaved ? (
            <div className="flex items-center justify-center py-8 text-gray-500">
              <Spinner size="sm" className="mr-2" /> Loading backups...
            </div>
          ) : savedBackups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <HardDrive size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No saved backups yet</p>
              <p className="text-xs text-gray-400 mt-1">Click &quot;Backup Now&quot; or wait for the scheduled backup</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Filename</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Date</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Size</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {savedBackups.map((file) => (
                    <tr key={file.filename} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs">{file.filename}</td>
                      <td className="px-4 py-2 text-gray-600">
                        {new Date(file.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600">
                        {(file.size / (1024 * 1024)).toFixed(1)} MB
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <a
                            href={`/api/admin/backup/files/${encodeURIComponent(file.filename)}/download`}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="Download"
                          >
                            <Download size={14} />
                          </a>
                          <button
                            onClick={() => handleDeleteBackup(file.filename)}
                            disabled={deletingFile === file.filename}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                            title="Delete"
                          >
                            {deletingFile === file.filename ? <Spinner size="sm" /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Restore Backup Section */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b flex items-center gap-3">
          <UploadCloud className="text-green-600" size={20} />
          <div>
            <h2 className="font-semibold text-gray-900">Restore from Backup</h2>
            <p className="text-sm text-gray-500">Upload a backup ZIP file to restore your data</p>
          </div>
        </div>
        <div className="p-6">
          {/* Important Reminder */}
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800">
              <span className="font-medium">Before restoring:</span> Ensure your <code className="bg-amber-100 px-1 rounded">.env</code> file is properly configured with API keys and environment variables. The backup does not include sensitive configuration files.
            </div>
          </div>

          {/* File Upload */}
          {!restoreFile ? (
            <div className="space-y-4">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-gray-50 transition-colors">
                <UploadCloud size={32} className="text-gray-400 mb-2" />
                <span className="text-sm text-gray-500">Click to select backup file (.zip)</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Selected File Info */}
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <FileText size={20} className="text-blue-600" />
                  <div>
                    <div className="font-medium text-gray-900">{restoreFile.name}</div>
                    <div className="text-sm text-gray-500">{formatSize(restoreFile.size)}</div>
                  </div>
                </div>
                <button
                  onClick={handleClearRestore}
                  className="text-gray-400 hover:text-gray-600"
                >
                  &times;
                </button>
              </div>

              {/* Manifest Info */}
              {restoreManifest && (
                <div className="p-4 bg-blue-50 rounded-lg">
                  <div className="text-sm font-medium text-blue-900 mb-2">Backup Contents</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    {restoreManifest.contents.categories && (
                      <div className="flex items-center gap-2">
                        <FolderOpen size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.categoryCount} Categories</span>
                      </div>
                    )}
                    {restoreManifest.contents.documents && (
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.documentCount} Documents</span>
                      </div>
                    )}
                    {restoreManifest.contents.users && (
                      <div className="flex items-center gap-2">
                        <Users size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.userCount} Users</span>
                      </div>
                    )}
                    {restoreManifest.contents.categoryPrompts && (
                      <div className="flex items-center gap-2">
                        <MessageCircle size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.categoryPromptCount} Prompts</span>
                      </div>
                    )}
                    {restoreManifest.contents.agentBots && (
                      <div className="flex items-center gap-2">
                        <Bot size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.agentBotCount} Agents</span>
                      </div>
                    )}
                    {restoreManifest.contents.skills && (
                      <div className="flex items-center gap-2">
                        <Sparkles size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.skillCount} Skills</span>
                      </div>
                    )}
                    {restoreManifest.contents.tools && (
                      <div className="flex items-center gap-2">
                        <Wrench size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.toolCount} Tools</span>
                      </div>
                    )}
                    {restoreManifest.contents.dataSources && (
                      <div className="flex items-center gap-2">
                        <Database size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.dataSourceCount} Data Sources</span>
                      </div>
                    )}
                    {restoreManifest.contents.functionApis && (
                      <div className="flex items-center gap-2">
                        <Zap size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.functionApiCount} Function APIs</span>
                      </div>
                    )}
                    {restoreManifest.contents.workspaces && (
                      <div className="flex items-center gap-2">
                        <LayoutGrid size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.workspaceCount} Workspaces</span>
                      </div>
                    )}
                    {restoreManifest.contents.userMemories && (
                      <div className="flex items-center gap-2">
                        <Brain size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.userMemoryCount} Memories</span>
                      </div>
                    )}
                    {restoreManifest.contents.threads && (
                      <div className="flex items-center gap-2">
                        <MessageSquare size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.threadCount} Threads</span>
                      </div>
                    )}
                    {restoreManifest.contents.threadShares && (
                      <div className="flex items-center gap-2">
                        <Share2 size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.threadShareCount} Shares</span>
                      </div>
                    )}
                    {restoreManifest.contents.toolRouting && (
                      <div className="flex items-center gap-2">
                        <GitBranch size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.toolRoutingRuleCount} Routing Rules</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-blue-600">
                    Created: {new Date(restoreManifest.createdAt).toLocaleString()} by {restoreManifest.createdBy}
                  </div>
                  {restoreManifest.contents.categoryFilter && (
                    <div className="mt-2 p-2 bg-amber-50 border border-amber-100 rounded text-xs text-amber-700">
                      <Filter size={12} className="inline mr-1" />
                      {restoreManifest.contents.categoryFilter.mode === 'selected' ? (
                        <>
                          Filtered backup containing only: {restoreManifest.contents.categoryFilter.categoryNames?.join(', ') || `${restoreManifest.contents.categoryFilter.categoryIds?.length} categories`}
                        </>
                      ) : (
                        'Full backup (all categories)'
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Restore Options - Grouped Layout */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-700">Restore Options</div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSelectAllRestore}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    >
                      <CheckSquare size={14} />
                      Select All
                    </button>
                    <button
                      onClick={handleClearAllRestore}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors"
                    >
                      <Square size={14} />
                      Clear All
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {/* Categories */}
                  <GroupCheckbox
                    label="Categories"
                    icon={FolderOpen}
                    checked={restoreOptions.restoreCategories}
                    onChange={(checked) => setRestoreOptions(prev => ({ ...prev, restoreCategories: checked }))}
                    disabled={!restoreManifest?.contents.categories}
                  />

                  {/* Documents */}
                  <GroupCheckbox
                    label="Documents"
                    icon={FileText}
                    checked={restoreOptions.restoreDocuments}
                    onChange={(checked) => setRestoreOptions(prev => ({
                      ...prev,
                      restoreDocuments: checked,
                      restoreDocumentFiles: checked ? prev.restoreDocumentFiles : false
                    }))}
                    disabled={!restoreManifest?.contents.documents}
                    defaultExpanded
                  >
                    <SubCheckbox
                      label="Include Files"
                      checked={restoreOptions.restoreDocumentFiles}
                      onChange={(checked) => setRestoreOptions(prev => ({ ...prev, restoreDocumentFiles: checked }))}
                      disabled={!restoreManifest?.contents.documentFiles || !restoreOptions.restoreDocuments}
                    />
                  </GroupCheckbox>

                  {/* Users */}
                  <GroupCheckbox
                    label="Users"
                    icon={Users}
                    checked={restoreOptions.restoreUsers}
                    onChange={(checked) => setRestoreOptions(prev => ({
                      ...prev,
                      restoreUsers: checked,
                      restoreUserMemories: checked ? prev.restoreUserMemories : false
                    }))}
                    disabled={!restoreManifest?.contents.users}
                    defaultExpanded
                  >
                    <SubCheckbox
                      label="User Memories"
                      checked={restoreOptions.restoreUserMemories}
                      onChange={(checked) => setRestoreOptions(prev => ({ ...prev, restoreUserMemories: checked }))}
                      disabled={!restoreManifest?.contents.userMemories || !restoreOptions.restoreUsers}
                    />
                  </GroupCheckbox>

                  {/* Prompts */}
                  <GroupCheckbox
                    label="Prompts"
                    icon={MessageCircle}
                    checked={restoreOptions.restoreCategoryPrompts}
                    onChange={(checked) => setRestoreOptions(prev => ({ ...prev, restoreCategoryPrompts: checked }))}
                    disabled={!restoreManifest?.contents.categoryPrompts}
                  />

                  {/* Agents */}
                  <GroupCheckbox
                    label="Agents"
                    icon={Bot}
                    checked={restoreOptions.restoreAgentBots}
                    onChange={(checked) => setRestoreOptions(prev => ({ ...prev, restoreAgentBots: checked }))}
                    disabled={!restoreManifest?.contents.agentBots}
                  />

                  {/* Skills */}
                  <GroupCheckbox
                    label="Skills"
                    icon={Sparkles}
                    checked={restoreOptions.restoreSkills}
                    onChange={(checked) => setRestoreOptions(prev => ({
                      ...prev,
                      restoreSkills: checked,
                      restoreTools: checked ? prev.restoreTools : false,
                      restoreDataSources: checked ? prev.restoreDataSources : false,
                      restoreFunctionApis: checked ? prev.restoreFunctionApis : false,
                      restoreToolRouting: checked ? prev.restoreToolRouting : false,
                    }))}
                    disabled={!restoreManifest?.contents.skills}
                    defaultExpanded
                  >
                    <SubCheckbox
                      label="Tools"
                      checked={restoreOptions.restoreTools}
                      onChange={(checked) => setRestoreOptions(prev => ({ ...prev, restoreTools: checked }))}
                      disabled={!restoreManifest?.contents.tools || !restoreOptions.restoreSkills}
                    />
                    <SubCheckbox
                      label="Data Sources"
                      checked={restoreOptions.restoreDataSources}
                      onChange={(checked) => setRestoreOptions(prev => ({ ...prev, restoreDataSources: checked }))}
                      disabled={!restoreManifest?.contents.dataSources || !restoreOptions.restoreSkills}
                    />
                    <SubCheckbox
                      label="Function APIs"
                      checked={restoreOptions.restoreFunctionApis}
                      onChange={(checked) => setRestoreOptions(prev => ({ ...prev, restoreFunctionApis: checked }))}
                      disabled={!restoreManifest?.contents.functionApis || !restoreOptions.restoreSkills}
                    />
                    <SubCheckbox
                      label="Tool Routing"
                      checked={restoreOptions.restoreToolRouting}
                      onChange={(checked) => setRestoreOptions(prev => ({ ...prev, restoreToolRouting: checked }))}
                      disabled={!restoreManifest?.contents.toolRouting || !restoreOptions.restoreSkills}
                    />
                  </GroupCheckbox>

                  {/* Workspaces */}
                  <GroupCheckbox
                    label="Workspaces"
                    icon={LayoutGrid}
                    checked={restoreOptions.restoreWorkspaces}
                    onChange={(checked) => setRestoreOptions(prev => ({ ...prev, restoreWorkspaces: checked }))}
                    disabled={!restoreManifest?.contents.workspaces}
                  />

                  {/* Settings */}
                  <GroupCheckbox
                    label="Settings"
                    icon={Settings}
                    checked={restoreOptions.restoreSettings}
                    onChange={(checked) => setRestoreOptions(prev => ({ ...prev, restoreSettings: checked }))}
                    disabled={!restoreManifest?.contents.settings}
                  />

                  {/* Threads */}
                  <GroupCheckbox
                    label="Threads"
                    icon={MessageSquare}
                    checked={restoreOptions.restoreThreads}
                    onChange={(checked) => setRestoreOptions(prev => ({
                      ...prev,
                      restoreThreads: checked,
                      restoreThreadShares: checked ? prev.restoreThreadShares : false
                    }))}
                    disabled={!restoreManifest?.contents.threads}
                    defaultExpanded={restoreOptions.restoreThreads}
                  >
                    <SubCheckbox
                      label="Thread Shares"
                      checked={restoreOptions.restoreThreadShares}
                      onChange={(checked) => setRestoreOptions(prev => ({ ...prev, restoreThreadShares: checked }))}
                      disabled={!restoreManifest?.contents.threadShares || !restoreOptions.restoreThreads}
                    />
                  </GroupCheckbox>
                </div>

                {/* Advanced Options */}
                <div className="border-t pt-3 space-y-3">
                  <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 bg-red-50 border-red-200">
                    <input
                      type="checkbox"
                      checked={restoreOptions.clearExisting}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, clearExisting: e.target.checked }))}
                      className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                    <AlertTriangle size={18} className="text-red-600" />
                    <div>
                      <span className="text-sm font-medium text-red-700">Clear existing data before restore</span>
                      <p className="text-xs text-red-600">This will DELETE all current data! Use with caution.</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 bg-green-50 border-green-200">
                    <input
                      type="checkbox"
                      checked={restoreOptions.refreshVectorDb}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, refreshVectorDb: e.target.checked }))}
                      className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <RefreshCw size={18} className="text-green-600" />
                    <div>
                      <span className="text-sm font-medium text-green-700">Refresh Vector DB after restore</span>
                      <p className="text-xs text-green-600">Recommended for new instances - rebuilds document embeddings</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Restore Button */}
              <div className="flex justify-end pt-4 border-t">
                <Button
                  onClick={handleRestore}
                  disabled={restoreInProgress}
                  variant={restoreOptions.clearExisting ? 'danger' : 'primary'}
                >
                  {restoreInProgress ? (
                    <>
                      <Spinner size="sm" className="mr-2" />
                      Restoring...
                    </>
                  ) : (
                    <>
                      <UploadCloud size={16} className="mr-2" />
                      Restore Backup
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Restore Result */}
          {restoreResult && (
            <div className={`mt-4 p-4 rounded-lg ${restoreResult.success ? 'bg-green-50' : 'bg-red-50'}`}>
              <div className="flex items-center gap-2 mb-2">
                {restoreResult.success ? (
                  <CheckCircle className="text-green-600" size={20} />
                ) : (
                  <AlertCircle className="text-red-600" size={20} />
                )}
                <span className={`font-medium ${restoreResult.success ? 'text-green-700' : 'text-red-700'}`}>
                  {restoreResult.message}
                </span>
              </div>
              {restoreResult.success && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm mt-3">
                  {restoreResult.details.categoriesRestored > 0 && (
                    <div>Categories: {restoreResult.details.categoriesRestored}</div>
                  )}
                  {restoreResult.details.documentsRestored > 0 && (
                    <div>Documents: {restoreResult.details.documentsRestored}</div>
                  )}
                  {restoreResult.details.filesRestored > 0 && (
                    <div>Files: {restoreResult.details.filesRestored}</div>
                  )}
                  {restoreResult.details.usersRestored > 0 && (
                    <div>Users: {restoreResult.details.usersRestored}</div>
                  )}
                  {(restoreResult.details.userMemoriesRestored ?? 0) > 0 && (
                    <div>Memories: {restoreResult.details.userMemoriesRestored}</div>
                  )}
                  {restoreResult.details.categoryPromptsRestored > 0 && (
                    <div>Prompts: {restoreResult.details.categoryPromptsRestored}</div>
                  )}
                  {(restoreResult.details.agentBotsRestored ?? 0) > 0 && (
                    <div>Agents: {restoreResult.details.agentBotsRestored}</div>
                  )}
                  {restoreResult.details.skillsRestored > 0 && (
                    <div>Skills: {restoreResult.details.skillsRestored}</div>
                  )}
                  {restoreResult.details.toolsRestored > 0 && (
                    <div>Tools: {restoreResult.details.toolsRestored}</div>
                  )}
                  {restoreResult.details.dataSourcesRestored > 0 && (
                    <div>Data Sources: {restoreResult.details.dataSourcesRestored}</div>
                  )}
                  {(restoreResult.details.functionApisRestored ?? 0) > 0 && (
                    <div>Function APIs: {restoreResult.details.functionApisRestored}</div>
                  )}
                  {(restoreResult.details.toolRoutingRulesRestored ?? 0) > 0 && (
                    <div>Routing Rules: {restoreResult.details.toolRoutingRulesRestored}</div>
                  )}
                  {(restoreResult.details.workspacesRestored ?? 0) > 0 && (
                    <div>Workspaces: {restoreResult.details.workspacesRestored}</div>
                  )}
                  {restoreResult.details.settingsRestored > 0 && (
                    <div>Settings: {restoreResult.details.settingsRestored}</div>
                  )}
                  {restoreResult.details.threadsRestored > 0 && (
                    <div>Threads: {restoreResult.details.threadsRestored}</div>
                  )}
                  {(restoreResult.details.threadSharesRestored ?? 0) > 0 && (
                    <div>Shares: {restoreResult.details.threadSharesRestored}</div>
                  )}
                </div>
              )}
              {restoreResult.warnings.length > 0 && (
                <div className="mt-3 space-y-1">
                  {restoreResult.warnings.map((warning, i) => (
                    <div key={i} className="text-sm text-yellow-700 flex items-start gap-2">
                      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                      {warning}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useRef, useCallback } from 'react';
import { Download, UploadCloud, AlertTriangle, CheckCircle, FileText, Users, FolderOpen, Settings, MessageSquare, FileCode, RefreshCw, AlertCircle, Wrench, Sparkles, MessageCircle, Database, LayoutGrid, Zap, Brain, GitBranch, Share2, ListTodo, CheckSquare, Square } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

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
    // NEW content flags
    workspaces?: boolean;
    functionApis?: boolean;
    userMemories?: boolean;
    toolRouting?: boolean;
    threadShares?: boolean;
    taskPlans?: boolean;
    workspaceCount?: number;
    functionApiCount?: number;
    userMemoryCount?: number;
    toolRoutingRuleCount?: number;
    threadShareCount?: number;
    taskPlanCount?: number;
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
    // NEW restore counts
    workspacesRestored?: number;
    functionApisRestored?: number;
    userMemoriesRestored?: number;
    toolRoutingRulesRestored?: number;
    threadSharesRestored?: number;
    taskPlansRestored?: number;
  };
  warnings: string[];
}

export default function BackupTab() {
  // Backup state
  const [backupInProgress, setBackupInProgress] = useState(false);
  const [backupOptions, setBackupOptions] = useState({
    includeDocuments: true,
    includeDocumentFiles: true,
    includeCategories: true,
    includeSettings: true,
    includeUsers: true,
    includeThreads: false,
    includeTools: true,
    includeSkills: true,
    includeCategoryPrompts: true,
    includeDataSources: true,
    // NEW backup options
    includeWorkspaces: true,
    includeFunctionApis: true,
    includeUserMemories: true,
    includeToolRouting: true,
    includeThreadShares: false,
    includeTaskPlans: false,
  });

  // Restore state
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreManifest, setRestoreManifest] = useState<BackupManifest | null>(null);
  const [restoreInProgress, setRestoreInProgress] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [restoreOptions, setRestoreOptions] = useState({
    clearExisting: false,
    restoreDocuments: true,
    restoreDocumentFiles: true,
    restoreCategories: true,
    restoreSettings: true,
    restoreUsers: true,
    restoreThreads: false,
    restoreTools: true,
    restoreSkills: true,
    restoreCategoryPrompts: true,
    restoreDataSources: true,
    refreshVectorDb: true,
    // NEW restore options
    restoreWorkspaces: true,
    restoreFunctionApis: true,
    restoreUserMemories: true,
    restoreToolRouting: true,
    restoreThreadShares: false,
    restoreTaskPlans: false,
  });

  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Select all / clear all handlers for backup options
  const handleSelectAllBackup = useCallback(() => {
    setBackupOptions({
      includeDocuments: true,
      includeDocumentFiles: true,
      includeCategories: true,
      includeSettings: true,
      includeUsers: true,
      includeThreads: true,
      includeTools: true,
      includeSkills: true,
      includeCategoryPrompts: true,
      includeDataSources: true,
      includeWorkspaces: true,
      includeFunctionApis: true,
      includeUserMemories: true,
      includeToolRouting: true,
      includeThreadShares: true,
      includeTaskPlans: true,
    });
  }, []);

  const handleClearAllBackup = useCallback(() => {
    setBackupOptions({
      includeDocuments: false,
      includeDocumentFiles: false,
      includeCategories: false,
      includeSettings: false,
      includeUsers: false,
      includeThreads: false,
      includeTools: false,
      includeSkills: false,
      includeCategoryPrompts: false,
      includeDataSources: false,
      includeWorkspaces: false,
      includeFunctionApis: false,
      includeUserMemories: false,
      includeToolRouting: false,
      includeThreadShares: false,
      includeTaskPlans: false,
    });
  }, []);

  // Select all / clear all handlers for restore options
  const handleSelectAllRestore = useCallback(() => {
    if (!restoreManifest?.contents) return;
    setRestoreOptions(prev => ({
      ...prev,
      restoreDocuments: restoreManifest.contents.documents,
      restoreDocumentFiles: restoreManifest.contents.documentFiles,
      restoreCategories: restoreManifest.contents.categories,
      restoreSettings: restoreManifest.contents.settings,
      restoreUsers: restoreManifest.contents.users,
      restoreThreads: restoreManifest.contents.threads,
      restoreTools: restoreManifest.contents.tools ?? false,
      restoreSkills: restoreManifest.contents.skills ?? false,
      restoreCategoryPrompts: restoreManifest.contents.categoryPrompts ?? false,
      restoreDataSources: restoreManifest.contents.dataSources ?? false,
      restoreWorkspaces: restoreManifest.contents.workspaces ?? false,
      restoreFunctionApis: restoreManifest.contents.functionApis ?? false,
      restoreUserMemories: restoreManifest.contents.userMemories ?? false,
      restoreToolRouting: restoreManifest.contents.toolRouting ?? false,
      restoreThreadShares: restoreManifest.contents.threadShares ?? false,
      restoreTaskPlans: restoreManifest.contents.taskPlans ?? false,
    }));
  }, [restoreManifest]);

  const handleClearAllRestore = useCallback(() => {
    setRestoreOptions(prev => ({
      ...prev,
      restoreDocuments: false,
      restoreDocumentFiles: false,
      restoreCategories: false,
      restoreSettings: false,
      restoreUsers: false,
      restoreThreads: false,
      restoreTools: false,
      restoreSkills: false,
      restoreCategoryPrompts: false,
      restoreDataSources: false,
      restoreWorkspaces: false,
      restoreFunctionApis: false,
      restoreUserMemories: false,
      restoreToolRouting: false,
      restoreThreadShares: false,
      restoreTaskPlans: false,
    }));
  }, []);

  // Handle backup creation
  const handleCreateBackup = async () => {
    setBackupInProgress(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupOptions),
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
          restoreDocuments: data.manifest.contents.documents,
          restoreDocumentFiles: data.manifest.contents.documentFiles,
          restoreCategories: data.manifest.contents.categories,
          restoreSettings: data.manifest.contents.settings,
          restoreUsers: data.manifest.contents.users,
          restoreThreads: data.manifest.contents.threads,
          restoreTools: data.manifest.contents.tools ?? false,
          restoreSkills: data.manifest.contents.skills ?? false,
          restoreCategoryPrompts: data.manifest.contents.categoryPrompts ?? false,
          restoreDataSources: data.manifest.contents.dataSources ?? false,
          // NEW restore options
          restoreWorkspaces: data.manifest.contents.workspaces ?? false,
          restoreFunctionApis: data.manifest.contents.functionApis ?? false,
          restoreUserMemories: data.manifest.contents.userMemories ?? false,
          restoreToolRouting: data.manifest.contents.toolRouting ?? false,
          restoreThreadShares: data.manifest.contents.threadShares ?? false,
          restoreTaskPlans: data.manifest.contents.taskPlans ?? false,
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

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeDocuments}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeDocuments: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <FileText size={18} className="text-gray-500" />
                <span className="text-sm">Documents</span>
              </label>

              <label className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${!backupOptions.includeDocuments ? 'opacity-50' : ''}`}>
                <input
                  type="checkbox"
                  checked={backupOptions.includeDocumentFiles}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeDocumentFiles: e.target.checked }))}
                  disabled={!backupOptions.includeDocuments}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <FileCode size={18} className="text-gray-500" />
                <span className="text-sm">Include Files</span>
              </label>

              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeCategories}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeCategories: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <FolderOpen size={18} className="text-gray-500" />
                <span className="text-sm">Categories</span>
              </label>

              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeSettings}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeSettings: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <Settings size={18} className="text-gray-500" />
                <span className="text-sm">Settings</span>
              </label>

              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeUsers}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeUsers: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <Users size={18} className="text-gray-500" />
                <span className="text-sm">Users</span>
              </label>

              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeThreads}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeThreads: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <MessageSquare size={18} className="text-gray-500" />
                <span className="text-sm">Threads</span>
              </label>

              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeTools}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeTools: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <Wrench size={18} className="text-gray-500" />
                <span className="text-sm">Tools</span>
              </label>

              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeSkills}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeSkills: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <Sparkles size={18} className="text-gray-500" />
                <span className="text-sm">Skills</span>
              </label>

              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeCategoryPrompts}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeCategoryPrompts: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <MessageCircle size={18} className="text-gray-500" />
                <span className="text-sm">Prompts & Starters</span>
              </label>

              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeDataSources}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeDataSources: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <Database size={18} className="text-gray-500" />
                <span className="text-sm">Data Sources</span>
              </label>

              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeWorkspaces}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeWorkspaces: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <LayoutGrid size={18} className="text-gray-500" />
                <span className="text-sm">Workspaces</span>
              </label>

              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeFunctionApis}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeFunctionApis: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <Zap size={18} className="text-gray-500" />
                <span className="text-sm">Function APIs</span>
              </label>

              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeUserMemories}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeUserMemories: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <Brain size={18} className="text-gray-500" />
                <span className="text-sm">User Memories</span>
              </label>

              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeToolRouting}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeToolRouting: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <GitBranch size={18} className="text-gray-500" />
                <span className="text-sm">Tool Routing</span>
              </label>

              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeThreadShares}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeThreadShares: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <Share2 size={18} className="text-gray-500" />
                <span className="text-sm">Thread Shares</span>
              </label>

              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={backupOptions.includeTaskPlans}
                  onChange={(e) => setBackupOptions(prev => ({ ...prev, includeTaskPlans: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <ListTodo size={18} className="text-gray-500" />
                <span className="text-sm">Task Plans</span>
              </label>
            </div>

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
                    {restoreManifest.contents.documents && (
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.documentCount} Documents</span>
                      </div>
                    )}
                    {restoreManifest.contents.categories && (
                      <div className="flex items-center gap-2">
                        <FolderOpen size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.categoryCount} Categories</span>
                      </div>
                    )}
                    {restoreManifest.contents.users && (
                      <div className="flex items-center gap-2">
                        <Users size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.userCount} Users</span>
                      </div>
                    )}
                    {restoreManifest.contents.threads && (
                      <div className="flex items-center gap-2">
                        <MessageSquare size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.threadCount} Threads</span>
                      </div>
                    )}
                    {restoreManifest.contents.tools && (
                      <div className="flex items-center gap-2">
                        <Wrench size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.toolCount} Tools</span>
                      </div>
                    )}
                    {restoreManifest.contents.skills && (
                      <div className="flex items-center gap-2">
                        <Sparkles size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.skillCount} Skills</span>
                      </div>
                    )}
                    {restoreManifest.contents.categoryPrompts && (
                      <div className="flex items-center gap-2">
                        <MessageCircle size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.categoryPromptCount} Prompts</span>
                      </div>
                    )}
                    {restoreManifest.contents.dataSources && (
                      <div className="flex items-center gap-2">
                        <Database size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.dataSourceCount} Data Sources</span>
                      </div>
                    )}
                    {restoreManifest.contents.workspaces && (
                      <div className="flex items-center gap-2">
                        <LayoutGrid size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.workspaceCount} Workspaces</span>
                      </div>
                    )}
                    {restoreManifest.contents.functionApis && (
                      <div className="flex items-center gap-2">
                        <Zap size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.functionApiCount} Function APIs</span>
                      </div>
                    )}
                    {restoreManifest.contents.userMemories && (
                      <div className="flex items-center gap-2">
                        <Brain size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.userMemoryCount} User Memories</span>
                      </div>
                    )}
                    {restoreManifest.contents.toolRouting && (
                      <div className="flex items-center gap-2">
                        <GitBranch size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.toolRoutingRuleCount} Routing Rules</span>
                      </div>
                    )}
                    {restoreManifest.contents.threadShares && (
                      <div className="flex items-center gap-2">
                        <Share2 size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.threadShareCount} Thread Shares</span>
                      </div>
                    )}
                    {restoreManifest.contents.taskPlans && (
                      <div className="flex items-center gap-2">
                        <ListTodo size={14} className="text-blue-600" />
                        <span>{restoreManifest.contents.taskPlanCount} Task Plans</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-blue-600">
                    Created: {new Date(restoreManifest.createdAt).toLocaleString()} by {restoreManifest.createdBy}
                  </div>
                </div>
              )}

              {/* Restore Options */}
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
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.documents ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreDocuments}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreDocuments: e.target.checked }))}
                      disabled={!restoreManifest?.contents.documents}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Documents</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.documentFiles || !restoreOptions.restoreDocuments ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreDocumentFiles}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreDocumentFiles: e.target.checked }))}
                      disabled={!restoreManifest?.contents.documentFiles || !restoreOptions.restoreDocuments}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Include Files</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.categories ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreCategories}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreCategories: e.target.checked }))}
                      disabled={!restoreManifest?.contents.categories}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Categories</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.settings ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreSettings}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreSettings: e.target.checked }))}
                      disabled={!restoreManifest?.contents.settings}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Settings</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.users ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreUsers}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreUsers: e.target.checked }))}
                      disabled={!restoreManifest?.contents.users}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Users</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.threads ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreThreads}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreThreads: e.target.checked }))}
                      disabled={!restoreManifest?.contents.threads}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Threads</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.tools ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreTools}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreTools: e.target.checked }))}
                      disabled={!restoreManifest?.contents.tools}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Tools</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.skills ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreSkills}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreSkills: e.target.checked }))}
                      disabled={!restoreManifest?.contents.skills}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Skills</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.categoryPrompts ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreCategoryPrompts}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreCategoryPrompts: e.target.checked }))}
                      disabled={!restoreManifest?.contents.categoryPrompts}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Prompts & Starters</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.dataSources ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreDataSources}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreDataSources: e.target.checked }))}
                      disabled={!restoreManifest?.contents.dataSources}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Data Sources</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.workspaces ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreWorkspaces}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreWorkspaces: e.target.checked }))}
                      disabled={!restoreManifest?.contents.workspaces}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Workspaces</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.functionApis ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreFunctionApis}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreFunctionApis: e.target.checked }))}
                      disabled={!restoreManifest?.contents.functionApis}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Function APIs</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.userMemories ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreUserMemories}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreUserMemories: e.target.checked }))}
                      disabled={!restoreManifest?.contents.userMemories}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">User Memories</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.toolRouting ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreToolRouting}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreToolRouting: e.target.checked }))}
                      disabled={!restoreManifest?.contents.toolRouting}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Tool Routing</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.threadShares ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreThreadShares}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreThreadShares: e.target.checked }))}
                      disabled={!restoreManifest?.contents.threadShares}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Thread Shares</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${!restoreManifest?.contents.taskPlans ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={restoreOptions.restoreTaskPlans}
                      onChange={(e) => setRestoreOptions(prev => ({ ...prev, restoreTaskPlans: e.target.checked }))}
                      disabled={!restoreManifest?.contents.taskPlans}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm">Task Plans</span>
                  </label>
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
                  {restoreResult.details.documentsRestored > 0 && (
                    <div>Documents: {restoreResult.details.documentsRestored}</div>
                  )}
                  {restoreResult.details.categoriesRestored > 0 && (
                    <div>Categories: {restoreResult.details.categoriesRestored}</div>
                  )}
                  {restoreResult.details.usersRestored > 0 && (
                    <div>Users: {restoreResult.details.usersRestored}</div>
                  )}
                  {restoreResult.details.threadsRestored > 0 && (
                    <div>Threads: {restoreResult.details.threadsRestored}</div>
                  )}
                  {restoreResult.details.filesRestored > 0 && (
                    <div>Files: {restoreResult.details.filesRestored}</div>
                  )}
                  {restoreResult.details.settingsRestored > 0 && (
                    <div>Settings: {restoreResult.details.settingsRestored}</div>
                  )}
                  {restoreResult.details.toolsRestored > 0 && (
                    <div>Tools: {restoreResult.details.toolsRestored}</div>
                  )}
                  {restoreResult.details.skillsRestored > 0 && (
                    <div>Skills: {restoreResult.details.skillsRestored}</div>
                  )}
                  {restoreResult.details.categoryPromptsRestored > 0 && (
                    <div>Prompts: {restoreResult.details.categoryPromptsRestored}</div>
                  )}
                  {restoreResult.details.dataSourcesRestored > 0 && (
                    <div>Data Sources: {restoreResult.details.dataSourcesRestored}</div>
                  )}
                  {(restoreResult.details.workspacesRestored ?? 0) > 0 && (
                    <div>Workspaces: {restoreResult.details.workspacesRestored}</div>
                  )}
                  {(restoreResult.details.functionApisRestored ?? 0) > 0 && (
                    <div>Function APIs: {restoreResult.details.functionApisRestored}</div>
                  )}
                  {(restoreResult.details.userMemoriesRestored ?? 0) > 0 && (
                    <div>User Memories: {restoreResult.details.userMemoriesRestored}</div>
                  )}
                  {(restoreResult.details.toolRoutingRulesRestored ?? 0) > 0 && (
                    <div>Tool Routing: {restoreResult.details.toolRoutingRulesRestored}</div>
                  )}
                  {(restoreResult.details.threadSharesRestored ?? 0) > 0 && (
                    <div>Thread Shares: {restoreResult.details.threadSharesRestored}</div>
                  )}
                  {(restoreResult.details.taskPlansRestored ?? 0) > 0 && (
                    <div>Task Plans: {restoreResult.details.taskPlansRestored}</div>
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

'use client';

import { useState, useCallback, useEffect } from 'react';
import { Save, FileText, ImageIcon, File } from 'lucide-react';
import Button from '@/components/ui/Button';

interface UploadLimits {
  maxFilesPerInput: number;
  maxFilesPerThread: number;
  maxFileSizeMB: number;
  allowedTypes: string[];
  updatedAt?: string;
  updatedBy?: string;
}

// File type definitions with groups
const FILE_TYPE_GROUPS = [
  {
    group: 'Documents',
    icon: FileText,
    types: [
      { mime: 'application/pdf', label: 'PDF', extension: '.pdf' },
      { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word (DOCX)', extension: '.docx' },
      { mime: 'application/msword', label: 'Word (DOC)', extension: '.doc' },
      { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel (XLSX)', extension: '.xlsx' },
      { mime: 'application/vnd.ms-excel', label: 'Excel (XLS)', extension: '.xls' },
      { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint (PPTX)', extension: '.pptx' },
      { mime: 'application/vnd.ms-powerpoint', label: 'PowerPoint (PPT)', extension: '.ppt' },
    ],
  },
  {
    group: 'Text',
    icon: File,
    types: [
      { mime: 'text/plain', label: 'Plain Text (TXT)', extension: '.txt' },
      { mime: 'text/markdown', label: 'Markdown (MD)', extension: '.md' },
      { mime: 'text/html', label: 'HTML', extension: '.html' },
      { mime: 'text/csv', label: 'CSV', extension: '.csv' },
      { mime: 'application/json', label: 'JSON', extension: '.json' },
    ],
  },
  {
    group: 'Images',
    icon: ImageIcon,
    types: [
      { mime: 'image/png', label: 'PNG', extension: '.png' },
      { mime: 'image/jpeg', label: 'JPEG/JPG', extension: '.jpg' },
      { mime: 'image/webp', label: 'WebP', extension: '.webp' },
    ],
  },
];

export default function FileUploadSettings({ readOnly = false }: { readOnly?: boolean }) {
  const [settings, setSettings] = useState<UploadLimits | null>(null);
  const [editedSettings, setEditedSettings] = useState<UploadLimits | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/admin/settings');
      if (!res.ok) throw new Error('Failed to fetch settings');
      const data = await res.json();

      const uploadData = data.uploadLimits || {
        maxFilesPerInput: 5,
        maxFilesPerThread: 10,
        maxFileSizeMB: 25,
        allowedTypes: [],
      };

      setSettings(uploadData);
      setEditedSettings(uploadData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch settings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load settings on mount
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveSettings = async () => {
    if (!editedSettings) return;

    try {
      setIsSaving(true);
      setError(null);

      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'uploadLimits',
          settings: {
            maxFilesPerInput: editedSettings.maxFilesPerInput,
            maxFilesPerThread: editedSettings.maxFilesPerThread,
            maxFileSizeMB: editedSettings.maxFileSizeMB,
            allowedTypes: editedSettings.allowedTypes,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save settings');
      }

      setSettings(editedSettings);
      setSuccess('Settings saved successfully');

      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle a file type
  const toggleFileType = (mimeType: string) => {
    if (!editedSettings) return;

    const newAllowedTypes = editedSettings.allowedTypes.includes(mimeType)
      ? editedSettings.allowedTypes.filter((t) => t !== mimeType)
      : [...editedSettings.allowedTypes, mimeType];

    setEditedSettings({
      ...editedSettings,
      allowedTypes: newAllowedTypes,
    });
  };

  // Toggle all types in a group
  const toggleGroup = (types: { mime: string }[]) => {
    if (!editedSettings) return;

    const groupMimes = types.map((t) => t.mime);
    const allEnabled = groupMimes.every((m) => editedSettings.allowedTypes.includes(m));

    let newAllowedTypes: string[];
    if (allEnabled) {
      // Disable all in group
      newAllowedTypes = editedSettings.allowedTypes.filter((t) => !groupMimes.includes(t));
    } else {
      // Enable all in group
      newAllowedTypes = [...new Set([...editedSettings.allowedTypes, ...groupMimes])];
    }

    setEditedSettings({
      ...editedSettings,
      allowedTypes: newAllowedTypes,
    });
  };

  // Check if all types in a group are enabled
  const isGroupEnabled = (types: { mime: string }[]) => {
    if (!editedSettings) return false;
    return types.every((t) => editedSettings.allowedTypes.includes(t.mime));
  };

  // Check if some types in a group are enabled (indeterminate state)
  const isGroupPartial = (types: { mime: string }[]) => {
    if (!editedSettings) return false;
    const enabledCount = types.filter((t) => editedSettings.allowedTypes.includes(t.mime)).length;
    return enabledCount > 0 && enabledCount < types.length;
  };

  // Update numeric setting
  const updateNumeric = (field: keyof UploadLimits, value: number) => {
    if (!editedSettings) return;
    setEditedSettings({ ...editedSettings, [field]: value });
  };

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return 'Never';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">Loading settings...</div>
      </div>
    );
  }

  const displaySettings = editedSettings || {
    maxFilesPerInput: 5,
    maxFilesPerThread: 10,
    maxFileSizeMB: 25,
    allowedTypes: [] as string[],
  };

  const isModified = JSON.stringify(settings) !== JSON.stringify(editedSettings);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">File Upload Settings</h2>
        <p className="text-sm text-gray-500 mt-1">
          Configure allowed file types and upload limits for the chat input box.
        </p>
        {settings?.updatedAt && (
          <p className="text-xs text-gray-400 mt-2">
            Last updated: {formatDate(settings.updatedAt)} by {settings.updatedBy || 'admin'}
          </p>
        )}
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {success}
        </div>
      )}

      {/* Upload Limits */}
      <div className="bg-white border rounded-lg p-4 space-y-4">
        <h3 className="text-sm font-medium text-gray-700">Upload Limits</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Max Files Per Input */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Max Files Per Message
            </label>
            <input
              type="number"
              min="1"
              max="20"
              value={displaySettings.maxFilesPerInput}
              onChange={(e) => updateNumeric('maxFilesPerInput', parseInt(e.target.value) || 1)}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={readOnly || isSaving}
            />
          </div>

          {/* Max Files Per Thread */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Max Files Per Thread
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={displaySettings.maxFilesPerThread}
              onChange={(e) => updateNumeric('maxFilesPerThread', parseInt(e.target.value) || 1)}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={readOnly || isSaving}
            />
          </div>

          {/* Max File Size */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Max File Size (MB)
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={displaySettings.maxFileSizeMB}
              onChange={(e) => updateNumeric('maxFileSizeMB', parseInt(e.target.value) || 1)}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={readOnly || isSaving}
            />
          </div>
        </div>
      </div>

      {/* File Type Groups */}
      <div className="bg-white border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-700">Allowed File Types</h3>
          <div className="text-xs text-gray-500">
            {displaySettings.allowedTypes.length} of 18 types enabled
          </div>
        </div>

        <div className="space-y-4">
          {FILE_TYPE_GROUPS.map((group) => {
            const GroupIcon = group.icon;
            const groupEnabled = isGroupEnabled(group.types);
            const groupPartial = isGroupPartial(group.types);

            return (
              <div key={group.group} className="border rounded-lg p-3">
                {/* Group Header */}
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    id={`group-${group.group}`}
                    checked={groupEnabled}
                    ref={(el) => {
                      if (el) el.indeterminate = groupPartial;
                    }}
                    onChange={() => toggleGroup(group.types)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    disabled={readOnly || isSaving}
                  />
                  <GroupIcon size={16} className="text-gray-500" />
                  <label
                    htmlFor={`group-${group.group}`}
                    className="text-sm font-medium text-gray-700 cursor-pointer"
                  >
                    {group.group}
                  </label>
                </div>

                {/* Types Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 ml-6">
                  {group.types.map((type) => {
                    const isEnabled = displaySettings.allowedTypes.includes(type.mime);

                    return (
                      <label
                        key={type.mime}
                        className={`
                          flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors
                          ${isEnabled
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-gray-200 hover:bg-gray-50'
                          }
                          ${readOnly ? 'cursor-not-allowed opacity-60' : ''}
                        `}
                      >
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={() => toggleFileType(type.mime)}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          disabled={readOnly || isSaving}
                        />
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-gray-700">{type.label}</span>
                          <span className="text-xs text-gray-400">{type.extension}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Save Button */}
      {!readOnly && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500">
            {displaySettings.allowedTypes.length === 0 && (
              <span className="text-amber-600">Warning: No file types selected. Users will not be able to upload any files.</span>
            )}
          </div>
          <Button
            onClick={saveSettings}
            disabled={!isModified || isSaving}
            className="flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <span className="animate-spin">⟳</span>
                Saving...
              </>
            ) : (
              <>
                <Save size={16} />
                Save Changes
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

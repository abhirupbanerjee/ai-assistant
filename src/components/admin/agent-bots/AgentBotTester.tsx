'use client';

/**
 * Agent Bot Tester
 *
 * Interactive test panel for trying out an agent bot with sample inputs.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { PlayCircle, AlertCircle, Download, Clock, Upload, X, FileText } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface AgentBot {
  id: string;
  name: string;
  slug: string;
}

interface Version {
  id: string;
  version_number: number;
  version_label: string | null;
  is_default: boolean;
  input_schema: {
    parameters: Array<{
      name: string;
      type: string;
      description?: string;
      required?: boolean;
      default?: unknown;
    }>;
    files?: {
      enabled: boolean;
      maxFiles?: number;
      maxSizePerFileMB?: number;
      allowedTypes?: string[];
      required?: boolean;
    };
  };
  output_config: {
    enabledTypes: string[];
    defaultType: string;
  };
}

interface TestResult {
  success: boolean;
  jobId?: string;
  outputs?: Array<{
    type: string;
    content?: unknown;
    downloadUrl?: string;
    filename?: string;
  }>;
  error?: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  processingTimeMs?: number;
}

interface AgentBotTesterProps {
  agentBot: AgentBot;
}

export default function AgentBotTester({ agentBot }: AgentBotTesterProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<Version | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Input state
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [outputType, setOutputType] = useState('');
  const [isAsync, setIsAsync] = useState(false);

  // File upload state
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [uploadedFileIds, setUploadedFileIds] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Test state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Load versions
  const loadVersions = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(
        `/api/admin/agent-bots/${agentBot.id}/versions`
      );
      if (!response.ok) throw new Error('Failed to load versions');
      const data = await response.json();
      const versionList = data.versions || [];
      setVersions(versionList);

      // Select default version
      const defaultVersion = versionList.find((v: Version) => v.is_default) || versionList[0];
      if (defaultVersion) {
        setSelectedVersion(defaultVersion);
        setOutputType(defaultVersion.output_config.defaultType);

        // Initialize input values
        const initialValues: Record<string, string> = {};
        defaultVersion.input_schema.parameters.forEach((param: Version['input_schema']['parameters'][0]) => {
          initialValues[param.name] = param.default?.toString() || '';
        });
        setInputValues(initialValues);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load versions');
    } finally {
      setIsLoading(false);
    }
  }, [agentBot.id]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  // Handle version change
  const handleVersionChange = (versionId: string) => {
    const version = versions.find((v) => v.id === versionId);
    if (version) {
      setSelectedVersion(version);
      setOutputType(version.output_config.defaultType);
      setTestResult(null);

      // Reset input values
      const initialValues: Record<string, string> = {};
      version.input_schema.parameters.forEach((param) => {
        initialValues[param.name] = param.default?.toString() || '';
      });
      setInputValues(initialValues);

      // Reset files
      setUploadedFiles([]);
      setUploadedFileIds([]);
    }
  };

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileConfig = selectedVersion?.input_schema.files;
    const maxFiles = fileConfig?.maxFiles || 5;
    const maxSizeMB = fileConfig?.maxSizePerFileMB || 10;
    const allowedTypes = fileConfig?.allowedTypes;

    // Validate and add files
    const newFiles: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Check max files
      if (uploadedFiles.length + newFiles.length >= maxFiles) {
        setError(`Maximum ${maxFiles} files allowed`);
        break;
      }

      // Check file size
      if (file.size > maxSizeMB * 1024 * 1024) {
        setError(`File "${file.name}" exceeds ${maxSizeMB}MB limit`);
        continue;
      }

      // Check file type
      if (allowedTypes && allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
        setError(`File type "${file.type}" not allowed`);
        continue;
      }

      newFiles.push(file);
    }

    if (newFiles.length > 0) {
      setUploadedFiles((prev) => [...prev, ...newFiles]);
      setError(null);

      // Upload files to get file IDs
      await uploadFiles(newFiles);
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Upload files to server
  const uploadFiles = async (files: File[]) => {
    setIsUploading(true);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`/api/agent-bots/${agentBot.slug}/upload`, {
          method: 'POST',
          headers: {
            'X-Admin-Test': 'true',
          },
          body: formData,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to upload file');
        }

        const data = await response.json();
        setUploadedFileIds((prev) => [...prev, data.fileId]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload files');
    } finally {
      setIsUploading(false);
    }
  };

  // Remove file
  const handleRemoveFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
    setUploadedFileIds((prev) => prev.filter((_, i) => i !== index));
  };

  // Run test
  const handleRunTest = async () => {
    if (!selectedVersion) return;

    setIsTesting(true);
    setTestResult(null);
    setError(null);

    try {
      // Build input object
      const input: Record<string, unknown> = {};
      selectedVersion.input_schema.parameters.forEach((param) => {
        const value = inputValues[param.name];
        if (value !== undefined && value !== '') {
          // Convert to appropriate type
          if (param.type === 'number') {
            input[param.name] = parseFloat(value);
          } else if (param.type === 'boolean') {
            input[param.name] = value === 'true';
          } else {
            input[param.name] = value;
          }
        }
      });

      // Build request body
      const requestBody: Record<string, unknown> = {
        input,
        version: selectedVersion.version_number,
        outputType,
        async: isAsync,
      };

      // Include file IDs if any files were uploaded
      if (uploadedFileIds.length > 0) {
        requestBody.files = uploadedFileIds;
      }

      // Make test request (using internal test endpoint)
      const response = await fetch(`/api/agent-bots/${agentBot.slug}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Use a test header to bypass API key requirement for admin testing
          'X-Admin-Test': 'true',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (!response.ok) {
        setTestResult({
          success: false,
          error: data.error || 'Test failed',
        });
      } else {
        setTestResult({
          success: true,
          jobId: data.jobId,
          outputs: data.outputs,
          tokenUsage: data.tokenUsage,
          processingTimeMs: data.processingTimeMs,
        });
      }
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : 'Test failed',
      });
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Spinner size="lg" />
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
        <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          No Versions Available
        </h3>
        <p className="text-gray-500 dark:text-gray-400">
          Create a version first to test the agent bot
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
          Test Agent Bot
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Try your agent bot with sample inputs
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Input Panel */}
        <div className="space-y-4">
          {/* Version & Output Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Version
              </label>
              <select
                value={selectedVersion?.id || ''}
                onChange={(e) => handleVersionChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version_number}
                    {v.version_label ? ` (${v.version_label})` : ''}
                    {v.is_default ? ' - Default' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Output Type
              </label>
              <select
                value={outputType}
                onChange={(e) => setOutputType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
              >
                {selectedVersion?.output_config.enabledTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Input Parameters */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Input Parameters
            </label>
            {selectedVersion?.input_schema.parameters.map((param) => (
              <div key={param.name}>
                <label className="block text-xs text-gray-500 mb-1">
                  {param.name}
                  {param.required && <span className="text-red-500"> *</span>}
                  {param.description && (
                    <span className="ml-1 text-gray-400">
                      - {param.description}
                    </span>
                  )}
                </label>
                {param.type === 'string' && (
                  <textarea
                    value={inputValues[param.name] || ''}
                    onChange={(e) =>
                      setInputValues({
                        ...inputValues,
                        [param.name]: e.target.value,
                      })
                    }
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm resize-none"
                  />
                )}
                {param.type === 'number' && (
                  <input
                    type="number"
                    value={inputValues[param.name] || ''}
                    onChange={(e) =>
                      setInputValues({
                        ...inputValues,
                        [param.name]: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm"
                  />
                )}
                {param.type === 'boolean' && (
                  <select
                    value={inputValues[param.name] || 'false'}
                    onChange={(e) =>
                      setInputValues({
                        ...inputValues,
                        [param.name]: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm"
                  >
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                )}
              </div>
            ))}
          </div>

          {/* File Upload */}
          {selectedVersion?.input_schema.files?.enabled && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Files
                {selectedVersion.input_schema.files.required && (
                  <span className="text-red-500"> *</span>
                )}
                <span className="ml-2 text-xs text-gray-400 font-normal">
                  Max {selectedVersion.input_schema.files.maxFiles || 5} files,{' '}
                  {selectedVersion.input_schema.files.maxSizePerFileMB || 10}MB each
                </span>
              </label>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                accept={selectedVersion.input_schema.files.allowedTypes?.join(',')}
                className="hidden"
              />

              {/* Upload button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="w-full px-4 py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
              >
                <div className="flex flex-col items-center gap-2 text-gray-500 dark:text-gray-400">
                  {isUploading ? (
                    <>
                      <Spinner size="sm" />
                      <span className="text-sm">Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-6 h-6" />
                      <span className="text-sm">Click to upload files</span>
                      {selectedVersion.input_schema.files.allowedTypes && (
                        <span className="text-xs">
                          {selectedVersion.input_schema.files.allowedTypes
                            .map((t) => t.split('/')[1]?.toUpperCase() || t)
                            .join(', ')}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </button>

              {/* Uploaded files list */}
              {uploadedFiles.length > 0 && (
                <div className="space-y-2">
                  {uploadedFiles.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                          {file.name}
                        </span>
                        <span className="text-xs text-gray-400 flex-shrink-0">
                          ({(file.size / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(index)}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                      >
                        <X className="w-4 h-4 text-gray-500" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Async Mode */}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isAsync}
              onChange={(e) => setIsAsync(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Async mode
            </span>
          </label>

          {/* Run Button */}
          <Button
            onClick={handleRunTest}
            disabled={isTesting}
            className="w-full"
          >
            {isTesting ? (
              <Spinner size="sm" className="mr-2" />
            ) : (
              <PlayCircle className="w-4 h-4 mr-2" />
            )}
            Run Test
          </Button>
        </div>

        {/* Output Panel */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Response
          </label>

          {isTesting ? (
            <div className="flex items-center justify-center h-64">
              <Spinner size="lg" />
            </div>
          ) : testResult ? (
            <div className="space-y-4">
              {/* Status */}
              <div
                className={`flex items-center gap-2 text-sm ${
                  testResult.success
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {testResult.success ? 'Success' : 'Error'}
                {testResult.processingTimeMs && (
                  <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {(testResult.processingTimeMs / 1000).toFixed(2)}s
                  </span>
                )}
                {testResult.tokenUsage && (
                  <span className="text-gray-500 dark:text-gray-400">
                    {testResult.tokenUsage.totalTokens} tokens
                  </span>
                )}
              </div>

              {/* Error */}
              {testResult.error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300">
                  {testResult.error}
                </div>
              )}

              {/* Outputs */}
              {testResult.outputs?.map((output, index) => {
                const isFileType = ['pdf', 'docx', 'xlsx', 'pptx', 'image', 'podcast'].includes(output.type);

                return (
                  <div key={index} className="space-y-2">
                    {isFileType ? (
                      // File output: show filename + download button
                      <div className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-900 rounded">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-700 dark:text-gray-300">
                            {output.filename || `output.${output.type}`}
                          </span>
                          <span className="text-xs text-gray-400 uppercase">
                            {output.type}
                          </span>
                        </div>
                        {output.downloadUrl && (
                          <a
                            href={output.downloadUrl}
                            download={output.filename}
                            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1"
                          >
                            <Download className="w-4 h-4" />
                            Download
                          </a>
                        )}
                      </div>
                    ) : (
                      // Text output: show content
                      <>
                        <span className="text-xs text-gray-500 uppercase">
                          {output.type}
                        </span>
                        <pre className="p-3 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-64 whitespace-pre-wrap">
                          {typeof output.content === 'string'
                            ? output.content
                            : JSON.stringify(output.content, null, 2)}
                        </pre>
                      </>
                    )}
                  </div>
                );
              })}

              {/* Job ID */}
              {testResult.jobId && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Job ID: {testResult.jobId}
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-400">
              Run a test to see results
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

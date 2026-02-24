'use client';

/**
 * Agent Bot Tester
 *
 * Interactive test panel for trying out an agent bot with sample inputs.
 */

import { useState, useEffect, useCallback } from 'react';
import { PlayCircle, AlertCircle, Download, Clock } from 'lucide-react';
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
    }
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

      // Make test request (using internal test endpoint)
      const response = await fetch(`/api/agent-bots/${agentBot.slug}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Use a test header to bypass API key requirement for admin testing
          'X-Admin-Test': 'true',
        },
        body: JSON.stringify({
          input,
          version: selectedVersion.version_number,
          outputType,
          async: isAsync,
        }),
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
              {testResult.outputs?.map((output, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 uppercase">
                      {output.type}
                    </span>
                    {output.downloadUrl && (
                      <a
                        href={output.downloadUrl}
                        download={output.filename}
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" />
                        Download
                      </a>
                    )}
                  </div>
                  {output.content !== undefined && (
                    <pre className="p-3 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto max-h-64 whitespace-pre-wrap">
                      {typeof output.content === 'string'
                        ? output.content
                        : JSON.stringify(output.content, null, 2)}
                    </pre>
                  )}
                </div>
              ))}

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

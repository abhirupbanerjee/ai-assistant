'use client';

/**
 * Agent Bot Documentation Content
 *
 * Client component that renders the documentation for an agent bot.
 */

import { useState } from 'react';
import { Download, Copy, Check, FileJson, FileText, Code } from 'lucide-react';
import type { AgentBot, AgentBotVersionWithRelations } from '@/types/agent-bot';
import { ALL_OUTPUT_TYPES, ALLOWED_FILE_TYPES } from '@/lib/constants/agent-bot-config';

interface AgentBotDocsContentProps {
  agentBot: AgentBot;
  defaultVersion: AgentBotVersionWithRelations | null;
  baseUrl: string;
}

export default function AgentBotDocsContent({
  agentBot,
  defaultVersion,
  baseUrl,
}: AgentBotDocsContentProps) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [selectedLang, setSelectedLang] = useState<'curl' | 'python' | 'javascript'>('curl');

  const apiBaseUrl = `${baseUrl}/api/agent-bots/${agentBot.slug}`;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Generate code examples
  const getCodeExample = () => {
    const inputExample = defaultVersion?.input_schema?.parameters?.reduce(
      (acc, param) => {
        if (param.type === 'string') acc[param.name] = `example ${param.name}`;
        else if (param.type === 'number') acc[param.name] = 0;
        else if (param.type === 'boolean') acc[param.name] = false;
        return acc;
      },
      {} as Record<string, unknown>
    ) || { query: 'Your query here' };

    switch (selectedLang) {
      case 'curl':
        return `curl -X POST "${apiBaseUrl}/invoke" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ input: inputExample, outputType: defaultVersion?.output_config?.defaultType || 'json' }, null, 2)}'`;

      case 'python':
        return `import requests

response = requests.post(
    "${apiBaseUrl}/invoke",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "input": ${JSON.stringify(inputExample, null, 8).replace(/\n/g, '\n        ')},
        "outputType": "${defaultVersion?.output_config?.defaultType || 'json'}"
    }
)

result = response.json()
print(result)`;

      case 'javascript':
        return `const response = await fetch("${apiBaseUrl}/invoke", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    input: ${JSON.stringify(inputExample, null, 4).replace(/\n/g, '\n    ')},
    outputType: "${defaultVersion?.output_config?.defaultType || 'json'}"
  })
});

const result = await response.json();
console.log(result);`;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {agentBot.name} API
          </h1>
          {agentBot.description && (
            <p className="text-lg text-gray-600 dark:text-gray-400">
              {agentBot.description}
            </p>
          )}
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
            <span className="font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
              {apiBaseUrl}
            </span>
            <button
              onClick={() => copyToClipboard(apiBaseUrl, 'url')}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
            >
              {copiedText === 'url' ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Downloads */}
        <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Download Documentation
          </h2>
          <div className="flex flex-wrap gap-3">
            <a
              href={`/docs/agent-bots/${agentBot.slug}/openapi.json`}
              download
              className="flex items-center gap-2 px-4 py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
            >
              <FileJson className="w-4 h-4" />
              OpenAPI Spec
            </a>
            <a
              href={`/docs/agent-bots/${agentBot.slug}/readme.md`}
              download
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <FileText className="w-4 h-4" />
              Markdown
            </a>
            <a
              href={`/docs/agent-bots/${agentBot.slug}/postman.json`}
              download
              className="flex items-center gap-2 px-4 py-2 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded-lg hover:bg-orange-200 dark:hover:bg-orange-900/50 transition-colors"
            >
              <Download className="w-4 h-4" />
              Postman
            </a>
          </div>
        </div>

        {/* Authentication */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Authentication
          </h2>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-gray-600 dark:text-gray-400 mb-3">
              All requests require an API key in the Authorization header:
            </p>
            <div className="bg-gray-100 dark:bg-gray-900 rounded p-3 font-mono text-sm">
              Authorization: Bearer ab_pk_your_api_key_here
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-3">
              Contact your administrator to obtain an API key.
            </p>
          </div>
        </section>

        {/* Endpoints */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Endpoints
          </h2>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-400">
                    Method
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-400">
                    Endpoint
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-400">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                <tr>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-medium">
                      POST
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-900 dark:text-white">
                    /invoke
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    Execute the agent bot
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-xs font-medium">
                      GET
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-900 dark:text-white">
                    /jobs/&#123;jobId&#125;
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    Get job status and results
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-medium">
                      POST
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-900 dark:text-white">
                    /jobs/&#123;jobId&#125;/cancel
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    Cancel a pending job
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-medium">
                      POST
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-900 dark:text-white">
                    /upload
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    Upload files for job input
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Input Schema */}
        {defaultVersion && (
          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Input Schema
              <span className="ml-2 text-sm font-normal text-gray-500">
                (Version {defaultVersion.version_number})
              </span>
            </h2>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Parameters
              </h3>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">
                      Name
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">
                      Type
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">
                      Required
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {defaultVersion.input_schema?.parameters?.map((param, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2 font-mono text-gray-900 dark:text-white">
                        {param.name}
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                        {param.type}
                      </td>
                      <td className="px-3 py-2">
                        {param.required ? (
                          <span className="text-red-600 dark:text-red-400">Yes</span>
                        ) : (
                          <span className="text-gray-500">No</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                        {param.description || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {defaultVersion.input_schema?.files?.enabled && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    File Uploads
                  </h3>
                  <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <li>
                      <span className="text-gray-500">Max files:</span>{' '}
                      {defaultVersion.input_schema.files.maxFiles || 5}
                    </li>
                    <li>
                      <span className="text-gray-500">Max size per file:</span>{' '}
                      {defaultVersion.input_schema.files.maxSizePerFileMB || 10} MB
                    </li>
                    <li>
                      <span className="text-gray-500">Allowed types:</span>{' '}
                      {defaultVersion.input_schema.files.allowedTypes?.length
                        ? defaultVersion.input_schema.files.allowedTypes
                            .map(
                              (t) =>
                                ALLOWED_FILE_TYPES.find((ft) => ft.value === t)?.label || t
                            )
                            .join(', ')
                        : 'All supported types'}
                    </li>
                    <li>
                      <span className="text-gray-500">Required:</span>{' '}
                      {defaultVersion.input_schema.files.required ? 'Yes' : 'No'}
                    </li>
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Output Types */}
        {defaultVersion && (
          <section className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Output Types
            </h2>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Supported output types for this agent:
              </p>
              <div className="flex flex-wrap gap-2">
                {defaultVersion.output_config?.enabledTypes?.map((type) => {
                  const typeInfo = ALL_OUTPUT_TYPES.find((t) => t.id === type);
                  return (
                    <span
                      key={type}
                      className={`px-3 py-1 rounded-full text-sm ${
                        type === defaultVersion.output_config.defaultType
                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {typeInfo?.label || type}
                      {type === defaultVersion.output_config.defaultType && ' (default)'}
                    </span>
                  );
                })}
              </div>

              {defaultVersion.output_config?.fallback?.enabled && (
                <p className="text-sm text-gray-500 dark:text-gray-500 mt-3">
                  Fallback type:{' '}
                  <span className="font-medium">
                    {defaultVersion.output_config.fallback.type}
                  </span>{' '}
                  (used if primary output fails)
                </p>
              )}
            </div>
          </section>
        )}

        {/* Code Examples */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Code Examples
          </h2>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              {(['curl', 'python', 'javascript'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setSelectedLang(lang)}
                  className={`px-4 py-2 text-sm font-medium ${
                    selectedLang === lang
                      ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white border-b-2 border-blue-500'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
                >
                  {lang === 'curl' ? 'cURL' : lang === 'python' ? 'Python' : 'JavaScript'}
                </button>
              ))}
            </div>
            <div className="relative">
              <button
                onClick={() => copyToClipboard(getCodeExample(), 'code')}
                className="absolute top-2 right-2 p-2 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
              >
                {copiedText === 'code' ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
              <pre className="p-4 overflow-x-auto text-sm text-gray-300 bg-gray-900">
                <code>{getCodeExample()}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* Response Format */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Response Format
          </h2>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-4">
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Success (200 OK)
              </h3>
              <pre className="p-3 bg-gray-100 dark:bg-gray-900 rounded text-sm overflow-x-auto">
                <code>{JSON.stringify({
                  success: true,
                  jobId: 'job_abc123',
                  outputs: [
                    {
                      type: 'json',
                      content: { result: '...' }
                    }
                  ],
                  tokenUsage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
                  processingTimeMs: 2340
                }, null, 2)}</code>
              </pre>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Error
              </h3>
              <pre className="p-3 bg-gray-100 dark:bg-gray-900 rounded text-sm overflow-x-auto">
                <code>{JSON.stringify({
                  error: 'Input validation failed',
                  code: 'INPUT_VALIDATION_ERROR',
                  details: 'query: Required field missing'
                }, null, 2)}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* Error Codes */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Error Codes
          </h2>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-400">
                    Code
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-400">
                    HTTP
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-400">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {[
                  ['INVALID_API_KEY', '401', 'API key missing or invalid'],
                  ['API_KEY_EXPIRED', '401', 'API key has expired'],
                  ['RATE_LIMIT_EXCEEDED', '429', 'Too many requests'],
                  ['INPUT_VALIDATION_ERROR', '400', 'Input does not match schema'],
                  ['FILE_VALIDATION_ERROR', '400', 'File type/size not allowed'],
                  ['OUTPUT_TYPE_NOT_SUPPORTED', '400', 'Requested output type not enabled'],
                  ['PROCESSING_ERROR', '500', 'Internal processing error'],
                ].map(([code, http, desc]) => (
                  <tr key={code}>
                    <td className="px-4 py-2 font-mono text-gray-900 dark:text-white text-xs">
                      {code}
                    </td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{http}</td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Rate Limits */}
        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Rate Limits
          </h2>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <p className="text-gray-600 dark:text-gray-400 mb-3">
              Rate limits are configured per API key. Check response headers for current limits:
            </p>
            <pre className="p-3 bg-gray-100 dark:bg-gray-900 rounded text-sm font-mono">
              X-RateLimit-Limit-Minute: 60{'\n'}
              X-RateLimit-Remaining-Minute: 58{'\n'}
              X-RateLimit-Limit-Day: 1000{'\n'}
              X-RateLimit-Remaining-Day: 847
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}

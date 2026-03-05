'use client';

import { useState } from 'react';

/**
 * LoadTestConfig - Admin UI for k6 Cloud load testing tool
 *
 * Two sections:
 * A. Configuration (API token, limits, allowed domains)
 * B. Run Test (trigger test from admin panel)
 */

interface LoadTestConfigProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  disabled: boolean;
  hideSensitive?: boolean;
}

interface TestStatus {
  state: 'idle' | 'running' | 'complete' | 'error';
  message?: string;
  result?: Record<string, unknown>;
}

export default function LoadTestConfig({
  config,
  onChange,
  disabled,
  hideSensitive,
}: LoadTestConfigProps) {
  const [testUrl, setTestUrl] = useState('');
  const [testUsers, setTestUsers] = useState((config.maxConcurrentUsers as number) || 50);
  const [testDuration, setTestDuration] = useState((config.defaultDuration as number) || 300);
  const [testStatus, setTestStatus] = useState<TestStatus>({ state: 'idle' });

  const handleChange = (key: string, value: unknown) => {
    onChange({ ...config, [key]: value });
  };

  const handleArrayChange = (key: string, value: string) => {
    const arr = value.split(',').map(s => s.trim()).filter(Boolean);
    onChange({ ...config, [key]: arr });
  };

  const runTest = async () => {
    if (!testUrl) return;

    setTestStatus({ state: 'running', message: 'Starting load test...' });

    try {
      // POST starts the test async and returns a testId immediately
      const response = await fetch('/api/admin/tools/loadtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: testUrl,
          users: testUsers,
          duration: testDuration,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setTestStatus({
          state: 'error',
          message: data.error || 'Failed to start test',
        });
        return;
      }

      // Poll for results every 10 seconds
      const testId = data.testId as string;
      setTestStatus({ state: 'running', message: 'Load test running on k6 Cloud... This may take several minutes.' });

      const poll = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/admin/tools/loadtest/run?testId=${testId}`);

          // Handle server restart (test tracker lost) or other HTTP errors
          if (!statusRes.ok) {
            clearInterval(poll);
            setTestStatus({
              state: 'error',
              message: statusRes.status === 404
                ? 'Test tracker lost (server may have restarted). Check k6 Cloud dashboard for results.'
                : `Polling failed (HTTP ${statusRes.status})`,
            });
            return;
          }

          const statusData = await statusRes.json();

          if (statusData.status === 'complete') {
            clearInterval(poll);
            setTestStatus({
              state: 'complete',
              message: 'Test completed successfully',
              result: statusData.result,
            });
          } else if (statusData.status === 'error') {
            clearInterval(poll);
            setTestStatus({
              state: 'error',
              message: statusData.error || statusData.message || 'Test failed',
            });
          }
        } catch {
          // Network blip during poll — keep trying
        }
      }, 10000);

      // Safety: stop polling after 25 minutes (test can take up to 20 min on k6 Cloud)
      setTimeout(() => {
        clearInterval(poll);
        setTestStatus(prev =>
          prev.state === 'running'
            ? { state: 'error', message: 'Polling timed out. Check test results manually.' }
            : prev
        );
      }, 1500000);
    } catch (err) {
      setTestStatus({
        state: 'error',
        message: err instanceof Error ? err.message : 'Failed to start test',
      });
    }
  };

  const allowedDomains = ((config.allowedDomains as string[]) || []);

  return (
    <div className="space-y-6">
      {/* Section A: Configuration */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Configuration</h4>

        {/* API Token */}
        {!hideSensitive && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              k6 Cloud API Token
            </label>
            <input
              type="password"
              value={(config.apiToken as string) || ''}
              onChange={(e) => handleChange('apiToken', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter k6 Cloud API token"
              disabled={disabled}
            />
            <p className="text-xs text-gray-500 mt-1">
              Get from Grafana Cloud &rarr; k6 &rarr; Settings &rarr; API tokens
            </p>
          </div>
        )}

        {/* Stack ID */}
        {!hideSensitive && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Grafana Cloud Stack ID
            </label>
            <input
              type="text"
              value={(config.stackId as string) || ''}
              onChange={(e) => handleChange('stackId', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., 123456"
              disabled={disabled}
            />
            <p className="text-xs text-gray-500 mt-1">
              Required for Grafana Cloud k6. Find in your Grafana Cloud portal URL or stack settings.
            </p>
          </div>
        )}

        {/* Allowed Domains */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Allowed Domains
          </label>
          <input
            type="text"
            value={allowedDomains.join(', ')}
            onChange={(e) => handleArrayChange('allowedDomains', e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="example.com, ministry.gd"
            disabled={disabled}
          />
          <p className="text-xs text-gray-500 mt-1">
            Comma-separated list of domains that can be tested. Only these domains will be allowed.
          </p>
        </div>

        {/* User & Duration Limits */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max Concurrent Users
            </label>
            <input
              type="number"
              min={10}
              max={100}
              value={(config.maxConcurrentUsers as number) || 50}
              onChange={(e) => handleChange('maxConcurrentUsers', parseInt(e.target.value) || 50)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={disabled}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Duration (sec)
            </label>
            <input
              type="number"
              min={90}
              max={600}
              value={(config.defaultDuration as number) || 300}
              onChange={(e) => handleChange('defaultDuration', parseInt(e.target.value) || 300)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={disabled}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max Duration (sec)
            </label>
            <input
              type="number"
              min={90}
              max={600}
              value={(config.maxDuration as number) || 600}
              onChange={(e) => handleChange('maxDuration', parseInt(e.target.value) || 600)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={disabled}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Daily Test Limit
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={(config.rateLimitPerDay as number) || 10}
              onChange={(e) => handleChange('rateLimitPerDay', parseInt(e.target.value) || 10)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={disabled}
            />
          </div>
        </div>

        {/* Cache TTL */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Redis Cache Duration (seconds)
          </label>
          <input
            type="number"
            min={3600}
            max={2592000}
            value={(config.cacheTTLSeconds as number) || 2592000}
            onChange={(e) => handleChange('cacheTTLSeconds', parseInt(e.target.value) || 2592000)}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={disabled}
          />
          <p className="text-xs text-gray-500 mt-1">
            Redis cache TTL (2592000 = 30 days). Results are also stored permanently in the database.
          </p>
        </div>
      </div>

      {/* Section B: Run Test */}
      <div className="border-t pt-6 space-y-4">
        <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Run Load Test</h4>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Target URL
          </label>
          <input
            type="url"
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="https://example.com"
            disabled={testStatus.state === 'running'}
          />
          {allowedDomains.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              Allowed domains: {allowedDomains.join(', ')}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Virtual Users
            </label>
            <input
              type="number"
              min={10}
              max={(config.maxConcurrentUsers as number) || 100}
              value={testUsers}
              onChange={(e) => setTestUsers(parseInt(e.target.value) || 50)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={testStatus.state === 'running'}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Duration (sec)
            </label>
            <input
              type="number"
              min={90}
              max={(config.maxDuration as number) || 600}
              value={testDuration}
              onChange={(e) => setTestDuration(parseInt(e.target.value) || 300)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={testStatus.state === 'running'}
            />
          </div>
        </div>

        <button
          onClick={runTest}
          disabled={!testUrl || testStatus.state === 'running'}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testStatus.state === 'running' ? 'Running...' : 'Run Load Test'}
        </button>

        {/* Status Display */}
        {testStatus.state === 'running' && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-800">{testStatus.message}</p>
          </div>
        )}

        {testStatus.state === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm text-red-800">{testStatus.message}</p>
          </div>
        )}

        {testStatus.state === 'complete' && testStatus.result && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium text-green-800">
              {(testStatus.result as Record<string, unknown>).passed ? 'PASSED' : 'FAILED'} - Test completed
            </p>
            {(() => {
              const r = testStatus.result as Record<string, unknown>;
              const metrics = r.metrics as Record<string, Record<string, number>> | undefined;
              const duration = metrics?.http_req_duration;
              return duration ? (
                <div className="text-sm text-green-700 space-y-1">
                  <p>p50: {duration.p50?.toFixed(0)}ms | p95: {duration.p95?.toFixed(0)}ms | p99: {duration.p99?.toFixed(0)}ms</p>
                  {typeof r.outputUrl === 'string' && r.outputUrl && (
                    <p>
                      <a
                        href={r.outputUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        View on k6 Cloud
                      </a>
                    </p>
                  )}
                </div>
              ) : null;
            })()}
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-sm text-blue-800">
          <strong>How it works:</strong> Tests are executed via k6 Cloud using distributed load generators.
          Results are stored permanently in the database. Users can ask the chatbot
          &quot;get load test for [url]&quot; to retrieve the most recent results.
        </p>
      </div>
    </div>
  );
}

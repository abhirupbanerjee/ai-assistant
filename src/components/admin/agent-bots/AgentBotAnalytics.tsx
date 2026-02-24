'use client';

/**
 * Agent Bot Analytics
 *
 * Usage statistics and analytics for an agent bot.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Activity,
  Clock,
  Zap,
  AlertCircle,
  CheckCircle,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface AnalyticsData {
  summary: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalTokens: number;
    avgProcessingTimeMs: number;
    requestsChange: number;
    tokensChange: number;
  };
  dailyStats: Array<{
    date: string;
    requests: number;
    tokens: number;
    errors: number;
  }>;
  recentJobs: Array<{
    id: string;
    version_number: number;
    status: string;
    output_type: string;
    processing_time_ms: number | null;
    created_at: string;
  }>;
  byApiKey: Array<{
    key_name: string;
    key_prefix: string;
    requests: number;
    percentage: number;
  }>;
  byOutputType: Array<{
    type: string;
    count: number;
    percentage: number;
  }>;
}

interface AgentBotAnalyticsProps {
  agentBotId: string;
}

export default function AgentBotAnalytics({ agentBotId }: AgentBotAnalyticsProps) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');

  // Load analytics
  const loadAnalytics = useCallback(async () => {
    try {
      setIsLoading(true);
      const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
      const response = await fetch(
        `/api/admin/agent-bots/${agentBotId}/analytics?days=${days}`
      );
      if (!response.ok) throw new Error('Failed to load analytics');
      const data = await response.json();
      setAnalytics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setIsLoading(false);
    }
  }, [agentBotId, timeRange]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // Format number with commas
  const formatNumber = (num: number): string => {
    return num.toLocaleString();
  };

  // Format change percentage
  const formatChange = (change: number): string => {
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(1)}%`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        <button
          onClick={loadAnalytics}
          className="text-sm text-red-600 dark:text-red-400 underline mt-1"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
        <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          No Analytics Data
        </h3>
        <p className="text-gray-500 dark:text-gray-400">
          Analytics will appear once the agent bot is used
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Analytics
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Usage statistics and trends
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as '7d' | '30d' | '90d')}
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <button
            onClick={loadAnalytics}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-1">
            <Activity className="w-4 h-4" />
            <span className="text-sm">Requests</span>
          </div>
          <div className="text-2xl font-semibold text-gray-900 dark:text-white">
            {formatNumber(analytics.summary.totalRequests)}
          </div>
          <div
            className={`text-xs ${
              analytics.summary.requestsChange >= 0
                ? 'text-green-600'
                : 'text-red-600'
            }`}
          >
            {formatChange(analytics.summary.requestsChange)} vs previous period
          </div>
        </div>

        <div className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-1">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm">Success Rate</span>
          </div>
          <div className="text-2xl font-semibold text-gray-900 dark:text-white">
            {analytics.summary.totalRequests > 0
              ? (
                  (analytics.summary.successfulRequests /
                    analytics.summary.totalRequests) *
                  100
                ).toFixed(1)
              : 0}
            %
          </div>
          <div className="text-xs text-gray-500">
            {formatNumber(analytics.summary.failedRequests)} failed
          </div>
        </div>

        <div className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-1">
            <Clock className="w-4 h-4" />
            <span className="text-sm">Avg Time</span>
          </div>
          <div className="text-2xl font-semibold text-gray-900 dark:text-white">
            {(analytics.summary.avgProcessingTimeMs / 1000).toFixed(1)}s
          </div>
          <div className="text-xs text-gray-500">Processing time</div>
        </div>

        <div className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-1">
            <Zap className="w-4 h-4" />
            <span className="text-sm">Tokens</span>
          </div>
          <div className="text-2xl font-semibold text-gray-900 dark:text-white">
            {formatNumber(analytics.summary.totalTokens)}
          </div>
          <div
            className={`text-xs ${
              analytics.summary.tokensChange >= 0
                ? 'text-green-600'
                : 'text-red-600'
            }`}
          >
            {formatChange(analytics.summary.tokensChange)} vs previous period
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-6">
        {/* Daily Requests Chart */}
        <div className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-4">
            Requests Over Time
          </h4>
          <div className="h-40">
            {analytics.dailyStats.length > 0 ? (
              <div className="flex items-end justify-between h-full gap-1">
                {analytics.dailyStats.map((day, index) => {
                  const maxRequests = Math.max(
                    ...analytics.dailyStats.map((d) => d.requests)
                  );
                  const height =
                    maxRequests > 0
                      ? (day.requests / maxRequests) * 100
                      : 0;
                  return (
                    <div
                      key={index}
                      className="flex-1 flex flex-col items-center gap-1"
                    >
                      <div
                        className="w-full bg-blue-500 rounded-t"
                        style={{ height: `${Math.max(height, 2)}%` }}
                        title={`${day.date}: ${day.requests} requests`}
                      />
                      {index % 7 === 0 && (
                        <span className="text-xs text-gray-400 transform -rotate-45 origin-top-left whitespace-nowrap">
                          {new Date(day.date).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                No data for this period
              </div>
            )}
          </div>
        </div>

        {/* By Output Type */}
        <div className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-4">
            By Output Type
          </h4>
          {analytics.byOutputType.length > 0 ? (
            <div className="space-y-3">
              {analytics.byOutputType.map((item) => (
                <div key={item.type}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700 dark:text-gray-300">
                      {item.type}
                    </span>
                    <span className="text-gray-500">
                      {item.count} ({item.percentage.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              No data
            </div>
          )}
        </div>
      </div>

      {/* By API Key */}
      {analytics.byApiKey.length > 0 && (
        <div className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-4">
            By API Key
          </h4>
          <div className="space-y-2">
            {analytics.byApiKey.map((item) => (
              <div
                key={item.key_prefix}
                className="flex items-center justify-between py-2"
              >
                <div>
                  <span className="text-gray-900 dark:text-white">
                    {item.key_name}
                  </span>
                  <span className="text-gray-400 ml-2 font-mono text-xs">
                    {item.key_prefix}...
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-500">
                    {formatNumber(item.requests)} requests
                  </span>
                  <div className="w-24 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full"
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                  <span className="text-sm text-gray-400 w-12 text-right">
                    {item.percentage.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Jobs */}
      <div className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
        <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-4">
          Recent Jobs
        </h4>
        {analytics.recentJobs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="pb-2 font-medium">Job ID</th>
                  <th className="pb-2 font-medium">Version</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Output</th>
                  <th className="pb-2 font-medium">Time</th>
                  <th className="pb-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {analytics.recentJobs.map((job) => (
                  <tr
                    key={job.id}
                    className="border-b border-gray-50 dark:border-gray-800"
                  >
                    <td className="py-2 font-mono text-xs text-gray-600 dark:text-gray-400">
                      {job.id.substring(0, 8)}...
                    </td>
                    <td className="py-2">v{job.version_number}</td>
                    <td className="py-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                          job.status === 'completed'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : job.status === 'failed'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {job.status === 'completed' && (
                          <CheckCircle className="w-3 h-3" />
                        )}
                        {job.status === 'failed' && (
                          <XCircle className="w-3 h-3" />
                        )}
                        {job.status}
                      </span>
                    </td>
                    <td className="py-2">{job.output_type}</td>
                    <td className="py-2">
                      {job.processing_time_ms
                        ? `${(job.processing_time_ms / 1000).toFixed(1)}s`
                        : '-'}
                    </td>
                    <td className="py-2 text-gray-500">
                      {new Date(job.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400 text-sm">
            No jobs yet
          </div>
        )}
      </div>
    </div>
  );
}

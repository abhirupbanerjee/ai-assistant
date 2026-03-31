'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { BarChart3, RefreshCw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

// ============ Types ============

interface TokenUsageSummary {
  total_tokens: number;
  total_calls: number;
  byCategory: { category: string; total_tokens: number; call_count: number }[];
  byUser: {
    user_id: number;
    user_email: string;
    user_name: string | null;
    total_tokens: number;
    call_count: number;
  }[];
  byModel: { model: string; total_tokens: number; call_count: number }[];
  daily: {
    date: string;
    total_tokens: number;
    call_count: number;
    chat_tokens: number;
    autonomous_tokens: number;
    embeddings_tokens: number;
    workspace_tokens: number;
  }[];
}

interface FilterOptions {
  categories: string[];
  models: string[];
  users: { id: number; email: string; name: string | null }[];
}

interface ActiveFilters {
  days: number;
  category: string | null;
  userId: number | null;
  model: string | null;
}

// ============ Helpers ============

const CATEGORY_COLORS: Record<string, string> = {
  chat: '#3B82F6',
  autonomous: '#8B5CF6',
  embeddings: '#10B981',
  workspace: '#F59E0B',
};

const CATEGORY_LABELS: Record<string, string> = {
  chat: 'Chat',
  autonomous: 'Autonomous',
  embeddings: 'Embeddings',
  workspace: 'Workspace',
};

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============ Component ============

export default function TokenUsageDashboard() {
  const [data, setData] = useState<TokenUsageSummary | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [filters, setFilters] = useState<ActiveFilters>({
    days: 7,
    category: null,
    userId: null,
    model: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (noCache = false) => {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        params.set('days', String(filters.days));
        if (filters.category) params.set('category', filters.category);
        if (filters.userId) params.set('userId', String(filters.userId));
        if (filters.model) params.set('model', filters.model);
        if (noCache) params.set('nocache', '1');

        const res = await fetch(`/api/admin/usage?${params}`);
        if (!res.ok) throw new Error('Failed to fetch usage data');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  // Fetch filter options on mount
  useEffect(() => {
    fetch('/api/admin/usage/filters')
      .then((r) => r.json())
      .then(setFilterOptions)
      .catch(() => {});
  }, []);

  // Fetch data when filters change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 size={24} className="text-blue-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Token Usage</h1>
            <p className="text-sm text-gray-500">
              Monitor LLM token consumption across categories, users, and models
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => fetchData(true)}
          loading={loading}
        >
          <RefreshCw size={14} className="mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-lg border shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Category
            </label>
            <select
              className="border rounded-md px-3 py-1.5 text-sm bg-white"
              value={filters.category || ''}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  category: e.target.value || null,
                }))
              }
            >
              <option value="">All Categories</option>
              {(filterOptions?.categories || []).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c] || c}
                </option>
              ))}
            </select>
          </div>

          {/* User */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              User
            </label>
            <select
              className="border rounded-md px-3 py-1.5 text-sm bg-white"
              value={filters.userId || ''}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  userId: e.target.value ? parseInt(e.target.value, 10) : null,
                }))
              }
            >
              <option value="">All Users</option>
              {(filterOptions?.users || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                </option>
              ))}
            </select>
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Model
            </label>
            <select
              className="border rounded-md px-3 py-1.5 text-sm bg-white"
              value={filters.model || ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, model: e.target.value || null }))
              }
            >
              <option value="">All Models</option>
              {(filterOptions?.models || []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* Days Toggle */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Period
            </label>
            <div className="flex rounded-md border overflow-hidden">
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setFilters((f) => ({ ...f, days: d }))}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    filters.days === d
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && !data && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg border border-red-200">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              label="Total Tokens"
              value={formatTokenCount(data.total_tokens)}
              detail={`${data.total_tokens.toLocaleString()} tokens`}
            />
            <SummaryCard
              label="LLM Calls"
              value={data.total_calls.toLocaleString()}
            />
            <SummaryCard
              label="Avg Tokens/Call"
              value={
                data.total_calls > 0
                  ? formatTokenCount(
                      Math.round(data.total_tokens / data.total_calls)
                    )
                  : '0'
              }
            />
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-xs font-medium text-gray-500 mb-2">
                By Category
              </p>
              <div className="space-y-1">
                {data.byCategory.map((c) => (
                  <div
                    key={c.category}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{
                          backgroundColor:
                            CATEGORY_COLORS[c.category] || '#9CA3AF',
                        }}
                      />
                      {CATEGORY_LABELS[c.category] || c.category}
                    </span>
                    <span className="font-medium text-gray-900">
                      {formatTokenCount(c.total_tokens)}
                    </span>
                  </div>
                ))}
                {data.byCategory.length === 0 && (
                  <p className="text-xs text-gray-400">No data yet</p>
                )}
              </div>
            </div>
          </div>

          {/* Bar Chart */}
          <div className="bg-white rounded-lg border shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">
              Daily Token Usage
            </h2>
            {data.daily.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={data.daily}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={formatDate} />
                  <YAxis tickFormatter={formatTokenCount} />
                  <Tooltip
                    formatter={(value) => [
                      Number(value ?? 0).toLocaleString(),
                      'Tokens',
                    ]}
                    labelFormatter={formatDate}
                  />
                  <Legend />
                  {!filters.category ? (
                    <>
                      <Bar
                        dataKey="chat_tokens"
                        stackId="a"
                        fill={CATEGORY_COLORS.chat}
                        name="Chat"
                      />
                      <Bar
                        dataKey="autonomous_tokens"
                        stackId="a"
                        fill={CATEGORY_COLORS.autonomous}
                        name="Autonomous"
                      />
                      <Bar
                        dataKey="embeddings_tokens"
                        stackId="a"
                        fill={CATEGORY_COLORS.embeddings}
                        name="Embeddings"
                      />
                      <Bar
                        dataKey="workspace_tokens"
                        stackId="a"
                        fill={CATEGORY_COLORS.workspace}
                        name="Workspace"
                      />
                    </>
                  ) : (
                    <Bar
                      dataKey="total_tokens"
                      fill={
                        CATEGORY_COLORS[filters.category] || '#3B82F6'
                      }
                      name="Tokens"
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center py-16 text-gray-400">
                No token usage data recorded yet. Data will appear as LLM
                calls are made.
              </div>
            )}
          </div>

          {/* Breakdown Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By User */}
            <div className="bg-white rounded-lg border shadow-sm">
              <div className="px-6 py-4 border-b">
                <h2 className="font-semibold text-gray-900">By User</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-6 py-2 font-medium text-gray-500">
                        User
                      </th>
                      <th className="text-right px-6 py-2 font-medium text-gray-500">
                        Tokens
                      </th>
                      <th className="text-right px-6 py-2 font-medium text-gray-500">
                        Calls
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byUser.map((u) => (
                      <tr key={u.user_id} className="border-b last:border-0">
                        <td className="px-6 py-2 text-gray-900">
                          {u.user_name || u.user_email}
                        </td>
                        <td className="px-6 py-2 text-right font-medium text-gray-900">
                          {formatTokenCount(u.total_tokens)}
                        </td>
                        <td className="px-6 py-2 text-right text-gray-500">
                          {u.call_count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                    {data.byUser.length === 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-6 py-4 text-center text-gray-400"
                        >
                          No user data
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* By Model */}
            <div className="bg-white rounded-lg border shadow-sm">
              <div className="px-6 py-4 border-b">
                <h2 className="font-semibold text-gray-900">By Model</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-6 py-2 font-medium text-gray-500">
                        Model
                      </th>
                      <th className="text-right px-6 py-2 font-medium text-gray-500">
                        Tokens
                      </th>
                      <th className="text-right px-6 py-2 font-medium text-gray-500">
                        Calls
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byModel.map((m) => (
                      <tr key={m.model} className="border-b last:border-0">
                        <td className="px-6 py-2 text-gray-900 font-mono text-xs">
                          {m.model}
                        </td>
                        <td className="px-6 py-2 text-right font-medium text-gray-900">
                          {formatTokenCount(m.total_tokens)}
                        </td>
                        <td className="px-6 py-2 text-right text-gray-500">
                          {m.call_count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                    {data.byModel.length === 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-6 py-4 text-center text-gray-400"
                        >
                          No model data
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============ Summary Card ============

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="bg-white rounded-lg border shadow-sm p-4">
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {detail && <p className="text-xs text-gray-400 mt-0.5">{detail}</p>}
    </div>
  );
}

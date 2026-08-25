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
import { BarChart3, RefreshCw, DollarSign, AlertTriangle, Wallet, TrendingUp, KeyRound } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

// ============ Types ============

interface TokenUsageSummary {
  total_tokens: number;
  total_calls: number;
  total_cost: number;
  byCategory: { category: string; total_tokens: number; call_count: number; total_cost: number }[];
  byUser: {
    user_id: number;
    user_email: string;
    user_name: string | null;
    total_tokens: number;
    call_count: number;
    total_cost: number;
  }[];
  byModel: { model: string; total_tokens: number; call_count: number; total_cost: number }[];
  daily: {
    date: string;
    total_tokens: number;
    call_count: number;
    chat_tokens: number;
    autonomous_tokens: number;
    embeddings_tokens: number;
    workspace_tokens: number;
    chat_cost: number;
    autonomous_cost: number;
    embeddings_cost: number;
    workspace_cost: number;
  }[];
  modelsWithoutCost: string[];
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

interface ProviderBalance {
  providerId: string;
  providerName: string;
  /** 'balance' = remaining wallet credit; 'spend' = consumption this period */
  dataType: 'balance' | 'spend';
  balance: number | null;
  currency: string;
  limit: number | null;
  usageThisMonth: number | null;
  error?: string;
  adminKeyRequired?: boolean;
}

type Metric = 'token' | 'cost';
type DashboardTab = 'usage' | 'pricing';

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

function formatCost(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Safely convert a value that may be string/number/null/undefined to a number */
function toNum(val: number | string | null | undefined): number {
  if (val == null) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

// ============ Component ============

interface TokenUsageDashboardProps {
  userRole?: 'super_admin' | 'admin' | 'superuser' | 'user' | 'org_admin';
}

export default function TokenUsageDashboard({ userRole = 'admin' }: TokenUsageDashboardProps) {
  const [data, setData] = useState<TokenUsageSummary | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [filters, setFilters] = useState<ActiveFilters>({
    days: 7,
    category: null,
    userId: null,
    model: null,
  });
  const [metric, setMetric] = useState<Metric>('token');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pricing tab state
  const [activeTab, setActiveTab] = useState<DashboardTab>('usage');
  const [balances, setBalances] = useState<ProviderBalance[]>([]);
  const [unavailableProviders, setUnavailableProviders] = useState<string[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState<string | null>(null);

  const isSuperAdmin = userRole === 'super_admin';

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

  const fetchBalances = useCallback(async (nocache = false) => {
    try {
      setBalancesLoading(true);
      setBalancesError(null);
      const url = nocache ? '/api/admin/provider-balances?nocache=1' : '/api/admin/provider-balances';
      const res = await fetch(url);
      if (res.status === 403) {
        setBalancesError('Super admin access required');
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch provider balances');
      const json = await res.json();
      setBalances(json.balances || []);
      setUnavailableProviders(json.unavailable || []);
    } catch (err) {
      setBalancesError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBalancesLoading(false);
    }
  }, []);

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

  // Force metric to 'token' for non-super_admin (defense in depth)
  useEffect(() => {
    if (!isSuperAdmin && metric === 'cost') {
      setMetric('token');
    }
  }, [isSuperAdmin, metric]);

  // Fetch balances when pricing tab is selected
  useEffect(() => {
    if (activeTab === 'pricing' && isSuperAdmin) {
      fetchBalances();
    }
  }, [activeTab, isSuperAdmin, fetchBalances]);

  const isToken = metric === 'token';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 size={24} className="text-blue-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Usage</h1>
            <p className="text-sm text-gray-500">
              Monitor LLM consumption across categories, users, and models
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => activeTab === 'pricing' ? fetchBalances(true) : fetchData(true)}
          loading={loading || balancesLoading}
        >
          <RefreshCw size={14} className="mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Tab Bar - Only show Pricing tab for super_admin */}
      {isSuperAdmin && (
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('usage')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'usage'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <BarChart3 size={14} className="inline mr-1.5" />
            Usage
          </button>
          <button
            onClick={() => setActiveTab('pricing')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'pricing'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <DollarSign size={14} className="inline mr-1.5" />
            Pricing
          </button>
        </div>
      )}

      {/* ============ PRICING TAB ============ */}
      {isSuperAdmin && activeTab === 'pricing' && (
        <div className="space-y-6">
          {/* Sensitive data warning */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <div>
              <strong>Confidential:</strong> Provider balance and pricing data is restricted to super admins.
              Do not share this information outside authorized personnel.
            </div>
          </div>

          {balancesLoading && (
            <div className="flex items-center justify-center py-12">
              <Spinner size="lg" />
            </div>
          )}

          {balancesError && (
            <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg border border-red-200">
              {balancesError}
            </div>
          )}

          {!balancesLoading && !balancesError && (
            <>
              {/* Wallet Balance Providers */}
              {balances.filter((b) => b.dataType === 'balance').length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Wallet size={16} className="text-blue-600" />
                    Wallet Balance
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {balances
                      .filter((b) => b.dataType === 'balance')
                      .map((b) => (
                        <div key={b.providerId} className="bg-white rounded-lg border shadow-sm p-5">
                          <div className="flex items-center gap-2 mb-3">
                            <Wallet size={18} className="text-blue-600" />
                            <h3 className="font-semibold text-gray-900 text-sm">{b.providerName}</h3>
                          </div>
                          {b.error ? (
                            <div className="space-y-2">
                              <div className="bg-red-50 text-red-600 text-xs px-2 py-1.5 rounded border border-red-200">
                                {b.error}
                              </div>
                              {b.adminKeyRequired && (
                                <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                                  <KeyRound size={12} className="mt-0.5 flex-shrink-0" />
                                  <span>Requires admin API key. Set the appropriate env var and restart.</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Available Balance</span>
                                <span className="font-medium text-gray-900">
                                  {b.currency === 'USD' ? '$' : ''}{toNum(b.balance).toFixed(2)}
                                  {b.currency !== 'USD' ? ` ${b.currency}` : ''}
                                </span>
                              </div>
                              {b.limit !== null && (
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-500">Granted Credits</span>
                                  <span className="font-medium text-gray-900">
                                    {b.currency === 'USD' ? '$' : ''}{toNum(b.limit).toFixed(2)}
                                    {b.currency !== 'USD' ? ` ${b.currency}` : ''}
                                  </span>
                                </div>
                              )}
                              {b.usageThisMonth !== null && (
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-500">Used This Month</span>
                                  <span className="font-medium text-gray-900">
                                    {b.currency === 'USD' ? '$' : ''}{toNum(b.usageThisMonth).toFixed(2)}
                                    {b.currency !== 'USD' ? ` ${b.currency}` : ''}
                                  </span>
                                </div>
                              )}
                              {b.limit !== null && b.usageThisMonth !== null && b.limit > 0 && (
                                <div className="mt-2">
                                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                                    <span>Usage</span>
                                    <span>{((toNum(b.usageThisMonth) / toNum(b.limit)) * 100).toFixed(1)}%</span>
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div
                                      className="bg-blue-600 rounded-full h-2 transition-all"
                                      style={{
                                        width: `${Math.min(100, (toNum(b.usageThisMonth) / toNum(b.limit)) * 100)}%`,
                                        backgroundColor:
                                          toNum(b.usageThisMonth) / toNum(b.limit) > 0.9
                                            ? '#EF4444'
                                            : toNum(b.usageThisMonth) / toNum(b.limit) > 0.7
                                              ? '#F59E0B'
                                              : '#3B82F6',
                                      }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Spend Tracking Providers */}
              {balances.filter((b) => b.dataType === 'spend').length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <TrendingUp size={16} className="text-purple-600" />
                    Spend This Period
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {balances
                      .filter((b) => b.dataType === 'spend')
                      .map((b) => (
                        <div key={b.providerId} className="bg-white rounded-lg border shadow-sm p-5">
                          <div className="flex items-center gap-2 mb-3">
                            <TrendingUp size={18} className="text-purple-600" />
                            <h3 className="font-semibold text-gray-900 text-sm">{b.providerName}</h3>
                          </div>
                          {b.error ? (
                            <div className="space-y-2">
                              <div className="bg-red-50 text-red-600 text-xs px-2 py-1.5 rounded border border-red-200">
                                {b.error}
                              </div>
                              {b.adminKeyRequired && (
                                <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                                  <KeyRound size={12} className="mt-0.5 flex-shrink-0" />
                                  <span>Requires admin API key. Set the appropriate env var and restart.</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Spend This Month</span>
                                <span className="font-medium text-gray-900">
                                  {b.currency === 'USD' ? '$' : ''}{toNum(b.usageThisMonth ?? b.balance).toFixed(2)}
                                  {b.currency !== 'USD' ? ` ${b.currency}` : ''}
                                </span>
                              </div>
                              {b.limit !== null && (
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-500">Monthly Limit</span>
                                  <span className="font-medium text-gray-900">
                                    {b.currency === 'USD' ? '$' : ''}{toNum(b.limit).toFixed(2)}
                                    {b.currency !== 'USD' ? ` ${b.currency}` : ''}
                                  </span>
                                </div>
                              )}
                              {b.limit !== null && (b.usageThisMonth ?? 0) > 0 && b.limit > 0 && (
                                <div className="mt-2">
                                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                                    <span>Usage</span>
                                    <span>{((toNum(b.usageThisMonth) / toNum(b.limit)) * 100).toFixed(1)}%</span>
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div
                                      className="bg-purple-600 rounded-full h-2 transition-all"
                                      style={{
                                        width: `${Math.min(100, ((b.usageThisMonth ?? 0) / b.limit) * 100)}%`,
                                        backgroundColor:
                                          (b.usageThisMonth ?? 0) / b.limit > 0.9
                                            ? '#EF4444'
                                            : (b.usageThisMonth ?? 0) / b.limit > 0.7
                                              ? '#F59E0B'
                                              : '#7C3AED',
                                      }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Unavailable Providers */}
              {unavailableProviders.length > 0 && (
                <div className="bg-white rounded-lg border shadow-sm p-5">
                  <h3 className="font-semibold text-gray-900 text-sm mb-3">
                    Providers Without Balance/Cost API
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {unavailableProviders.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600"
                      >
                        {id}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    These providers do not offer a balance or cost query API (Mistral, Gemini, Ollama) or their API keys are not configured.
                  </p>
                </div>
              )}

              {balances.length === 0 && unavailableProviders.length === 0 && (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  No provider balance data available. Configure platform keys in Settings → Platform Credentials.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ============ USAGE TAB ============ */}
      {activeTab === 'usage' && (
        <>
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

              {/* Metric Toggle — Cost option only for super_admin */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Show
                </label>
                <div className="flex rounded-md border overflow-hidden">
                  <button
                    onClick={() => setMetric('token')}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      metric === 'token'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Tokens
                  </button>
                  {isSuperAdmin && (
                    <button
                      onClick={() => setMetric('cost')}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                        metric === 'cost'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Cost
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Missing Cost Disclaimer */}
          {data && metric === 'cost' && data.modelsWithoutCost.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
              <strong>Cost data incomplete:</strong> Pricing not available for{' '}
              {data.modelsWithoutCost.join(', ')}. Costs shown as $0.00 for these
              models. Update pricing in LLM Settings.
            </div>
          )}

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
                  label={isToken ? 'Total Tokens' : 'Total Cost'}
                  value={isToken ? formatTokenCount(data.total_tokens) : formatCost(data.total_cost)}
                  detail={isToken ? `${data.total_tokens.toLocaleString()} tokens` : undefined}
                />
                <SummaryCard
                  label="LLM Calls"
                  value={data.total_calls.toLocaleString()}
                />
                <SummaryCard
                  label={isToken ? 'Avg Tokens/Call' : 'Avg Cost/Call'}
                  value={
                    data.total_calls > 0
                      ? isToken
                        ? formatTokenCount(Math.round(data.total_tokens / data.total_calls))
                        : formatCost(data.total_cost / data.total_calls)
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
                          {isToken ? formatTokenCount(c.total_tokens) : formatCost(c.total_cost)}
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
                  Daily {isToken ? 'Token' : 'Cost'} Usage
                </h2>
                {data.daily.length > 0 ? (
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={data.daily}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tickFormatter={formatDate} />
                      <YAxis tickFormatter={isToken ? formatTokenCount : formatCost} />
                      <Tooltip
                        formatter={(value, _name) => [
                          isToken
                            ? Number(value ?? 0).toLocaleString()
                            : formatCost(Number(value ?? 0)),
                          isToken ? 'Tokens' : 'Cost',
                        ]}
                        labelFormatter={formatDate}
                      />
                      <Legend />
                      {!filters.category ? (
                        <>
                          <Bar
                            dataKey={isToken ? 'chat_tokens' : 'chat_cost'}
                            stackId="a"
                            fill={CATEGORY_COLORS.chat}
                            name="Chat"
                          />
                          <Bar
                            dataKey={isToken ? 'autonomous_tokens' : 'autonomous_cost'}
                            stackId="a"
                            fill={CATEGORY_COLORS.autonomous}
                            name="Autonomous"
                          />
                          <Bar
                            dataKey={isToken ? 'embeddings_tokens' : 'embeddings_cost'}
                            stackId="a"
                            fill={CATEGORY_COLORS.embeddings}
                            name="Embeddings"
                          />
                          <Bar
                            dataKey={isToken ? 'workspace_tokens' : 'workspace_cost'}
                            stackId="a"
                            fill={CATEGORY_COLORS.workspace}
                            name="Workspace"
                          />
                        </>
                      ) : (
                        <Bar
                          dataKey={isToken ? 'total_tokens' : 'total_cost'}
                          fill={
                            CATEGORY_COLORS[filters.category] || '#3B82F6'
                          }
                          name={isToken ? 'Tokens' : 'Cost'}
                        />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    No {isToken ? 'token' : 'cost'} usage data recorded yet. Data will appear as LLM
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
                            {isToken ? 'Tokens' : 'Cost'}
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
                              {isToken ? formatTokenCount(u.total_tokens) : formatCost(u.total_cost)}
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
                            {isToken ? 'Tokens' : 'Cost'}
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
                              {isToken ? formatTokenCount(m.total_tokens) : formatCost(m.total_cost)}
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

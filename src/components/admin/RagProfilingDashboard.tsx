'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Clock,
  FileText,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Play,
  Download,
  Trash2,
  ChevronDown,
  ChevronUp,
  Activity,
  Gauge,
  Layers,
  Zap,
} from 'lucide-react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

// ============ Types ============

interface DailyTrend {
  date: string;
  avgLatency: number;
  avgSimilarity: number;
  avgChunks: number;
  testCount: number;
}

interface KpiSummary {
  current: {
    avgLatency: number;
    avgSimilarity: number;
    avgChunks: number;
    totalTests: number;
  };
  prior: {
    avgLatency: number;
    avgSimilarity: number;
    avgChunks: number;
    totalTests: number;
  };
  deltas: {
    latencyDelta: number;
    similarityDelta: number;
    chunksDelta: number;
    testCountDelta: number;
  };
}

interface BatchSuite {
  id: number;
  name: string;
  queryCount: number;
  avgLatency: number;
  avgSimilarity: number;
  avgChunks: number;
  createdBy: string;
  createdAt: string;
}

interface SettingsImpact {
  label: string;
  avgLatency: number;
  avgSimilarity: number;
  avgChunks: number;
  testCount: number;
}

interface Category {
  id: number;
  name: string;
  slug: string;
}

// ============ KPI Card ============

function KpiCard({
  title,
  value,
  unit,
  delta,
  higherIsBetter,
  icon,
  color,
}: {
  title: string;
  value: string | number;
  unit?: string;
  delta: number;
  higherIsBetter: boolean;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'orange' | 'purple';
}) {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
  };

  const isGood = higherIsBetter ? delta > 0 : delta < 0;
  const isNeutral = delta === 0;

  return (
    <div className="bg-white rounded-lg border shadow-sm p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{title}</span>
        <span className={`p-1.5 rounded-lg ${colorClasses[color]}`}>{icon}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-gray-900">{value}</span>
        {unit && <span className="text-sm text-gray-500">{unit}</span>}
      </div>
      <div className="flex items-center gap-1 mt-1">
        {isNeutral ? (
          <Minus size={14} className="text-gray-400" />
        ) : isGood ? (
          <TrendingUp size={14} className="text-green-600" />
        ) : (
          <TrendingDown size={14} className="text-red-600" />
        )}
        <span
          className={`text-xs font-medium ${
            isNeutral ? 'text-gray-500' : isGood ? 'text-green-600' : 'text-red-600'
          }`}
        >
          {isNeutral ? 'No change' : `${delta > 0 ? '+' : ''}${delta}% vs last week`}
        </span>
      </div>
    </div>
  );
}

// ============ Custom Tooltip ============

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-gray-900 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-gray-600">{entry.name}:</span>
          <span className="font-medium text-gray-900">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

// ============ Main Component ============

export function RagProfilingDashboard({ embedded = false }: { embedded?: boolean } = {}) {
  // Tab state
  const [activeTab, setActiveTab] = useState<'summary' | 'batch' | 'settings'>('summary');

  // Data state
  const [dailyTrends, setDailyTrends] = useState<DailyTrend[]>([]);
  const [kpiSummary, setKpiSummary] = useState<KpiSummary | null>(null);
  const [settingsImpact, setSettingsImpact] = useState<SettingsImpact[]>([]);
  const [batchSuites, setBatchSuites] = useState<BatchSuite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Trend time range
  const [trendDays, setTrendDays] = useState(30);

  // Batch test state
  const [batchQueries, setBatchQueries] = useState('');
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResults, setBatchResults] = useState<{
    suiteId: number;
    name: string;
    queryCount: number;
    avgLatency: number;
    avgSimilarity: number;
    avgChunks: number;
    results: Array<{ query: string; chunksRetrieved: number; avgSimilarity: number; latencyMs: number }>;
  } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);

  // ============ Data Fetching ============

  const fetchTrends = useCallback(async (days: number) => {
    try {
      const res = await fetch(`/api/admin/rag-testing/trends?days=${days}&hourly=true&settings=true`);
      if (!res.ok) throw new Error('Failed to fetch trends');
      const data = await res.json();
      setDailyTrends(data.dailyTrends || []);
      setKpiSummary(data.kpiSummary || null);
      setSettingsImpact(data.settingsImpact || []);
    } catch (e) {
      console.error('Failed to fetch trends:', e);
    }
  }, []);

  const fetchBatchSuites = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/rag-testing/batch?limit=10');
      if (res.ok) {
        const data = await res.json();
        setBatchSuites(data.suites || []);
      }
    } catch (e) {
      console.error('Failed to fetch batch suites:', e);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/categories');
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
      }
    } catch (e) {
      console.error('Failed to fetch categories:', e);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchTrends(trendDays), fetchBatchSuites(), fetchCategories()]);
      setLoading(false);
    };
    load();
  }, [fetchTrends, fetchBatchSuites, fetchCategories, trendDays]);

  // ============ Batch Runner ============

  const handleRunBatch = async () => {
    const queries = batchQueries
      .split('\n')
      .map((q) => q.trim())
      .filter((q) => q.length > 0);

    if (queries.length === 0) {
      setError('Enter at least one query');
      return;
    }

    if (queries.length > 20) {
      setError('Maximum 20 queries per batch');
      return;
    }

    setBatchRunning(true);
    setError(null);
    setBatchResults(null);

     try {
       const res = await fetch('/api/admin/rag-testing/batch', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ queries, categoryIds: selectedCategoryIds }),
       });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Batch test failed');
      }

      const data = await res.json();
      setBatchResults(data);
      fetchBatchSuites();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Batch test failed');
    } finally {
      setBatchRunning(false);
    }
  };

  // ============ Export CSV ============

  const handleExportCsv = () => {
    if (!dailyTrends.length) return;

    const headers = ['Date', 'Avg Latency (ms)', 'Avg Similarity (%)', 'Avg Chunks', 'Test Count'];
    const rows = dailyTrends.map((d) =>
      [d.date, d.avgLatency, (d.avgSimilarity * 100).toFixed(1), d.avgChunks, d.testCount].join(',')
    );

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rag-trends-${trendDays}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ============ Loading State ============

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <RefreshCw size={20} className="animate-spin text-gray-400" />
      </div>
    );
  }

  // ============ Tab Header ============

  const tabs = [
    { id: 'summary' as const, label: 'Performance Summary', icon: <Gauge size={16} /> },
    { id: 'batch' as const, label: 'Batch Test Suites', icon: <Layers size={16} /> },
    { id: 'settings' as const, label: 'Settings Impact', icon: <Activity size={16} /> },
  ];

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="float-right text-red-500 hover:text-red-700">&times;</button>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ==================== Tab: Performance Summary ==================== */}
      {activeTab === 'summary' && (
        <div className="space-y-4">
          {/* KPI Cards */}
          {kpiSummary && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                title="Avg Latency"
                value={kpiSummary.current.avgLatency}
                unit="ms"
                delta={kpiSummary.deltas.latencyDelta}
                higherIsBetter={false}
                icon={<Zap size={16} />}
                color="orange"
              />
              <KpiCard
                title="Avg Similarity"
                value={(kpiSummary.current.avgSimilarity * 100).toFixed(1)}
                unit="%"
                delta={kpiSummary.deltas.similarityDelta}
                higherIsBetter={true}
                icon={<BarChart3 size={16} />}
                color="green"
              />
              <KpiCard
                title="Avg Chunks"
                value={kpiSummary.current.avgChunks}
                unit=""
                delta={kpiSummary.deltas.chunksDelta}
                higherIsBetter={false}
                icon={<FileText size={16} />}
                color="blue"
              />
              <KpiCard
                title="Tests (7 days)"
                value={kpiSummary.current.totalTests}
                unit="runs"
                delta={kpiSummary.deltas.testCountDelta}
                higherIsBetter={true}
                icon={<Activity size={16} />}
                color="purple"
              />
            </div>
          )}

          {/* Trend Chart */}
          <div className="bg-white rounded-lg border shadow-sm p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Performance Trends</h3>
              <div className="flex items-center gap-2">
                {/* Time range selector */}
                {[7, 14, 30, 90].map((days) => (
                  <button
                    key={days}
                    onClick={() => setTrendDays(days)}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                      trendDays === days
                        ? 'bg-blue-100 text-blue-700 font-medium'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {days}d
                  </button>
                ))}
                <button
                  onClick={handleExportCsv}
                  className="p-1.5 hover:bg-gray-100 rounded-md transition-colors"
                  title="Export CSV"
                >
                  <Download size={14} className="text-gray-500" />
                </button>
                <button
                  onClick={() => fetchTrends(trendDays)}
                  className="p-1.5 hover:bg-gray-100 rounded-md transition-colors"
                  title="Refresh"
                >
                  <RefreshCw size={14} className="text-gray-500" />
                </button>
              </div>
            </div>

            {dailyTrends.length === 0 ? (
              <div className="py-8 text-center text-gray-500 text-sm">
                No test data yet. Run some RAG tests to see trends.
              </div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyTrends} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorSimilarity" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(val) => {
                        const d = new Date(val);
                        return `${d.getMonth() + 1}/${d.getDate()}`;
                      }}
                    />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[0, 1]} />
                    <Tooltip content={<TrendTooltip />} />
                    <Legend />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="avgLatency"
                      name="Latency (ms)"
                      stroke="#f97316"
                      fill="url(#colorLatency)"
                      strokeWidth={2}
                    />
                    <Area
                      yAxisId="right"
                      type="monotone"
                      dataKey="avgSimilarity"
                      name="Similarity"
                      stroke="#22c55e"
                      fill="url(#colorSimilarity)"
                      strokeWidth={2}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="avgChunks"
                      name="Chunks"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== Tab: Batch Test Suites ==================== */}
      {activeTab === 'batch' && (
        <div className="space-y-4">
       {/* Batch Input */}
           <div className="bg-white rounded-lg border shadow-sm p-4">
             <h3 className="font-semibold text-gray-900 mb-2">Run Batch Test Suite</h3>
             <p className="text-sm text-gray-500 mb-3">
               Enter one query per line. All queries will be run against the current RAG settings.
             </p>

             {/* Category Selector */}
             <div className="mb-4">
               <label className="block text-sm font-medium text-gray-700 mb-2">
                 Category (optional)
               </label>
               {categories.length === 0 ? (
                 <p className="text-xs text-gray-500">No categories available</p>
               ) : (
                 <div className="flex flex-wrap gap-2">
                   {categories.map((cat) => (
                     <button
                       key={cat.id}
                       onClick={() => {
                         setSelectedCategoryIds((prev) =>
                           prev.includes(cat.id)
                             ? prev.filter((id) => id !== cat.id)
                             : [...prev, cat.id]
                         );
                       }}
                       className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                         selectedCategoryIds.includes(cat.id)
                           ? 'bg-purple-600 text-white'
                           : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                       }`}
                     >
                       {selectedCategoryIds.includes(cat.id) && <span className="mr-1">✓</span>}
                       {cat.name}
                     </button>
                   ))}
                 </div>
               )}
               {selectedCategoryIds.length === 0 && categories.length > 0 && (
                 <p className="text-xs text-gray-500 mt-2">
                   No category selected — queries will run against global documents only
                 </p>
               )}
             </div>

             <textarea
              value={batchQueries}
              onChange={(e) => setBatchQueries(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
              rows={5}
              placeholder={`What is the refund policy?\nHow do I file a claim?\nWhat are the coverage limits?`}
              disabled={batchRunning}
            />
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={handleRunBatch}
                disabled={batchRunning || !batchQueries.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
              >
                {batchRunning ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Play size={14} />
                )}
                {batchRunning ? 'Running...' : 'Run Suite'}
              </button>
              {batchQueries.trim() && (
                <span className="text-xs text-gray-500">
                  {batchQueries.split('\n').filter((q) => q.trim()).length} queries
                </span>
              )}
            </div>
          </div>

          {/* Batch Results */}
          {batchResults && (
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">{batchResults.name}</h3>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>{batchResults.queryCount} queries</span>
                  <span>{batchResults.avgLatency}ms avg</span>
                  <span>{(batchResults.avgSimilarity * 100).toFixed(1)}% avg sim</span>
                </div>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {batchResults.results.map((r, i) => (
                  <div key={i} className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-medium text-gray-900 truncate flex-1 mr-2">
                        {i + 1}. {r.query}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-gray-500 flex-shrink-0">
                        <span>{r.chunksRetrieved} chunks</span>
                        <span>{(r.avgSimilarity * 100).toFixed(1)}%</span>
                        <span>{r.latencyMs}ms</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Suites */}
          {batchSuites.length > 0 && (
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Recent Batch Suites</h3>
                <button
                  onClick={fetchBatchSuites}
                  className="p-1.5 hover:bg-gray-100 rounded-md transition-colors"
                  title="Refresh"
                >
                  <RefreshCw size={14} className="text-gray-500" />
                </button>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {batchSuites.map((suite) => (
                  <div key={suite.id} className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{suite.name}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          <span>{suite.queryCount} queries</span>
                          <span>{suite.avgLatency}ms avg</span>
                          <span>{(suite.avgSimilarity * 100).toFixed(1)}% sim</span>
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 ml-2">
                        {new Date(suite.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== Tab: Settings Impact ==================== */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border shadow-sm p-4">
            <h3 className="font-semibold text-gray-900 mb-1">Settings Impact Analysis</h3>
            <p className="text-sm text-gray-500 mb-4">
              Compare how different RAG configurations affect performance. Only configs with 2+ tests are shown.
            </p>

            {settingsImpact.length === 0 ? (
              <div className="py-8 text-center text-gray-500 text-sm">
                Not enough data. Run A/B tests with different settings to see comparisons.
              </div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={settingsImpact} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      angle={-20}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[0, 1]} />
                    <Tooltip content={<TrendTooltip />} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="avgLatency" name="Latency (ms)" fill="#f97316" radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="right" dataKey="avgSimilarity" name="Similarity" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Settings Impact Table */}
            {settingsImpact.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3 text-gray-600 font-medium">Configuration</th>
                      <th className="text-right py-2 px-3 text-gray-600 font-medium">Tests</th>
                      <th className="text-right py-2 px-3 text-gray-600 font-medium">Avg Latency</th>
                      <th className="text-right py-2 px-3 text-gray-600 font-medium">Avg Similarity</th>
                      <th className="text-right py-2 px-3 text-gray-600 font-medium">Avg Chunks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settingsImpact.map((s, i) => (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-3 font-medium text-gray-900">{s.label}</td>
                        <td className="py-2 px-3 text-right text-gray-600">{s.testCount}</td>
                        <td className="py-2 px-3 text-right text-gray-600">{s.avgLatency}ms</td>
                        <td className="py-2 px-3 text-right text-gray-600">{(s.avgSimilarity * 100).toFixed(1)}%</td>
                        <td className="py-2 px-3 text-right text-gray-600">{s.avgChunks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Play,
  RefreshCw,
  Beaker,
  ChevronDown,
  ChevronUp,
  Trash2,
  BarChart3,
  Clock,
  FileText,
  Settings,
} from 'lucide-react';

interface TestMetrics {
  chunksRetrieved: number;
  totalChunksFound: number;
  avgSimilarity: number;
  latencyMs: number;
}

interface TopChunk {
  id: string;
  documentName: string;
  text: string;
  score: number;
}

interface TestResult {
  settings: Record<string, unknown>;
  metrics: TestMetrics;
  chunks: TopChunk[];
}

interface SavedResult {
  id: number;
  queryId: number | null;
  testQuery: string;
  settingsSnapshot: Record<string, unknown>;
  chunksRetrieved: number;
  avgSimilarity: number;
  latencyMs: number;
  topChunks: TopChunk[];
  createdBy: string;
  createdAt: string;
}

interface TestStats {
  totalTests: number;
  avgLatency: number;
  avgChunksRetrieved: number;
  avgSimilarity: number;
}

interface Category {
  id: number;
  name: string;
  slug: string;
}

export function RagTuningDashboard({ embedded = false }: { embedded?: boolean } = {}) {
  // Current settings
  const [currentSettings, setCurrentSettings] = useState<Record<string, unknown> | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  // Test input
  const [testQuery, setTestQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<number[]>([]);

  // A/B testing
  const [enableVariant, setEnableVariant] = useState(false);
  const [variantSettings, setVariantSettings] = useState<{
    similarityThreshold?: number;
    topKChunks?: number;
    maxContextChunks?: number;
  }>({});

  // Results
  const [resultA, setResultA] = useState<TestResult | null>(null);
  const [resultB, setResultB] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // History
  const [savedResults, setSavedResults] = useState<SavedResult[]>([]);
  const [stats, setStats] = useState<TestStats | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedChunks, setExpandedChunks] = useState<'A' | 'B' | null>(null);

  // Fetch current settings and categories
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [settingsRes, categoriesRes] = await Promise.all([
          fetch('/api/admin/settings?type=rag'),
          fetch('/api/admin/categories'),
        ]);

        if (settingsRes.ok) {
          const data = await settingsRes.json();
          setCurrentSettings(data);
          // Initialize variant settings with current values
          setVariantSettings({
            similarityThreshold: data.similarityThreshold,
            topKChunks: data.topKChunks,
            maxContextChunks: data.maxContextChunks,
          });
        }

        if (categoriesRes.ok) {
          const data = await categoriesRes.json();
          setCategories(data.categories || []);
        }
      } catch (e) {
        console.error('Failed to fetch settings:', e);
      }
    };

    fetchData();
  }, []);

  // Fetch test history
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/rag-testing/results?limit=20');
      if (res.ok) {
        const data = await res.json();
        setSavedResults(data.results || []);
        setStats(data.stats || null);
      }
    } catch (e) {
      console.error('Failed to fetch history:', e);
    }
  }, []);

  useEffect(() => {
    if (showHistory) {
      fetchHistory();
    }
  }, [showHistory, fetchHistory]);

  // Run a single test
  const runTest = async (useVariant: boolean): Promise<TestResult | null> => {
    const res = await fetch('/api/admin/rag-testing/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: testQuery,
        categoryIds: selectedCategories,
        overrideSettings: useVariant ? variantSettings : {},
        saveResult: true,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Test failed');
    }

    return res.json();
  };

  // Handle run button
  const handleRun = async () => {
    if (!testQuery.trim()) {
      setError('Please enter a test query');
      return;
    }

    setLoading(true);
    setError(null);
    setResultA(null);
    setResultB(null);

    try {
      // Run test A (current settings)
      const resA = await runTest(false);
      setResultA(resA);

      // Run test B (variant settings) if enabled
      if (enableVariant) {
        const resB = await runTest(true);
        setResultB(resB);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setLoading(false);
    }
  };

  // Clean up old results
  const handleCleanup = async () => {
    try {
      const res = await fetch('/api/admin/rag-testing/results?keepRecent=50', {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchHistory();
      }
    } catch (e) {
      console.error('Cleanup failed:', e);
    }
  };

  // Category toggle
  const toggleCategory = (catId: number) => {
    setSelectedCategories((prev) =>
      prev.includes(catId)
        ? prev.filter((id) => id !== catId)
        : [...prev, catId]
    );
  };

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {/* Header */}
      <div className={embedded ? '' : 'bg-white rounded-lg border shadow-sm p-6'}>
        {!embedded && (
          <div className="flex items-center gap-3 mb-4">
            <Beaker className="text-purple-600" size={24} />
            <div>
              <h2 className="font-semibold text-gray-900">RAG Tuning Dashboard</h2>
              <p className="text-sm text-gray-500">
                Test and compare RAG settings with sample queries
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Test Query Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Test Query
            </label>
            <textarea
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              rows={3}
              placeholder="Enter a query to test against your document collection..."
            />
          </div>

          {/* Category Selection */}
          {categories.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Categories (optional - leave empty for all)
              </label>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => toggleCategory(cat.id)}
                    className={`px-3 py-1 text-sm rounded-full transition-colors ${
                      selectedCategories.includes(cat.id)
                        ? 'bg-purple-100 text-purple-700 border-purple-300 border'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* A/B Testing Toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enable-variant"
              checked={enableVariant}
              onChange={(e) => setEnableVariant(e.target.checked)}
              className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
            />
            <label htmlFor="enable-variant" className="text-sm text-gray-700">
              Enable A/B comparison with different settings
            </label>
          </div>

          {/* Variant Settings */}
          {enableVariant && (
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                <Settings size={14} />
                Variant B Settings
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Similarity Threshold
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={variantSettings.similarityThreshold ?? (currentSettings?.similarityThreshold as number) ?? 0.5}
                    onChange={(e) =>
                      setVariantSettings({
                        ...variantSettings,
                        similarityThreshold: parseFloat(e.target.value),
                      })
                    }
                    className="w-full px-2 py-1 border rounded text-sm focus:ring-1 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Top K Chunks
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={variantSettings.topKChunks ?? (currentSettings?.topKChunks as number) ?? 15}
                    onChange={(e) =>
                      setVariantSettings({
                        ...variantSettings,
                        topKChunks: parseInt(e.target.value),
                      })
                    }
                    className="w-full px-2 py-1 border rounded text-sm focus:ring-1 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Max Context Chunks
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={variantSettings.maxContextChunks ?? (currentSettings?.maxContextChunks as number) ?? 10}
                    onChange={(e) =>
                      setVariantSettings({
                        ...variantSettings,
                        maxContextChunks: parseInt(e.target.value),
                      })
                    }
                    className="w-full px-2 py-1 border rounded text-sm focus:ring-1 focus:ring-purple-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Run Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleRun}
              disabled={loading || !testQuery.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              {loading ? 'Running...' : 'Run Test'}
            </button>

            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <Clock size={16} />
              {showHistory ? 'Hide' : 'Show'} History
            </button>
          </div>
        </div>
      </div>

      {/* Results Comparison */}
      {resultA && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ResultCard
            label="A"
            subtitle="Current Settings"
            color="blue"
            result={resultA}
            expanded={expandedChunks === 'A'}
            onToggleExpand={() => setExpandedChunks(expandedChunks === 'A' ? null : 'A')}
          />
          {resultB && (
            <ResultCard
              label="B"
              subtitle="Variant Settings"
              color="green"
              result={resultB}
              comparison={resultA}
              expanded={expandedChunks === 'B'}
              onToggleExpand={() => setExpandedChunks(expandedChunks === 'B' ? null : 'B')}
            />
          )}
        </div>
      )}

      {/* History Section */}
      {showHistory && (
        <div className={embedded ? 'pt-4 border-t' : 'bg-white rounded-lg border shadow-sm p-6'}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 size={20} className="text-gray-600" />
              <h3 className="font-medium text-gray-900">Test History</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchHistory}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Refresh"
              >
                <RefreshCw size={16} className="text-gray-500" />
              </button>
              <button
                onClick={handleCleanup}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Clean up old results"
              >
                <Trash2 size={16} className="text-gray-500" />
              </button>
            </div>
          </div>

          {/* Stats Summary */}
          {stats && stats.totalTests > 0 && (
            <div className="grid grid-cols-4 gap-4 mb-4 p-3 bg-gray-50 rounded-lg">
              <div className="text-center">
                <div className="text-lg font-semibold text-gray-900">{stats.totalTests}</div>
                <div className="text-xs text-gray-500">Total Tests</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-gray-900">{stats.avgLatency}ms</div>
                <div className="text-xs text-gray-500">Avg Latency</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-gray-900">{stats.avgChunksRetrieved}</div>
                <div className="text-xs text-gray-500">Avg Chunks</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-gray-900">
                  {(stats.avgSimilarity * 100).toFixed(1)}%
                </div>
                <div className="text-xs text-gray-500">Avg Similarity</div>
              </div>
            </div>
          )}

          {/* Results List */}
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {savedResults.length === 0 ? (
              <p className="text-center text-gray-500 py-4">No test results yet</p>
            ) : (
              savedResults.map((result) => (
                <div
                  key={result.id}
                  className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {result.testQuery}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span>{result.chunksRetrieved} chunks</span>
                        <span>{(result.avgSimilarity * 100).toFixed(1)}% avg</span>
                        <span>{result.latencyMs}ms</span>
                      </div>
                    </div>
                    <div className="text-xs text-gray-400 ml-2">
                      {new Date(result.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Result Card Component
function ResultCard({
  label,
  subtitle,
  color,
  result,
  comparison,
  expanded,
  onToggleExpand,
}: {
  label: string;
  subtitle: string;
  color: 'blue' | 'green';
  result: TestResult;
  comparison?: TestResult | null;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const colorClasses =
    color === 'blue'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-green-100 text-green-700';

  // Calculate comparison deltas
  const getDelta = (current: number, compare: number | undefined) => {
    if (compare === undefined) return null;
    const delta = current - compare;
    if (Math.abs(delta) < 0.001) return null;
    return delta;
  };

  const renderDelta = (delta: number | null, higherIsBetter: boolean, format: (n: number) => string) => {
    if (delta === null) return null;
    const isGood = higherIsBetter ? delta > 0 : delta < 0;
    return (
      <span className={`text-xs ${isGood ? 'text-green-600' : 'text-red-600'}`}>
        ({delta > 0 ? '+' : ''}{format(delta)})
      </span>
    );
  };

  return (
    <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-gray-50">
        <div className="flex items-center gap-3">
          <span
            className={`w-8 h-8 ${colorClasses} rounded-full flex items-center justify-center font-semibold`}
          >
            {label}
          </span>
          <div>
            <h3 className="font-medium text-gray-900">Variant {label}</h3>
            <p className="text-xs text-gray-500">{subtitle}</p>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="px-6 py-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="text-lg font-semibold text-gray-900">
              {result.metrics.chunksRetrieved}
              <span className="text-xs text-gray-400 font-normal">
                /{result.metrics.totalChunksFound}
              </span>
            </div>
            <div className="text-xs text-gray-500">Chunks</div>
            {comparison && renderDelta(
              getDelta(result.metrics.chunksRetrieved, comparison.metrics.chunksRetrieved),
              true,
              (n) => n.toString()
            )}
          </div>
          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="text-lg font-semibold text-gray-900">
              {(result.metrics.avgSimilarity * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-gray-500">Avg Score</div>
            {comparison && renderDelta(
              getDelta(result.metrics.avgSimilarity, comparison.metrics.avgSimilarity),
              true,
              (n) => `${(n * 100).toFixed(1)}%`
            )}
          </div>
          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="text-lg font-semibold text-gray-900">
              {result.metrics.latencyMs}ms
            </div>
            <div className="text-xs text-gray-500">Latency</div>
            {comparison && renderDelta(
              getDelta(result.metrics.latencyMs, comparison.metrics.latencyMs),
              false,
              (n) => `${n}ms`
            )}
          </div>
        </div>

        {/* Expand Chunks */}
        <button
          onClick={onToggleExpand}
          className="w-full mt-4 flex items-center justify-center gap-2 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <FileText size={14} />
          {expanded ? 'Hide' : 'Show'} Retrieved Chunks
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {/* Chunks List */}
        {expanded && (
          <div className="mt-4 space-y-2 max-h-80 overflow-y-auto">
            {result.chunks.map((chunk, i) => (
              <div
                key={chunk.id}
                className="p-3 bg-gray-50 rounded-lg border border-gray-100"
              >
                <div className="flex items-start justify-between mb-1">
                  <span className="text-xs font-medium text-gray-700">
                    {i + 1}. {chunk.documentName}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      chunk.score >= 0.7
                        ? 'bg-green-100 text-green-700'
                        : chunk.score >= 0.5
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {(chunk.score * 100).toFixed(1)}%
                  </span>
                </div>
                <p className="text-sm text-gray-600 line-clamp-3">{chunk.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

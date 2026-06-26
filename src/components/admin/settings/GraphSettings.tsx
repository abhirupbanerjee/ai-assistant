'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, RefreshCw, Trash2, AlertCircle, CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import ExtractionModelSelector from './ExtractionModelSelector';

interface GraphSettingsData {
  graphAugmentationEnabled: boolean;
  skipThreshold: number;
  pprTopK: number;
  seedChunkCount: number;
  resolutionThreshold: number;
  extractionModel: string;
  maxTokens: number;
  concurrency: number;
}

interface GraphStatus {
  healthy: boolean;
  graphExists: boolean;
  entityCount: number;
  chunkCount: number;
  relationCount: number;
  documentCount: number;
  qdrantChunkCount: number;
  pendingChunks: number;
  statsError: string | null;
}

interface ExtractionFailure {
  id: number;
  qdrant_id: string;
  document_id: string;
  document_name: string | null;
  error: string;
  retry_count: number;
  created_at: string;
}

interface PerformanceSummary {
  totalQueries: number;
  graphEnabledCount: number;
  graphHitRate: number;
  skipRate: number;
  avgChunkExpansion: number;
  avgLatencyMs: number;
  multiHopRate: number;
}

interface TrendPoint {
  date: string;
  hitRate: number;
  skipRate: number;
  avgLatencyMs: number;
  total: number;
  hits: number;
}

interface TopEntity {
  entity: string;
  expansionCount: number;
}

export default function GraphSettings() {
  const [settings, setSettings] = useState<GraphSettingsData>({
    graphAugmentationEnabled: false,
    skipThreshold: 0.85,
    pprTopK: 20,
    seedChunkCount: 10,
    resolutionThreshold: 0.92,
    extractionModel: '',
    maxTokens: 1024,
    concurrency: 4,
  });
  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [failures, setFailures] = useState<ExtractionFailure[]>([]);
  const [failureTotal, setFailureTotal] = useState(0);
  const [perf, setPerf] = useState<PerformanceSummary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [topEntities, setTopEntities] = useState<TopEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showFailures, setShowFailures] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [settingsRes, statusRes, failuresRes, perfRes] = await Promise.all([
        fetch('/api/admin/settings'),
        fetch('/api/admin/graph/status'),
        fetch('/api/admin/graph/failures?limit=100'),
        fetch('/api/admin/graph/performance?days=30'),
      ]);

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        if (data.graph) {
          setSettings({
            graphAugmentationEnabled: data.graph.graphAugmentationEnabled ?? false,
            skipThreshold: data.graph.skipThreshold ?? 0.85,
            pprTopK: data.graph.pprTopK ?? 20,
            seedChunkCount: data.graph.seedChunkCount ?? 10,
            resolutionThreshold: data.graph.resolutionThreshold ?? 0.92,
            extractionModel: data.graph.extractionModel ?? '',
            maxTokens: data.graph.maxTokens ?? 1024,
            concurrency: data.graph.concurrency ?? 4,
          });
        }
      }

      if (statusRes.ok) {
        setStatus(await statusRes.json());
      }

      if (failuresRes.ok) {
        const fData = await failuresRes.json();
        setFailures(fData.failures || []);
        setFailureTotal(fData.total || 0);
      }

      if (perfRes.ok) {
        const pData = await perfRes.json();
        setPerf(pData.summary || null);
        setTrend(pData.trend || []);
        setTopEntities(pData.topExpandedEntities || []);
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to load graph settings' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'graph', settings }),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Settings saved' });
      } else {
        setMessage({ type: 'error', text: 'Failed to save settings' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleBackfill = async (mode: 'full' | 'failed') => {
    setBackfilling(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/graph/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'nothing_to_do') {
          setMessage({ type: 'success', text: data.message });
        } else {
          setMessage({ type: 'success', text: data.message || 'Backfill started' });
          // Refresh status after a delay to show progress
          setTimeout(fetchData, 5000);
        }
      } else {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        setMessage({ type: 'error', text: errData.error || 'Failed to start backfill' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to start backfill' });
    } finally {
      setBackfilling(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('This will delete ALL graph data (entities, chunks, relations) and reset the extraction cache. Continue?')) return;
    setClearing(true);
    try {
      const res = await fetch('/api/admin/graph/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessage({ type: 'success', text: data.message || 'Graph cleared' });
        fetchData();
      } else {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        setMessage({ type: 'error', text: errData.error || 'Failed to clear graph' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to clear graph' });
    } finally {
      setClearing(false);
    }
  };

  const handleRetryFailures = async () => {
    if (failures.length === 0) return;
    setBackfilling(true);
    const qdrantIds = failures.map(f => f.qdrant_id);
    try {
      const res = await fetch('/api/admin/graph/failures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qdrantIds }),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: `Reprocessing ${qdrantIds.length} failed chunks` });
        setTimeout(fetchData, 3000);
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to reprocess' });
    } finally {
      setBackfilling(false);
    }
  };

  const handleClearFailures = async () => {
    try {
      await fetch('/api/admin/graph/failures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearOnly: true }),
      });
      fetchData();
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {message && (
        <div className={`p-4 rounded-lg flex items-center gap-3 ${
          message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
        }`}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto">
            <XCircle size={16} />
          </button>
        </div>
      )}

      {/* Enable Toggle */}
      <div className="bg-white rounded-lg border p-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.graphAugmentationEnabled}
            onChange={(e) => setSettings(s => ({ ...s, graphAugmentationEnabled: e.target.checked }))}
            className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <div className="font-medium text-gray-900">Enable Graph-Augmented Retrieval</div>
            <div className="text-sm text-gray-500">
              Multi-hop entity graph expansion between Qdrant search and reranking. Requires FalkorDB service.
            </div>
          </div>
        </label>
      </div>

      {/* Graph Status */}
      {status && (
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-medium text-gray-900 mb-4">Graph Status</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500">FalkorDB:</span>
              {status.healthy ? (
                <span className="flex items-center gap-1 text-green-700">
                  <CheckCircle size={14} /> Connected
                </span>
              ) : (
                <span className="flex items-center gap-1 text-red-700">
                  <XCircle size={14} /> Disconnected
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Graph:</span>
              {status.graphExists ? (
                <span className="text-green-700 font-medium">Initialized</span>
              ) : status.healthy ? (
                <span className="text-amber-600 font-medium">Not initialized — run backfill</span>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </div>
            <div><span className="text-gray-500">Entities:</span> <span className="font-medium">{status.entityCount.toLocaleString()}</span></div>
            <div><span className="text-gray-500">Chunks:</span> <span className="font-medium">{status.chunkCount.toLocaleString()}</span></div>
            <div><span className="text-gray-500">Relations:</span> <span className="font-medium">{status.relationCount.toLocaleString()}</span></div>
            <div><span className="text-gray-500">Documents:</span> <span className="font-medium">{status.documentCount?.toLocaleString() ?? '0'}</span></div>
            <div>
              <span className="text-gray-500">Pending:</span>{' '}
              <span className={`font-medium ${status.pendingChunks > 0 ? 'text-amber-600' : 'text-green-700'}`}>
                {status.pendingChunks?.toLocaleString() ?? '0'}
              </span>
              {status.qdrantChunkCount > 0 && (
                <span className="text-xs text-gray-400 ml-1">/ {status.qdrantChunkCount.toLocaleString()} total</span>
              )}
            </div>
            <div><span className="text-gray-500">Failed:</span> <span className={failureTotal > 0 ? 'text-red-600 font-medium' : 'font-medium'}>{failureTotal.toLocaleString()}</span></div>
          </div>
          {status.statsError && (
            <div className="mt-3 p-3 bg-amber-50 text-amber-800 text-xs rounded-lg">
              <strong>Stats error:</strong> {status.statsError}
            </div>
          )}
        </div>
      )}

      {/* LLM Configuration */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="font-medium text-gray-900 mb-4">LLM Configuration</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Extraction Model</label>
            <ExtractionModelSelector
              value={settings.extractionModel}
              onChange={(modelId) => setSettings(s => ({ ...s, extractionModel: modelId }))}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              Max Tokens: <span className="font-medium">{settings.maxTokens}</span>
            </label>
            <input
              type="range"
              min={256}
              max={4096}
              step={128}
              value={settings.maxTokens}
              onChange={(e) => setSettings(s => ({ ...s, maxTokens: parseInt(e.target.value) }))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>256</span><span>4096</span>
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              Concurrency: <span className="font-medium">{settings.concurrency}</span>
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={settings.concurrency}
              onChange={(e) => setSettings(s => ({ ...s, concurrency: parseInt(e.target.value) }))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>1</span><span>10</span>
            </div>
          </div>
        </div>
      </div>

      {/* Retrieval Tuning */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="font-medium text-gray-900 mb-4">Retrieval Tuning</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              Skip Threshold: <span className="font-medium">{settings.skipThreshold.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0.5}
              max={0.99}
              step={0.01}
              value={settings.skipThreshold}
              onChange={(e) => setSettings(s => ({ ...s, skipThreshold: parseFloat(e.target.value) }))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>0.50</span><span>0.99</span>
            </div>
            <div className="text-xs text-gray-400 mt-1">Skip graph when top Qdrant score exceeds this</div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              PPR Top-K Entities: <span className="font-medium">{settings.pprTopK}</span>
            </label>
            <input
              type="range"
              min={5}
              max={50}
              step={5}
              value={settings.pprTopK}
              onChange={(e) => setSettings(s => ({ ...s, pprTopK: parseInt(e.target.value) }))}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              Seed Chunk Count: <span className="font-medium">{settings.seedChunkCount}</span>
            </label>
            <input
              type="range"
              min={3}
              max={30}
              step={1}
              value={settings.seedChunkCount}
              onChange={(e) => setSettings(s => ({ ...s, seedChunkCount: parseInt(e.target.value) }))}
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Performance */}
      {perf && (
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-medium text-gray-900 mb-4">Performance (Last 30 Days)</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-xs text-blue-600 mb-1">Hit Rate</div>
              <div className="text-lg font-bold text-blue-900">{(perf.graphHitRate * 100).toFixed(1)}%</div>
              <div className="text-xs text-blue-500">{perf.graphEnabledCount} queries</div>
            </div>
            <div className="bg-amber-50 rounded-lg p-3">
              <div className="text-xs text-amber-600 mb-1">Skip Rate</div>
              <div className="text-lg font-bold text-amber-900">{(perf.skipRate * 100).toFixed(1)}%</div>
              <div className="text-xs text-amber-500">high-confidence</div>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <div className="text-xs text-green-600 mb-1">Avg Expansion</div>
              <div className="text-lg font-bold text-green-900">{perf.avgChunkExpansion.toFixed(1)}</div>
              <div className="text-xs text-green-500">chunks/query</div>
            </div>
            <div className="bg-purple-50 rounded-lg p-3">
              <div className="text-xs text-purple-600 mb-1">Avg Latency</div>
              <div className="text-lg font-bold text-purple-900">{perf.avgLatencyMs}ms</div>
              <div className="text-xs text-purple-500">graph step</div>
            </div>
          </div>

          {/* Trend table */}
          {trend.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Daily Trend</h4>
              <div className="max-h-48 overflow-y-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-600">Date</th>
                      <th className="text-center px-3 py-2 text-gray-600">Queries</th>
                      <th className="text-center px-3 py-2 text-gray-600">Hits</th>
                      <th className="text-center px-3 py-2 text-gray-600">Hit Rate</th>
                      <th className="text-center px-3 py-2 text-gray-600">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map(t => (
                      <tr key={t.date} className="border-t">
                        <td className="px-3 py-2">{t.date}</td>
                        <td className="px-3 py-2 text-center">{t.total}</td>
                        <td className="px-3 py-2 text-center">{t.hits}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`font-medium ${t.hitRate > 0.5 ? 'text-green-700' : t.hitRate > 0.2 ? 'text-amber-700' : 'text-red-700'}`}>
                            {(t.hitRate * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">{t.avgLatencyMs}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top expanded entities */}
          {topEntities.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Top Expanded Entities</h4>
              <div className="flex flex-wrap gap-2">
                {topEntities.map(e => (
                  <span key={e.entity} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs">
                    <span className="font-medium">{e.entity.replace('entity:', '').replace(/_/g, ' ')}</span>
                    <span className="text-gray-500">({e.expansionCount})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Maintenance */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="font-medium text-gray-900 mb-4">Maintenance</h3>
        {status && status.pendingChunks > 0 && !backfilling && (
          <div className="mb-3 p-3 bg-amber-50 text-amber-800 text-sm rounded-lg flex items-center gap-2">
            <AlertCircle size={16} />
            {status.pendingChunks.toLocaleString()} chunks pending extraction — run Backfill All to process them
          </div>
        )}
        {status && status.pendingChunks === 0 && failureTotal === 0 && status.graphExists && !backfilling && (
          <div className="mb-3 p-3 bg-green-50 text-green-700 text-sm rounded-lg flex items-center gap-2">
            <CheckCircle size={16} />
            All chunks extracted — no backfill needed
          </div>
        )}
        {status && status.pendingChunks === 0 && failureTotal > 0 && status.graphExists && !backfilling && (
          <div className="mb-3 p-3 bg-amber-50 text-amber-800 text-sm rounded-lg flex items-center gap-2">
            <AlertCircle size={16} />
            {failureTotal.toLocaleString()} chunk extraction(s) failed — reprocess failed chunks below
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => handleBackfill('full')}
            disabled={backfilling}
            variant="primary"
          >
            <RefreshCw size={16} className={backfilling ? 'animate-spin' : ''} />
            Backfill All
          </Button>
          {failureTotal > 0 && (
            <Button
              onClick={handleRetryFailures}
              disabled={backfilling}
              variant="secondary"
            >
              <RefreshCw size={16} className={backfilling ? 'animate-spin' : ''} />
              Reprocess {failureTotal} Failed
            </Button>
          )}
          <Button
            onClick={handleClear}
            disabled={clearing}
            variant="danger"
          >
            <Trash2 size={16} />
            Clear Graph
          </Button>
        </div>

        {/* Failed chunks section */}
        {failureTotal > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowFailures(!showFailures)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
            >
              {showFailures ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {showFailures ? 'Hide' : 'View'} Failed Chunks ({failureTotal})
            </button>
            {showFailures && (
              <div className="mt-2 border rounded-lg overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 text-gray-600">Chunk ID</th>
                        <th className="text-left px-3 py-2 text-gray-600">Document</th>
                        <th className="text-left px-3 py-2 text-gray-600">Error</th>
                        <th className="text-center px-3 py-2 text-gray-600">Retries</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failures.slice(0, 50).map(f => (
                        <tr key={f.id} className="border-t">
                          <td className="px-3 py-2 font-mono text-xs">{f.qdrant_id}</td>
                          <td className="px-3 py-2 text-xs max-w-[150px] truncate">{f.document_name || f.document_id}</td>
                          <td className="px-3 py-2 text-xs text-red-600 max-w-[150px] truncate">{f.error}</td>
                          <td className="px-3 py-2 text-xs text-center">{f.retry_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="bg-gray-50 border-t px-3 py-2 flex justify-between">
                  <button onClick={handleClearFailures} className="text-xs text-gray-500 hover:text-red-600">
                    Clear failure records
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} variant="primary">
          <Save size={16} />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}

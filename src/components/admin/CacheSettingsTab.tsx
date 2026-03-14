'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, Database, HardDrive, AlertCircle, CheckCircle, Settings, Zap } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';

interface CacheStats {
  memory: {
    used: string;
    usedBytes: number;
    peak: string;
    peakBytes: number;
    rss: string;
  };
  config: {
    maxmemory: string;
    maxmemoryHuman: string;
    maxmemoryPolicy: string;
  };
  keys: {
    rag: number;
    tavily: number;
    dataApi: number;
    functionApi: number;
    total: number;
  };
  uptime: string;
}

const EVICTION_POLICIES = [
  { value: 'noeviction', label: 'No Eviction', description: 'Return errors when memory limit is reached - no data is automatically deleted' },
  { value: 'allkeys-lru', label: 'Least Recently Used (Recommended)', description: 'Remove keys that have not been accessed for the longest time' },
  { value: 'allkeys-lfu', label: 'Least Frequently Used', description: 'Remove keys that are accessed least often' },
  { value: 'volatile-lru', label: 'Least Recently Used (Only Expiring Keys)', description: 'Remove least recently used keys, but only those with an expiration time set' },
  { value: 'volatile-ttl', label: 'Shortest Time-to-Live', description: 'Remove keys that are closest to their expiration time' },
];

export default function CacheSettingsTab({ readOnly = false }: { readOnly?: boolean }) {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ action: string; label: string } | null>(null);

  // Config form state
  const [maxMemoryMB, setMaxMemoryMB] = useState<number>(256);
  const [evictionPolicy, setEvictionPolicy] = useState<string>('allkeys-lru');

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/admin/cache');
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch cache stats');
      }
      const data = await res.json();
      setStats(data);

      // Update form with current config
      const currentMaxMB = Math.round(parseInt(data.config.maxmemory) / (1024 * 1024));
      if (currentMaxMB > 0) setMaxMemoryMB(currentMaxMB);
      setEvictionPolicy(data.config.maxmemoryPolicy);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cache stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const executeAction = async (action: string, value?: string | number) => {
    try {
      setActionLoading(action);
      setError(null);
      setSuccess(null);

      const res = await fetch('/api/admin/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, value }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Action failed');
      }

      const data = await res.json();

      if (action.startsWith('flush')) {
        setSuccess(`Cleared ${data.deleted ?? 'all'} ${data.type} cache entries`);
      } else if (action === 'set-maxmemory') {
        setSuccess(`Memory limit set to ${value}MB`);
      } else if (action === 'set-policy') {
        setSuccess(`Eviction policy set to ${value}`);
      }

      // Refresh stats
      await fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
      setConfirmModal(null);
    }
  };

  const handleFlush = (action: string, label: string) => {
    setConfirmModal({ action, label });
  };

  const handleSaveConfig = async () => {
    await executeAction('set-maxmemory', maxMemoryMB);
    await executeAction('set-policy', evictionPolicy);
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  const memoryPercent = stats?.config.maxmemory && parseInt(stats.config.maxmemory) > 0
    ? Math.round((stats.memory.usedBytes / parseInt(stats.config.maxmemory)) * 100)
    : 0;

  return (
    <div className={`space-y-6 ${readOnly ? '[&_input]:pointer-events-none [&_select]:pointer-events-none [&_input]:opacity-75 [&_select]:opacity-75' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Cache Management</h2>
          <p className="text-sm text-gray-500">{readOnly ? 'Redis cache status (view only).' : 'Monitor and manage Redis cache'}</p>
        </div>
        <Button
          variant="secondary"
          onClick={fetchStats}
          disabled={loading}
          className="flex items-center gap-2"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-3">
          <AlertCircle size={20} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-700 hover:text-red-900">&times;</button>
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-50 text-green-700 rounded-lg flex items-center gap-3">
          <CheckCircle size={20} />
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="ml-auto text-green-700 hover:text-green-900">&times;</button>
        </div>
      )}

      {/* Memory Usage Card */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <HardDrive size={18} />
            Memory Usage
          </h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">{stats?.memory.used || 'N/A'}</div>
              <div className="text-sm text-gray-500">Used Memory</div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-600">{stats?.config.maxmemoryHuman || 'No Limit'}</div>
              <div className="text-sm text-gray-500">Max Memory</div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-orange-600">{stats?.memory.peak || 'N/A'}</div>
              <div className="text-sm text-gray-500">Peak Memory</div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">{stats?.uptime || 'N/A'}</div>
              <div className="text-sm text-gray-500">Uptime</div>
            </div>
          </div>

          {/* Memory Progress Bar */}
          {parseInt(stats?.config.maxmemory || '0') > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Memory Utilization</span>
                <span className={`font-medium ${memoryPercent > 80 ? 'text-red-600' : memoryPercent > 60 ? 'text-orange-600' : 'text-green-600'}`}>
                  {memoryPercent}%
                </span>
              </div>
              <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    memoryPercent > 80 ? 'bg-red-500' : memoryPercent > 60 ? 'bg-orange-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(memoryPercent, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cache Keys Card */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Database size={18} />
            Cache Keys
          </h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
              <div>
                <div className="text-2xl font-bold text-blue-600">{stats?.keys.rag ?? 0}</div>
                <div className="text-sm text-blue-700">RAG Queries</div>
              </div>
              {!readOnly && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleFlush('flush-rag', 'RAG cache')}
                  disabled={actionLoading !== null || (stats?.keys.rag ?? 0) === 0}
                  className="!p-2"
                  title="Clear RAG cache"
                >
                  <Trash2 size={16} />
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
              <div>
                <div className="text-2xl font-bold text-green-600">{stats?.keys.tavily ?? 0}</div>
                <div className="text-sm text-green-700">Web Search</div>
              </div>
              {!readOnly && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleFlush('flush-tavily', 'Web Search cache')}
                  disabled={actionLoading !== null || (stats?.keys.tavily ?? 0) === 0}
                  className="!p-2"
                  title="Clear Web Search cache"
                >
                  <Trash2 size={16} />
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between p-4 bg-purple-50 rounded-lg">
              <div>
                <div className="text-2xl font-bold text-purple-600">{stats?.keys.dataApi ?? 0}</div>
                <div className="text-sm text-purple-700">Data API</div>
              </div>
              {!readOnly && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleFlush('flush-data-api', 'Data API cache')}
                  disabled={actionLoading !== null || (stats?.keys.dataApi ?? 0) === 0}
                  className="!p-2"
                  title="Clear Data API cache"
                >
                  <Trash2 size={16} />
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between p-4 bg-orange-50 rounded-lg">
              <div>
                <div className="text-2xl font-bold text-orange-600">{stats?.keys.functionApi ?? 0}</div>
                <div className="text-sm text-orange-700">Function API</div>
              </div>
              {!readOnly && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleFlush('flush-function-api', 'Function API cache')}
                  disabled={actionLoading !== null || (stats?.keys.functionApi ?? 0) === 0}
                  className="!p-2"
                  title="Clear Function API cache"
                >
                  <Trash2 size={16} />
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between p-4 bg-red-50 rounded-lg">
              <div>
                <div className="text-2xl font-bold text-red-600">{stats?.keys.total ?? 0}</div>
                <div className="text-sm text-red-700">Total Keys</div>
              </div>
              {!readOnly && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleFlush('flush-all', 'ALL cache')}
                  disabled={actionLoading !== null || (stats?.keys.total ?? 0) === 0}
                  className="!p-2"
                  title="Clear all cache"
                >
                  <Trash2 size={16} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Card */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Settings size={18} />
            Memory Configuration
          </h3>
          <p className="text-sm text-gray-500 mt-1">Configure memory limits and eviction policy</p>
        </div>
        <div className="p-6 space-y-6">
          {/* Max Memory */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Maximum Memory (MB)
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={maxMemoryMB}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 0;
                  setMaxMemoryMB(Math.min(Math.max(val, 0), 4096));
                }}
                min={0}
                max={4096}
                className={`w-32 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  maxMemoryMB > 4096 ? 'border-red-500' : ''
                }`}
              />
              <span className="text-sm text-gray-500">0 = no limit (not recommended)</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Recommended: 256MB for small deployments, 512MB for medium. Maximum allowed: 4096MB (4GB).
            </p>
            {maxMemoryMB > 4096 && (
              <p className="text-xs text-red-600 mt-1">
                Value cannot exceed 4096MB (4GB). The value has been capped.
              </p>
            )}
          </div>

          {/* Eviction Policy */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Eviction Policy
            </label>
            <select
              value={evictionPolicy}
              onChange={(e) => setEvictionPolicy(e.target.value)}
              className="w-full max-w-md px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {EVICTION_POLICIES.map((policy) => (
                <option key={policy.value} value={policy.value}>
                  {policy.label} - {policy.description}
                </option>
              ))}
            </select>
          </div>

          {/* Save Button */}
          {!readOnly && (
            <div className="pt-4 border-t">
              <Button
                onClick={handleSaveConfig}
                disabled={actionLoading !== null}
                className="flex items-center gap-2"
              >
                {actionLoading ? <Spinner size="sm" /> : <Zap size={16} />}
                Apply Configuration
              </Button>
              <p className="text-xs text-gray-400 mt-2">
                Note: Changes are applied immediately but not persisted across Redis restarts.
                For permanent changes, update your Redis config file or Docker command.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      <Modal
        isOpen={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        title="Confirm Cache Clear"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            Are you sure you want to clear <strong>{confirmModal?.label}</strong>?
            {confirmModal?.action === 'flush-all' && (
              <span className="block mt-2 text-red-600 text-sm">
                This will clear all cached data including RAG, Web Search, Data API, and Function API caches.
              </span>
            )}
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirmModal(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmModal?.action === 'flush-all' ? 'danger' : 'primary'}
              onClick={() => confirmModal && executeAction(confirmModal.action)}
              disabled={actionLoading !== null}
            >
              {actionLoading ? <Spinner size="sm" /> : 'Clear Cache'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

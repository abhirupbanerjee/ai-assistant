'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Database,
  HardDrive,
  Server,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface DatabaseInfo {
  provider: 'sqlite' | 'postgres';
  connected: boolean;
  connectionString?: string;
  version?: string;
  error?: string;
}

interface VectorStoreInfo {
  provider: 'qdrant';
  connected: boolean;
  host?: string;
  collections: number;
  totalVectors: number;
  error?: string;
}

interface InfrastructureData {
  timestamp: string;
  database: DatabaseInfo;
  vectorStore: VectorStoreInfo;
  environment: {
    nodeEnv: string;
    maxUploadSize: string;
  };
}

export default function InfrastructureStatus() {
  const [data, setData] = useState<InfrastructureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/infrastructure');
      if (!res.ok) throw new Error('Failed to fetch infrastructure status');
      const result = await res.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const getProviderDisplayName = (provider: string): string => {
    const names: Record<string, string> = {
      sqlite: 'SQLite',
      postgres: 'PostgreSQL',
      qdrant: 'Qdrant',
    };
    return names[provider] || provider;
  };

  const getProviderDescription = (provider: string): string => {
    const descriptions: Record<string, string> = {
      sqlite: 'File-based database for single-server deployments',
      postgres: 'Production-grade database with connection pooling',
      qdrant: 'High-performance vector similarity search engine',
    };
    return descriptions[provider] || '';
  };

  const StatusBadge = ({ connected, error }: { connected: boolean; error?: string }) => {
    if (connected) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
          <CheckCircle size={14} />
          Connected
        </span>
      );
    }
    if (error) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700">
          <XCircle size={14} />
          Error
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-700">
        <AlertTriangle size={14} />
        Disconnected
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            &times;
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Infrastructure Status</h2>
          <p className="text-sm text-gray-500">Active database and vector store configuration</p>
        </div>
        <Button variant="secondary" onClick={fetchStatus} disabled={loading}>
          <RefreshCw size={16} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : data ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Database Card */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Database className="text-blue-600" size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Database</h3>
                    <p className="text-sm text-gray-500">Primary data store</p>
                  </div>
                </div>
                <StatusBadge connected={data.database.connected} error={data.database.error} />
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Provider */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Provider</span>
                <span className="font-medium text-gray-900">
                  {getProviderDisplayName(data.database.provider)}
                </span>
              </div>

              {/* Connection */}
              {data.database.connectionString && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Connection</span>
                  <code className="text-sm bg-gray-100 px-2 py-1 rounded text-gray-700 font-mono">
                    {data.database.connectionString}
                  </code>
                </div>
              )}

              {/* Description */}
              <div className="pt-3 border-t">
                <p className="text-sm text-gray-500">
                  {getProviderDescription(data.database.provider)}
                </p>
              </div>

              {/* Error message */}
              {data.database.error && (
                <div className="p-3 bg-red-50 rounded-lg">
                  <p className="text-sm text-red-700">{data.database.error}</p>
                </div>
              )}

              {/* Provider-specific info */}
              {data.database.provider === 'postgres' && data.database.connected && (
                <div className="p-3 bg-green-50 rounded-lg">
                  <p className="text-sm text-green-700">
                    PostgreSQL connection pool active with optimized settings for production workloads.
                  </p>
                </div>
              )}

              {data.database.provider === 'sqlite' && data.database.connected && (
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-700">
                    SQLite with WAL mode enabled for improved concurrency.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Vector Store Card */}
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="px-6 py-4 border-b bg-gradient-to-r from-purple-50 to-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <HardDrive className="text-purple-600" size={24} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Vector Store</h3>
                    <p className="text-sm text-gray-500">Embeddings storage</p>
                  </div>
                </div>
                <StatusBadge connected={data.vectorStore.connected} error={data.vectorStore.error} />
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Provider */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Provider</span>
                <span className="font-medium text-gray-900">
                  {getProviderDisplayName(data.vectorStore.provider)}
                </span>
              </div>

              {/* Host */}
              {data.vectorStore.host && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Host</span>
                  <code className="text-sm bg-gray-100 px-2 py-1 rounded text-gray-700 font-mono">
                    {data.vectorStore.host}
                  </code>
                </div>
              )}

              {/* Stats */}
              {data.vectorStore.connected && (
                <div className="grid grid-cols-2 gap-4 pt-3 border-t">
                  <div className="bg-purple-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-purple-900">{data.vectorStore.collections}</p>
                    <p className="text-xs text-purple-700">Collections</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-purple-900">
                      {data.vectorStore.totalVectors.toLocaleString()}
                    </p>
                    <p className="text-xs text-purple-700">Total Vectors</p>
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="pt-3 border-t">
                <p className="text-sm text-gray-500">
                  {getProviderDescription(data.vectorStore.provider)}
                </p>
              </div>

              {/* Error message */}
              {data.vectorStore.error && (
                <div className="p-3 bg-red-50 rounded-lg">
                  <p className="text-sm text-red-700">{data.vectorStore.error}</p>
                </div>
              )}
            </div>
          </div>

          {/* Environment Info Card */}
          <div className="bg-white rounded-lg border shadow-sm lg:col-span-2">
            <div className="px-6 py-4 border-b">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-100 rounded-lg">
                  <Server className="text-gray-600" size={24} />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Environment Configuration</h3>
                  <p className="text-sm text-gray-500">Build-time settings</p>
                </div>
              </div>
            </div>

            <div className="p-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Environment</p>
                  <p className="font-medium text-gray-900 capitalize">{data.environment.nodeEnv}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Max Upload Size</p>
                  <p className="font-medium text-gray-900">{data.environment.maxUploadSize}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Database Provider</p>
                  <p className="font-medium text-gray-900">
                    {getProviderDisplayName(data.database.provider)}
                  </p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Vector Provider</p>
                  <p className="font-medium text-gray-900">
                    {getProviderDisplayName(data.vectorStore.provider)}
                  </p>
                </div>
              </div>

              <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                <p className="text-sm text-yellow-800">
                  <strong>Note:</strong> Database and vector store providers are set at deployment time via
                  environment variables (<code className="bg-yellow-100 px-1 rounded">DATABASE_PROVIDER</code> and{' '}
                  <code className="bg-yellow-100 px-1 rounded">VECTOR_STORE_PROVIDER</code>).
                  Changing providers requires a restart.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">No data available</div>
      )}

      {/* Last Updated */}
      {data && (
        <p className="text-xs text-gray-400 text-right">
          Last updated: {new Date(data.timestamp).toLocaleString()}
        </p>
      )}
    </div>
  );
}

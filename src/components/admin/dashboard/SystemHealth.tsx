'use client';

import { useState, useEffect, useCallback } from 'react';
import { Database, HardDrive, Server, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface VectorStoreStats {
  connected: boolean;
  collections: { name: string; documentCount: number }[];
  totalVectors: number;
}

interface StorageStats {
  globalDocsDir: { path: string; exists: boolean; fileCount: number; totalSizeMB: number };
  threadsDir: { path: string; exists: boolean; userCount: number; totalUploadSizeMB: number };
  dataDir: { path: string; exists: boolean; totalSizeMB: number };
}

interface SystemStats {
  vectorStore: VectorStoreStats;
  storage: StorageStats;
}

export default function SystemHealth() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllCollections, setShowAllCollections] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/stats');
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const vectorStats = stats?.vectorStore;
  const storageStats = stats?.storage;

  const formatSize = (sizeMB: number) => {
    if (sizeMB >= 1024) {
      return `${(sizeMB / 1024).toFixed(2)} GB`;
    }
    return `${sizeMB.toFixed(2)} MB`;
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">×</button>
        </div>
      )}

      {/* Vector Store Status */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Database className="text-blue-600" size={20} />
              <div>
                <h2 className="font-semibold text-gray-900">Vector Database (Qdrant)</h2>
                <p className="text-sm text-gray-500">Vector store health and statistics</p>
              </div>
            </div>
            <Button variant="secondary" onClick={fetchStats} disabled={loading}>
              <RefreshCw size={16} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-12 flex justify-center">
            <Spinner size="lg" />
          </div>
        ) : vectorStats ? (
          <div className="p-6">
            {/* Connection Status */}
            <div className="flex items-center gap-3 mb-6">
              {vectorStats.connected ? (
                <>
                  <CheckCircle size={24} className="text-green-500" />
                  <span className="text-lg font-medium text-green-700">Connected</span>
                </>
              ) : (
                <>
                  <XCircle size={24} className="text-red-500" />
                  <span className="text-lg font-medium text-red-700">Disconnected</span>
                </>
              )}
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-2xl font-bold text-blue-900">{vectorStats.collections.length}</p>
                <p className="text-sm text-blue-700">Collections</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-4">
                <p className="text-2xl font-bold text-purple-900">{vectorStats.totalVectors.toLocaleString()}</p>
                <p className="text-sm text-purple-700">Total Vectors</p>
              </div>
            </div>

            {/* Collections Table */}
            {vectorStats.collections.length > 0 && (() => {
              const displayedCollections = showAllCollections
                ? vectorStats.collections
                : vectorStats.collections.slice(0, 5);
              const hasMore = vectorStats.collections.length > 5;

              return (
                <div className="border-t pt-4">
                  <h3 className="text-sm font-medium text-gray-900 mb-3">
                    Collections
                    {hasMore && !showAllCollections && (
                      <span className="text-gray-400 font-normal"> (showing 5 of {vectorStats.collections.length})</span>
                    )}
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
                          <th className="px-4 py-2 text-right font-medium text-gray-600">Documents</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {displayedCollections.map((collection) => (
                          <tr key={collection.name} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-900">{collection.name}</td>
                            <td className="px-4 py-2 text-gray-600 text-right">{collection.documentCount.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {hasMore && (
                    <button
                      onClick={() => setShowAllCollections(!showAllCollections)}
                      className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                      {showAllCollections
                        ? 'Show less'
                        : `Show all ${vectorStats.collections.length} collections`}
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="px-6 py-12 text-center text-gray-500">
            No statistics available
          </div>
        )}
      </div>

      {/* Storage Status */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <HardDrive className="text-blue-600" size={20} />
            <div>
              <h2 className="font-semibold text-gray-900">File Storage</h2>
              <p className="text-sm text-gray-500">Disk usage and file statistics</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-12 flex justify-center">
            <Spinner size="lg" />
          </div>
        ) : storageStats ? (
          <div className="p-6">
            <div className="space-y-4">
              {/* Global Docs */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Server size={20} className="text-gray-600" />
                  <div>
                    <p className="font-medium text-gray-900">Global Documents</p>
                    <p className="text-xs text-gray-500 truncate max-w-md">{storageStats.globalDocsDir.path}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium text-gray-900">{formatSize(storageStats.globalDocsDir.totalSizeMB)}</p>
                  <p className="text-xs text-gray-500">{storageStats.globalDocsDir.fileCount} files</p>
                </div>
              </div>

              {/* Thread Uploads */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Server size={20} className="text-gray-600" />
                  <div>
                    <p className="font-medium text-gray-900">Thread Uploads</p>
                    <p className="text-xs text-gray-500 truncate max-w-md">{storageStats.threadsDir.path}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium text-gray-900">{formatSize(storageStats.threadsDir.totalUploadSizeMB)}</p>
                  <p className="text-xs text-gray-500">{storageStats.threadsDir.userCount} users</p>
                </div>
              </div>

              {/* Data Directory */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Server size={20} className="text-gray-600" />
                  <div>
                    <p className="font-medium text-gray-900">Data Directory</p>
                    <p className="text-xs text-gray-500 truncate max-w-md">{storageStats.dataDir.path}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium text-gray-900">{formatSize(storageStats.dataDir.totalSizeMB)}</p>
                </div>
              </div>

              {/* Total */}
              <div className="border-t pt-4 flex items-center justify-between">
                <span className="font-medium text-gray-900">Total Storage Used</span>
                <span className="text-lg font-bold text-blue-600">
                  {formatSize(
                    storageStats.globalDocsDir.totalSizeMB +
                    storageStats.threadsDir.totalUploadSizeMB +
                    storageStats.dataDir.totalSizeMB
                  )}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-6 py-12 text-center text-gray-500">
            No statistics available
          </div>
        )}
      </div>
    </div>
  );
}

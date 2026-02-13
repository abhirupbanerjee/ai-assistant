'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileText, Globe, FolderOpen, Layers, RefreshCw, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface DocumentStats {
  total: number;
  globalDocuments: number;
  categoryDocuments: number;
  totalChunks: number;
  byStatus: {
    processing: number;
    ready: number;
    error: number;
  };
}

interface SystemStats {
  database: {
    documents: DocumentStats;
  };
}

export default function DocumentStatistics() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const docStats = stats?.database?.documents;

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">×</button>
        </div>
      )}

      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="text-blue-600" size={20} />
              <div>
                <h2 className="font-semibold text-gray-900">Document Statistics</h2>
                <p className="text-sm text-gray-500">Overview of documents and indexing status</p>
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
        ) : docStats ? (
          <div className="p-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <FileText size={20} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-blue-900">{docStats.total}</p>
                    <p className="text-sm text-blue-700">Total Documents</p>
                  </div>
                </div>
              </div>

              <div className="bg-purple-50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Globe size={20} className="text-purple-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-purple-900">{docStats.globalDocuments}</p>
                    <p className="text-sm text-purple-700">Global</p>
                  </div>
                </div>
              </div>

              <div className="bg-green-50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <FolderOpen size={20} className="text-green-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-900">{docStats.categoryDocuments}</p>
                    <p className="text-sm text-green-700">Category</p>
                  </div>
                </div>
              </div>

              <div className="bg-orange-50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <Layers size={20} className="text-orange-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-orange-900">{docStats.totalChunks.toLocaleString()}</p>
                    <p className="text-sm text-orange-700">Total Chunks</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Status Breakdown */}
            <div className="border-t pt-4">
              <h3 className="text-sm font-medium text-gray-900 mb-3">Document Status</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                  <CheckCircle size={20} className="text-green-600" />
                  <div>
                    <p className="text-lg font-semibold text-green-900">{docStats.byStatus.ready}</p>
                    <p className="text-xs text-green-700">Ready</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-yellow-50 rounded-lg">
                  <Clock size={20} className="text-yellow-600" />
                  <div>
                    <p className="text-lg font-semibold text-yellow-900">{docStats.byStatus.processing}</p>
                    <p className="text-xs text-yellow-700">Processing</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                  <AlertCircle size={20} className="text-red-600" />
                  <div>
                    <p className="text-lg font-semibold text-red-900">{docStats.byStatus.error}</p>
                    <p className="text-xs text-red-700">Error</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Chunks per Document */}
            {docStats.total > 0 && (
              <div className="border-t pt-4 mt-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Average chunks per document</span>
                  <span className="font-medium text-gray-900">
                    {Math.round(docStats.totalChunks / docStats.total).toLocaleString()}
                  </span>
                </div>
              </div>
            )}
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

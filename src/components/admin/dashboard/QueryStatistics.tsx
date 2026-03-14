'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, MessagesSquare, Upload, RefreshCw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface ThreadStats {
  total: number;
  totalMessages: number;
  totalUploads: number;
}

interface SystemStats {
  database: {
    threads: ThreadStats;
  };
}

export default function QueryStatistics() {
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

  const threadStats = stats?.database?.threads;

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
              <MessageSquare className="text-blue-600" size={20} />
              <div>
                <h2 className="font-semibold text-gray-900">Query Statistics</h2>
                <p className="text-sm text-gray-500">Overview of conversations and messages</p>
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
        ) : threadStats ? (
          <div className="p-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <MessageSquare size={20} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-blue-900">{threadStats.total.toLocaleString()}</p>
                    <p className="text-sm text-blue-700">Threads</p>
                  </div>
                </div>
              </div>

              <div className="bg-purple-50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <MessagesSquare size={20} className="text-purple-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-purple-900">{threadStats.totalMessages.toLocaleString()}</p>
                    <p className="text-sm text-purple-700">Messages</p>
                  </div>
                </div>
              </div>

              <div className="bg-green-50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <Upload size={20} className="text-green-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-900">{threadStats.totalUploads.toLocaleString()}</p>
                    <p className="text-sm text-green-700">Uploads</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Averages */}
            {threadStats.total > 0 && (
              <div className="border-t pt-4 mb-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Average messages per thread</span>
                  <span className="font-medium text-gray-900">
                    {(threadStats.totalMessages / threadStats.total).toFixed(1)}
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

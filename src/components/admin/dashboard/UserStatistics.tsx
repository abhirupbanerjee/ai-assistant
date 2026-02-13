'use client';

import { useState, useEffect, useCallback } from 'react';
import { Users, Shield, UserCog, User, RefreshCw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface UserStats {
  total: number;
  admins: number;
  superUsers: number;
  regularUsers: number;
}

interface SystemStats {
  database: {
    users: UserStats;
  };
}

export default function UserStatistics() {
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

  const userStats = stats?.database?.users;

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
              <Users className="text-blue-600" size={20} />
              <div>
                <h2 className="font-semibold text-gray-900">User Statistics</h2>
                <p className="text-sm text-gray-500">Overview of user accounts and roles</p>
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
        ) : userStats ? (
          <div className="p-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Users size={20} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-blue-900">{userStats.total}</p>
                    <p className="text-sm text-blue-700">Total Users</p>
                  </div>
                </div>
              </div>

              <div className="bg-purple-50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Shield size={20} className="text-purple-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-purple-900">{userStats.admins}</p>
                    <p className="text-sm text-purple-700">Admins</p>
                  </div>
                </div>
              </div>

              <div className="bg-orange-50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <UserCog size={20} className="text-orange-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-orange-900">{userStats.superUsers}</p>
                    <p className="text-sm text-orange-700">Superusers</p>
                  </div>
                </div>
              </div>

              <div className="bg-green-50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <User size={20} className="text-green-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-900">{userStats.regularUsers}</p>
                    <p className="text-sm text-green-700">Regular Users</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Role Distribution */}
            <div className="border-t pt-4">
              <h3 className="text-sm font-medium text-gray-900 mb-3">Role Distribution</h3>
              <div className="space-y-2">
                {[
                  { role: 'Admin', count: userStats.admins, color: 'bg-purple-500' },
                  { role: 'Superuser', count: userStats.superUsers, color: 'bg-orange-500' },
                  { role: 'User', count: userStats.regularUsers, color: 'bg-green-500' },
                ].map(({ role, count, color }) => (
                  <div key={role} className="flex items-center gap-3">
                    <span className="w-20 text-sm text-gray-600">{role}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-3">
                      <div
                        className={`${color} h-3 rounded-full transition-all`}
                        style={{ width: `${userStats.total > 0 ? (count / userStats.total) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-12 text-sm text-gray-600 text-right">{count}</span>
                  </div>
                ))}
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

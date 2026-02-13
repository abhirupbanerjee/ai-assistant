'use client';

import { FolderOpen, Database, Users, User, FileText, CheckCircle, Clock, AlertCircle, MessageSquare, RefreshCw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface CategoryStats {
  categoryId: number;
  categoryName: string;
  categorySlug: string;
  documentCount: number;
  readyDocuments: number;
  processingDocuments: number;
  errorDocuments: number;
  totalChunks: number;
  subscriberCount: number;
  activeSubscribers: number;
  hasCustomPrompt: boolean;
}

interface SuperUserStats {
  timestamp: string;
  assignedCategories: number;
  totalDocuments: number;
  totalSubscribers: number;
  categories: CategoryStats[];
  recentDocuments: {
    id: number;
    filename: string;
    categoryName: string;
    status: string;
    uploadedBy: string;
    uploadedAt: string;
  }[];
  recentSubscriptions: {
    userEmail: string;
    categoryName: string;
    subscribedAt: string;
    isActive: boolean;
  }[];
}

interface SuperuserDashboardProps {
  stats: SuperUserStats | null;
  statsLoading: boolean;
  loadStats: () => Promise<void>;
}

export default function SuperuserDashboard({
  stats,
  statsLoading,
  loadStats,
}: SuperuserDashboardProps) {
  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="bg-white rounded-lg border shadow-sm p-8 text-center">
        <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Unable to load stats</h3>
        <p className="text-gray-500 mb-4">There was a problem loading your dashboard statistics.</p>
        <Button variant="secondary" onClick={loadStats}>
          <RefreshCw size={16} className="mr-2" />
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border shadow-sm p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
              <FolderOpen className="text-orange-600" size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500">Assigned Categories</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.assignedCategories}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Database className="text-blue-600" size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Documents</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.totalDocuments}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
              <Users className="text-green-600" size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Subscribers</p>
              <p className="text-2xl font-semibold text-gray-900">{stats.totalSubscribers}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">Category Breakdown</h3>
          <p className="text-sm text-gray-500">Overview of each assigned category</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 text-left text-sm text-gray-600">
              <tr>
                <th className="px-6 py-3 font-medium">Category</th>
                <th className="px-6 py-3 font-medium text-center">Documents</th>
                <th className="px-6 py-3 font-medium text-center">Status</th>
                <th className="px-6 py-3 font-medium text-center">Subscribers</th>
                <th className="px-6 py-3 font-medium text-center">Custom Prompt</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stats.categories.map((cat) => (
                <tr key={cat.categoryId} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <span className="font-medium text-gray-900">{cat.categoryName}</span>
                    <span className="ml-2 text-xs text-gray-400">{cat.categorySlug}</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="font-medium text-gray-900">{cat.documentCount}</span>
                    {cat.totalChunks > 0 && (
                      <span className="ml-1 text-xs text-gray-400">({cat.totalChunks} chunks)</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-center gap-2">
                      {cat.readyDocuments > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">
                          <CheckCircle size={12} />
                          {cat.readyDocuments}
                        </span>
                      )}
                      {cat.processingDocuments > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded-full">
                          <Clock size={12} />
                          {cat.processingDocuments}
                        </span>
                      )}
                      {cat.errorDocuments > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">
                          <AlertCircle size={12} />
                          {cat.errorDocuments}
                        </span>
                      )}
                      {cat.documentCount === 0 && (
                        <span className="text-xs text-gray-400">No documents</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="font-medium text-gray-900">{cat.subscriberCount}</span>
                    {cat.activeSubscribers !== cat.subscriberCount && (
                      <span className="ml-1 text-xs text-gray-400">({cat.activeSubscribers} active)</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {cat.hasCustomPrompt ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full">
                        <MessageSquare size={12} />
                        Yes
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Global only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Documents */}
        <div className="bg-white rounded-lg border shadow-sm">
          <div className="px-6 py-4 border-b">
            <h3 className="font-semibold text-gray-900">Recent Documents</h3>
            <p className="text-sm text-gray-500">Latest documents in your categories</p>
          </div>
          <div className="p-4">
            {stats.recentDocuments.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No documents yet</p>
            ) : (
              <ul className="space-y-3">
                {stats.recentDocuments.map((doc) => (
                  <li key={doc.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50">
                    <FileText size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{doc.filename}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">
                          {doc.categoryName}
                        </span>
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded ${
                            doc.status === 'ready'
                              ? 'bg-green-100 text-green-700'
                              : doc.status === 'processing'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {doc.status}
                        </span>
                        <span>{formatDate(doc.uploadedAt)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Recent Subscriptions */}
        <div className="bg-white rounded-lg border shadow-sm">
          <div className="px-6 py-4 border-b">
            <h3 className="font-semibold text-gray-900">Recent Subscriptions</h3>
            <p className="text-sm text-gray-500">Latest subscribers to your categories</p>
          </div>
          <div className="p-4">
            {stats.recentSubscriptions.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No subscriptions yet</p>
            ) : (
              <ul className="space-y-3">
                {stats.recentSubscriptions.map((sub, idx) => (
                  <li key={idx} className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50">
                    <User size={18} className="text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{sub.userEmail}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">
                          {sub.categoryName}
                        </span>
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded ${
                            sub.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {sub.isActive ? 'Active' : 'Inactive'}
                        </span>
                        <span>{formatDate(sub.subscribedAt)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Refresh Button */}
      <div className="flex justify-center">
        <Button variant="secondary" onClick={loadStats} disabled={statsLoading}>
          <RefreshCw size={16} className={`mr-2 ${statsLoading ? 'animate-spin' : ''}`} />
          Refresh Stats
        </Button>
      </div>
    </div>
  );
}

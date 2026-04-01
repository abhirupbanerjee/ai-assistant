'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Trash2, Brain, X, AlertTriangle, Loader2, Download } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface UserMemory {
  id: number;
  categoryId: number | null;
  categoryName: string;
  categorySlug: string | null;
  facts: string[];
  updatedAt: string;
}

interface MemoryData {
  memories: UserMemory[];
  totalFacts: number;
}

export default function ProfilePage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(true);
  const [memoryData, setMemoryData] = useState<MemoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearingMemory, setClearingMemory] = useState(false);
  const [clearCategoryId, setClearCategoryId] = useState<number | null | 'all'>(null);
  const [exportingHistory, setExportingHistory] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const loadMemory = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch('/api/user/memory');

      if (response.status === 401) {
        router.push('/auth/signin');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load memory');
      }

      const data = await response.json();
      setMemoryData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memory');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
      return;
    }
    if (status === 'authenticated') {
      loadMemory();
    }
  }, [status, router, loadMemory]);

  const handleClearMemory = async () => {
    setClearingMemory(true);
    setError(null);
    try {
      const url = clearCategoryId === 'all'
        ? '/api/user/memory'
        : `/api/user/memory?categoryId=${clearCategoryId === null ? 'global' : clearCategoryId}`;

      const response = await fetch(url, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to clear memory');
      }

      // Reload memory data
      await loadMemory();
      setShowClearConfirm(false);
      setClearCategoryId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear memory');
    } finally {
      setClearingMemory(false);
    }
  };

  const getCategoryDisplayName = (memory: UserMemory): string => {
    return memory.categoryName || (memory.categoryId === null ? 'Global Memory' : `Category ${memory.categoryId}`);
  };

  const getSelectedCategoryName = (): string => {
    if (clearCategoryId === 'all') return '';
    const memory = memoryData?.memories.find(m => m.categoryId === clearCategoryId);
    return memory?.categoryName || (clearCategoryId === null ? 'Global Memory' : `Category ${clearCategoryId}`);
  };

  const handleExportHistory = async () => {
    setExportingHistory(true);
    setExportError(null);
    try {
      const response = await fetch('/api/user/export/threads', { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to export chat history');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-history-${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export chat history');
    } finally {
      setExportingHistory(false);
    }
  };

  const totalFacts = memoryData?.totalFacts || 0;

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/chat')}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Back to Chat"
              >
                <ArrowLeft size={20} />
              </button>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Your Profile</h1>
                <p className="text-sm text-gray-500">{session?.user?.email}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-2 text-red-800">
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Memory Section */}
        <div className="bg-white rounded-lg border shadow-sm">
          <div className="px-6 py-4 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Brain className="text-blue-600" size={24} />
                <div>
                  <h2 className="font-semibold text-gray-900">Memory</h2>
                  <p className="text-sm text-gray-500">
                    Facts the assistant remembers about you ({totalFacts} total)
                  </p>
                </div>
              </div>
              {totalFacts > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setClearCategoryId('all');
                    setShowClearConfirm(true);
                  }}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 size={16} className="mr-2" />
                  Clear All
                </Button>
              )}
            </div>
          </div>

          <div className="p-6">
            {!memoryData || memoryData.memories.length === 0 ? (
              <div className="text-center py-8">
                <Brain className="mx-auto h-12 w-12 text-gray-300" />
                <h3 className="mt-4 text-sm font-medium text-gray-900">No memories yet</h3>
                <p className="mt-2 text-sm text-gray-500">
                  As you chat, the assistant will learn and remember facts about you.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {memoryData.memories.map((memory) => (
                  <div key={memory.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-medium text-gray-900">
                          {getCategoryDisplayName(memory)}
                        </h3>
                        <p className="text-xs text-gray-500">
                          Last updated: {new Date(memory.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setClearCategoryId(memory.categoryId);
                          setShowClearConfirm(true);
                        }}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 size={14} className="mr-1" />
                        Clear
                      </Button>
                    </div>
                    <ul className="space-y-2">
                      {memory.facts.map((fact, index) => (
                        <li
                          key={index}
                          className="flex items-start gap-2 text-sm text-gray-700"
                        >
                          <span className="text-blue-500 mt-1">•</span>
                          <span>{fact}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Backup Section */}
        <div className="mt-6 bg-white rounded-lg border shadow-sm">
          <div className="px-6 py-4 border-b">
            <div className="flex items-center gap-3">
              <Download className="text-blue-600" size={24} />
              <div>
                <h2 className="font-semibold text-gray-900">Backup</h2>
                <p className="text-sm text-gray-500">Download all your conversations as a ZIP of Markdown files</p>
              </div>
            </div>
          </div>
          <div className="px-6 py-4">
            {exportError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-800 text-sm">
                <AlertTriangle size={16} />
                <span>{exportError}</span>
              </div>
            )}
            <Button
              variant="secondary"
              onClick={handleExportHistory}
              disabled={exportingHistory}
            >
              {exportingHistory ? (
                <>
                  <Loader2 className="animate-spin mr-2" size={16} />
                  Exporting...
                </>
              ) : (
                <>
                  <Download size={16} className="mr-2" />
                  Download Chat History
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Info Section */}
        <div className="mt-6 bg-blue-50 border border-blue-100 rounded-lg p-4">
          <h3 className="font-medium text-blue-900 mb-2">How Memory Works</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• The assistant extracts key facts from your conversations</li>
            <li>• Memory helps provide more personalized and relevant responses</li>
            <li>• You can clear your memory at any time from this page</li>
            <li>• Memory is stored per category to keep context relevant</li>
          </ul>
        </div>
      </main>

      {/* Clear Memory Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Clear Memory</h3>
              <button
                onClick={() => {
                  setShowClearConfirm(false);
                  setClearCategoryId(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <p className="text-gray-600 mb-6">
              {clearCategoryId === 'all'
                ? 'Are you sure you want to clear all your memory? This will remove all facts the assistant has learned about you.'
                : `Are you sure you want to clear your memory for "${getSelectedCategoryName()}"? This action cannot be undone.`}
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowClearConfirm(false);
                  setClearCategoryId(null);
                }}
                disabled={clearingMemory}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleClearMemory}
                disabled={clearingMemory}
                className="bg-red-600 hover:bg-red-700"
              >
                {clearingMemory ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={16} />
                    Clearing...
                  </>
                ) : (
                  <>
                    <Trash2 size={16} className="mr-2" />
                    Clear Memory
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

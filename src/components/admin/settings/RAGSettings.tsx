'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Cpu } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface RAGSettings {
  topKChunks: number;
  maxContextChunks: number;
  similarityThreshold: number;
  chunkSize: number;
  chunkOverlap: number;
  queryExpansionEnabled: boolean;
  cacheEnabled: boolean;
  cacheTTLSeconds: number;
  chunkingStrategy: 'recursive' | 'semantic';
  semanticBreakpointThreshold: number;
  updatedAt: string;
  updatedBy: string;
}

interface EmbeddingSettings {
  model: string;
  dimensions: number;
  updatedAt?: string;
  updatedBy?: string;
}

export default function RAGSettingsTab() {
  const [settings, setSettings] = useState<RAGSettings | null>(null);
  const [editedSettings, setEditedSettings] = useState<Omit<RAGSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [embeddingSettings, setEmbeddingSettings] = useState<EmbeddingSettings | null>(null);
  const [isModified, setIsModified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString();
  };

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/admin/settings');
      if (!res.ok) throw new Error('Failed to fetch settings');
      const data = await res.json();

      const ragData = data.rag || {
        topKChunks: 15,
        maxContextChunks: 12,
        similarityThreshold: 0.7,
        chunkSize: 500,
        chunkOverlap: 50,
        queryExpansionEnabled: true,
        cacheEnabled: true,
        cacheTTLSeconds: 3600,
        chunkingStrategy: 'recursive',
        semanticBreakpointThreshold: 0.5,
      };

      setSettings(ragData);
      setEditedSettings({
        topKChunks: ragData.topKChunks,
        maxContextChunks: ragData.maxContextChunks,
        similarityThreshold: ragData.similarityThreshold,
        chunkSize: ragData.chunkSize,
        chunkOverlap: ragData.chunkOverlap,
        queryExpansionEnabled: ragData.queryExpansionEnabled,
        cacheEnabled: ragData.cacheEnabled,
        cacheTTLSeconds: ragData.cacheTTLSeconds,
        chunkingStrategy: ragData.chunkingStrategy || 'recursive',
        semanticBreakpointThreshold: ragData.semanticBreakpointThreshold ?? 0.5,
      });

      if (data.embedding) {
        setEmbeddingSettings(data.embedding);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleChange = <K extends keyof Omit<RAGSettings, 'updatedAt' | 'updatedBy'>>(
    key: K,
    value: Omit<RAGSettings, 'updatedAt' | 'updatedBy'>[K]
  ) => {
    if (!editedSettings) return;
    setEditedSettings({ ...editedSettings, [key]: value });
    setIsModified(true);
  };

  const handleSave = async () => {
    if (!editedSettings || !isModified) return;

    try {
      setIsSaving(true);
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'rag', settings: editedSettings }),
      });

      if (!res.ok) throw new Error('Failed to save settings');

      const result = await res.json();
      setSettings(result.settings);
      setIsModified(false);
      setSuccess('RAG settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (settings) {
      setEditedSettings({
        topKChunks: settings.topKChunks,
        maxContextChunks: settings.maxContextChunks,
        similarityThreshold: settings.similarityThreshold,
        chunkSize: settings.chunkSize,
        chunkOverlap: settings.chunkOverlap,
        queryExpansionEnabled: settings.queryExpansionEnabled,
        cacheEnabled: settings.cacheEnabled,
        cacheTTLSeconds: settings.cacheTTLSeconds,
        chunkingStrategy: settings.chunkingStrategy,
        semanticBreakpointThreshold: settings.semanticBreakpointThreshold,
      });
      setIsModified(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">×</button>
        </div>
      )}

      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {/* Embedding Model Info Card */}
      <div className="bg-white rounded-lg border shadow-sm p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Cpu size={20} className="text-purple-600" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-900">Active Embedding Model</h3>
              <p className="text-sm text-gray-600">
                {embeddingSettings?.model || 'Not configured'}
                {embeddingSettings?.dimensions && (
                  <span className="text-gray-400 ml-2">({embeddingSettings.dimensions} dimensions)</span>
                )}
              </p>
            </div>
          </div>
          <div className="text-xs text-gray-500">
            {embeddingSettings?.updatedAt && (
              <span>Updated: {formatDate(embeddingSettings.updatedAt)}</span>
            )}
          </div>
        </div>
      </div>

      {/* RAG Configuration Card */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">RAG</h2>
              <p className="text-sm text-gray-500">Configure retrieval and chunking parameters</p>
            </div>
            <div className="flex items-center gap-2">
              {isModified && (
                <Button variant="secondary" onClick={handleReset} disabled={isSaving}>
                  Reset
                </Button>
              )}
              <Button onClick={handleSave} disabled={!isModified || isSaving} loading={isSaving}>
                <Save size={18} className="mr-2" />
                Save
              </Button>
            </div>
          </div>
        </div>
        {isLoading ? (
          <div className="px-6 py-12 flex justify-center"><Spinner size="lg" /></div>
        ) : editedSettings && (
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Top K Chunks</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={editedSettings.topKChunks}
                  onChange={(e) => handleChange('topKChunks', parseInt(e.target.value) || 15)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Chunks retrieved per query (1-50)</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Max Context Chunks</label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={editedSettings.maxContextChunks}
                  onChange={(e) => handleChange('maxContextChunks', parseInt(e.target.value) || 12)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Max chunks sent to LLM (1-30)</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Similarity Threshold: {editedSettings.similarityThreshold}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={editedSettings.similarityThreshold}
                  onChange={(e) => handleChange('similarityThreshold', parseFloat(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>0 (All)</span>
                  <span>1 (Exact)</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Cache TTL (seconds)</label>
                <input
                  type="number"
                  min="0"
                  max="86400"
                  value={editedSettings.cacheTTLSeconds}
                  onChange={(e) => handleChange('cacheTTLSeconds', parseInt(e.target.value) || 3600)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Response cache duration (0-86400)</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Chunk Size</label>
                <input
                  type="number"
                  min="100"
                  max="2000"
                  value={editedSettings.chunkSize}
                  onChange={(e) => handleChange('chunkSize', parseInt(e.target.value) || 500)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Characters per chunk (100-2000)</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Chunk Overlap</label>
                <input
                  type="number"
                  min="0"
                  max={editedSettings.chunkSize / 2}
                  value={editedSettings.chunkOverlap}
                  onChange={(e) => handleChange('chunkOverlap', parseInt(e.target.value) || 50)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Overlap between chunks</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Default Chunking Strategy</label>
                <select
                  value={editedSettings.chunkingStrategy}
                  onChange={(e) => handleChange('chunkingStrategy', e.target.value as 'recursive' | 'semantic')}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="recursive">Recursive Character (Fast)</option>
                  <option value="semantic">Semantic (Topic-Aware)</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {editedSettings.chunkingStrategy === 'recursive'
                    ? 'Fast, no extra cost. Good for general documents.'
                    : 'Groups by topic. +70% accuracy. Uses embedding API calls.'}
                </p>
              </div>
              {editedSettings.chunkingStrategy === 'semantic' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Breakpoint Sensitivity: {editedSettings.semanticBreakpointThreshold}
                  </label>
                  <input
                    type="range"
                    min="0.3"
                    max="0.8"
                    step="0.05"
                    value={editedSettings.semanticBreakpointThreshold}
                    onChange={(e) => handleChange('semanticBreakpointThreshold', parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>0.3 (More splits)</span>
                    <span>0.8 (Fewer splits)</span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-6 pt-4 border-t">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editedSettings.queryExpansionEnabled}
                  onChange={(e) => handleChange('queryExpansionEnabled', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Query Expansion (acronyms)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editedSettings.cacheEnabled}
                  onChange={(e) => handleChange('cacheEnabled', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Response Caching</span>
              </label>
            </div>
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800">
                Chunk size/overlap changes only affect new documents. Use &quot;Refresh All&quot; on the Documents tab to reindex existing documents.
              </p>
            </div>
            {settings && (
              <p className="text-xs text-gray-500 pt-4 border-t">
                Last updated: {formatDate(settings.updatedAt)} by {settings.updatedBy}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

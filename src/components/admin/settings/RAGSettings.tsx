'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Save, Cpu, AlertTriangle, RefreshCw, AlertCircle, X } from 'lucide-react';
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

interface FallbackEvent {
  primaryModel: string;
  fallbackModel: string;
  error: string;
  timestamp: string;
}

interface EmbeddingSettings {
  model: string;
  dimensions: number;
  fallbackModel?: string;
  updatedAt?: string;
  updatedBy?: string;
  recentFallback?: FallbackEvent | null;
}

interface AvailableEmbeddingModel {
  id: string;
  name: string;
  provider: string;
  dimensions: number;
  local: boolean;
  available: boolean;
}

interface ReindexJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  targetModel: string;
  targetDimensions: number;
  previousModel: string;
  previousDimensions: number;
  totalDocuments: number;
  processedDocuments: number;
  failedDocuments: number;
  errors: string[];
}

export default function RAGSettingsTab() {
  const [settings, setSettings] = useState<RAGSettings | null>(null);
  const [editedSettings, setEditedSettings] = useState<Omit<RAGSettings, 'updatedAt' | 'updatedBy'> | null>(null);
  const [embeddingSettings, setEmbeddingSettings] = useState<EmbeddingSettings | null>(null);
  const [availableEmbeddingModels, setAvailableEmbeddingModels] = useState<AvailableEmbeddingModel[]>([]);
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState<string>('');
  const [selectedFallbackModel, setSelectedFallbackModel] = useState<string>('');
  const [isSavingFallback, setIsSavingFallback] = useState(false);
  const [isModified, setIsModified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Reindex state
  const [isReindexing, setIsReindexing] = useState(false);
  const [reindexProgress, setReindexProgress] = useState(0);
  const [reindexJobId, setReindexJobId] = useState<string | null>(null);
  const [reindexError, setReindexError] = useState<string | null>(null);
  const [fallbackDismissed, setFallbackDismissed] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString();
  };

  // Check if embedding model has changed from current
  const isEmbeddingModelChanged = selectedEmbeddingModel && embeddingSettings?.model !== selectedEmbeddingModel;

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
        setSelectedEmbeddingModel(data.embedding.model);
        setSelectedFallbackModel(data.embedding.fallbackModel || 'text-embedding-3-large');
      }

      if (data.availableEmbeddingModels) {
        setAvailableEmbeddingModels(data.availableEmbeddingModels);
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

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Poll for reindex job progress
  const pollReindexProgress = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/admin/reindex/${jobId}`);
      if (!res.ok) throw new Error('Failed to fetch job status');

      const data = await res.json();
      const job = data.job as ReindexJob;

      setReindexProgress(data.progress || 0);

      if (job.status === 'completed') {
        setIsReindexing(false);
        setReindexJobId(null);
        setSuccess(`Reindexing completed! ${job.processedDocuments} documents processed.`);
        setTimeout(() => setSuccess(null), 5000);

        // Clear polling
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        // Refresh settings to get updated embedding info
        fetchSettings();
      } else if (job.status === 'failed' || job.status === 'cancelled') {
        setIsReindexing(false);
        setReindexJobId(null);
        setReindexError(
          job.status === 'cancelled'
            ? 'Reindexing was cancelled'
            : `Reindexing failed: ${job.errors.join(', ')}`
        );

        // Clear polling
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
    } catch (err) {
      console.error('Error polling reindex progress:', err);
    }
  }, [fetchSettings]);

  // Handle embedding model change and reindex
  const handleChangeEmbedding = async () => {
    if (!isEmbeddingModelChanged) return;

    try {
      setIsReindexing(true);
      setReindexError(null);
      setReindexProgress(0);

      const res = await fetch('/api/admin/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeddingModel: selectedEmbeddingModel }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to start reindexing');
      }

      const data = await res.json();
      setReindexJobId(data.job.id);

      // Start polling for progress
      pollIntervalRef.current = setInterval(() => {
        pollReindexProgress(data.job.id);
      }, 2000);
    } catch (err) {
      setIsReindexing(false);
      setReindexError(err instanceof Error ? err.message : 'Failed to start reindexing');
    }
  };

  // Cancel reindex job
  const handleCancelReindex = async () => {
    if (!reindexJobId) return;

    try {
      const res = await fetch(`/api/admin/reindex/${reindexJobId}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to cancel reindex');

      // Clear polling
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      setIsReindexing(false);
      setReindexJobId(null);
      setReindexError('Reindexing cancelled');
    } catch (err) {
      setReindexError(err instanceof Error ? err.message : 'Failed to cancel');
    }
  };

  // Check if fallback model has changed
  const isFallbackModelChanged = selectedFallbackModel && embeddingSettings?.fallbackModel !== selectedFallbackModel;

  // Save fallback model (no reindexing required)
  const handleSaveFallback = async () => {
    if (!isFallbackModelChanged) return;

    try {
      setIsSavingFallback(true);
      setError(null);

      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'embedding',
          model: embeddingSettings?.model || 'text-embedding-3-large',
          dimensions: embeddingSettings?.dimensions || 3072,
          fallbackModel: selectedFallbackModel,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to save fallback model');
      }

      // Update local state
      setEmbeddingSettings(prev => prev ? { ...prev, fallbackModel: selectedFallbackModel } : prev);
      setSuccess('Fallback model saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save fallback model');
    } finally {
      setIsSavingFallback(false);
    }
  };

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

      {/* Embedding Model Configuration */}
      <div className="bg-white rounded-lg border shadow-sm p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Cpu size={20} className="text-purple-600" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-900">Embedding Model</h3>
              <p className="text-xs text-gray-500">Used for document and query vectorization</p>
            </div>
          </div>
        </div>

        {/* Fallback Warning Banner */}
        {embeddingSettings?.recentFallback && !fallbackDismissed && (
          <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="text-orange-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-orange-800">Fallback Model Active</p>
                  <p className="text-xs text-orange-700 mt-1">
                    Primary model <strong>{embeddingSettings.recentFallback.primaryModel}</strong> failed.
                    Using fallback: <strong>{embeddingSettings.recentFallback.fallbackModel}</strong>
                  </p>
                  <p className="text-xs text-orange-600 mt-1">
                    Error: {embeddingSettings.recentFallback.error.slice(0, 100)}
                    {embeddingSettings.recentFallback.error.length > 100 && '...'}
                  </p>
                  <p className="text-xs text-orange-500 mt-1">
                    {new Date(embeddingSettings.recentFallback.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setFallbackDismissed(true)}
                className="text-orange-500 hover:text-orange-700 p-1"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Model Dropdown */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Model</label>
          <select
            value={selectedEmbeddingModel}
            onChange={(e) => setSelectedEmbeddingModel(e.target.value)}
            disabled={isReindexing}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            {/* Cloud Providers Group */}
            <optgroup label="Cloud Providers">
              {availableEmbeddingModels.filter(m => !m.local).map(model => (
                <option
                  key={model.id}
                  value={model.id}
                  disabled={!model.available}
                >
                  {model.name} ({model.dimensions} dims)
                  {!model.available && ' - Not configured'}
                  {model.id === embeddingSettings?.model && ' (Current)'}
                </option>
              ))}
            </optgroup>

            {/* Local Models Group */}
            <optgroup label="Local Models (Free)">
              {availableEmbeddingModels.filter(m => m.local).map(model => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.dimensions} dims)
                  {model.id === embeddingSettings?.model && ' (Current)'}
                </option>
              ))}
            </optgroup>
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Local models run on-device, no API key required
          </p>
        </div>

        {/* Fallback Model Dropdown */}
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Fallback Model
            <span className="ml-2 text-xs font-normal text-gray-500">(Used when primary fails)</span>
          </label>
          <div className="flex gap-2">
            <select
              value={selectedFallbackModel}
              onChange={(e) => setSelectedFallbackModel(e.target.value)}
              disabled={isReindexing || isSavingFallback}
              className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-100 disabled:cursor-not-allowed text-sm"
            >
              {/* Only show cloud providers as fallback (more reliable) */}
              {availableEmbeddingModels.filter(m => !m.local && m.available).map(model => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.dimensions} dims)
                  {model.id === embeddingSettings?.fallbackModel && ' (Current)'}
                </option>
              ))}
              {/* Also allow local models as fallback */}
              <optgroup label="Local Models">
                {availableEmbeddingModels.filter(m => m.local).map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.dimensions} dims)
                    {model.id === embeddingSettings?.fallbackModel && ' (Current)'}
                  </option>
                ))}
              </optgroup>
            </select>
            <Button
              onClick={handleSaveFallback}
              disabled={!isFallbackModelChanged || isSavingFallback}
              loading={isSavingFallback}
              size="sm"
            >
              <Save size={14} className="mr-1" />
              Save
            </Button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            If the primary model fails to load, the system will automatically use this fallback.
            Changing fallback does not require reindexing.
          </p>
        </div>

        {/* Show warning only when model changed */}
        {isEmbeddingModelChanged && !isReindexing && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">Reindexing Required</p>
                <p className="text-xs text-amber-700 mt-1">
                  Changing the embedding model requires reindexing all documents.
                  This runs in the background and may take several minutes depending
                  on document count. Existing embeddings will be replaced.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Reindex Error */}
        {reindexError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
            <p className="text-sm text-red-700">{reindexError}</p>
            <button onClick={() => setReindexError(null)} className="text-red-500 hover:text-red-700">×</button>
          </div>
        )}

        {/* Apply & Reindex Button */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleChangeEmbedding}
            disabled={!isEmbeddingModelChanged || isReindexing}
            loading={isReindexing}
          >
            <RefreshCw size={16} className="mr-2" />
            {isReindexing ? 'Reindexing...' : 'Apply & Start Reindexing'}
          </Button>

          {isEmbeddingModelChanged && !isReindexing && (
            <Button
              variant="secondary"
              onClick={() => setSelectedEmbeddingModel(embeddingSettings?.model || '')}
            >
              Cancel
            </Button>
          )}

          {isReindexing && (
            <Button variant="secondary" onClick={handleCancelReindex}>
              Cancel Reindex
            </Button>
          )}
        </div>

        {/* Progress Bar (shown during reindexing) */}
        {isReindexing && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-600 mb-1">
              <span>Reindexing documents...</span>
              <span>{reindexProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${reindexProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Last updated info */}
        {embeddingSettings?.updatedAt && !isReindexing && (
          <p className="mt-4 text-xs text-gray-500 border-t pt-3">
            Last updated: {formatDate(embeddingSettings.updatedAt)}
            {embeddingSettings.updatedBy && ` by ${embeddingSettings.updatedBy}`}
          </p>
        )}
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
